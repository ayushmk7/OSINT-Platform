import type { ReactNode } from 'react';
import { renderHook, act } from '@testing-library/react';
import { Provider } from 'react-redux';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { store } from '../../store';
import { useWebSocket, deriveTelemetryUrl } from '../useWebSocket';

interface MockSocket {
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  onopen: (() => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
}

function makeMockSocket(): MockSocket {
  return {
    send: vi.fn(),
    close: vi.fn(),
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null
  };
}

const wrapper = ({ children }: { children: ReactNode }) => (
  <Provider store={store}>{children}</Provider>
);

describe('useWebSocket hook', () => {
  let sockets: MockSocket[];

  beforeEach(() => {
    sockets = [];
    vi.stubGlobal(
      'WebSocket',
      vi.fn(() => {
        const s = makeMockSocket();
        sockets.push(s);
        return s;
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('derives ws:// for http pages and wss:// for https pages', () => {
    expect(deriveTelemetryUrl({ protocol: 'http:', host: 'localhost:3000' })).toBe(
      'ws://localhost:3000/ws/telemetry'
    );
    expect(deriveTelemetryUrl({ protocol: 'https:', host: 'osint.example' })).toBe(
      'wss://osint.example/ws/telemetry'
    );
  });

  it('connects and pushes initial_state into the store', () => {
    const { result } = renderHook(() => useWebSocket({ url: 'ws://localhost/test' }), { wrapper });

    act(() => {
      sockets[0].onopen?.();
    });
    expect(result.current.isConnected).toBe(true);

    act(() => {
      sockets[0].onmessage?.({
        data: JSON.stringify({
          type: 'initial_state',
          timestamp: '2026-07-26T00:00:00Z',
          data: {
            sources: [{ id: 's1', name: 'Source 1', enabled: true }],
            entities: [
              {
                id: 'e1',
                source_id: 's1',
                name: 'Entity 1',
                category: 'satellite',
                latitude: 0,
                longitude: 0,
                altitude: 100,
                timestamp: '2026-07-26T00:00:00Z'
              }
            ]
          }
        })
      });
    });

    const state = store.getState();
    expect(state.entities.entities['e1']).toBeDefined();
    expect(state.sources.sources['s1']).toBeDefined();
    expect(result.current.lastSeenTimestamp).toBe('2026-07-26T00:00:00Z');
  });

  it('applies entity_update frames as upserts', () => {
    renderHook(() => useWebSocket({ url: 'ws://localhost/test' }), { wrapper });

    act(() => {
      sockets[0].onopen?.();
      sockets[0].onmessage?.({
        data: JSON.stringify({
          type: 'entity_update',
          data: {
            id: 'moving',
            source_id: 's1',
            name: 'Mover',
            category: 'aircraft',
            latitude: 5,
            longitude: 6,
            altitude: 1000,
            timestamp: '2026-07-26T00:02:00Z'
          }
        })
      });
    });

    expect(store.getState().entities.entities['moving'].latitude).toBe(5);
  });

  it('answers the server heartbeat with a pong', () => {
    renderHook(() => useWebSocket({ url: 'ws://localhost/test' }), { wrapper });

    act(() => {
      sockets[0].onopen?.();
      sockets[0].onmessage?.({ data: JSON.stringify({ type: 'ping' }) });
    });

    expect(sockets[0].send).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(sockets[0].send.mock.calls[0][0] as string);
    expect(sent.type).toBe('pong');
  });

  it('reports reconnecting and dials again after a backoff delay', () => {
    vi.useFakeTimers();
    const { result } = renderHook(
      () => useWebSocket({ url: 'ws://localhost/test', reconnectInterval: 1000 }),
      { wrapper }
    );

    act(() => {
      sockets[0].onopen?.();
    });
    expect(result.current.isConnected).toBe(true);

    act(() => {
      sockets[0].onclose?.();
    });
    expect(result.current.isConnected).toBe(false);
    expect(result.current.isReconnecting).toBe(true);
    expect(sockets).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(sockets).toHaveLength(2); // reconnected

    // Second failure backs off further: nothing new at 1s, a new socket at 2s.
    act(() => {
      sockets[1].onclose?.();
      vi.advanceTimersByTime(1000);
    });
    expect(sockets).toHaveLength(2);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(sockets).toHaveLength(3);
  });

  it('does not reconnect after unmount', () => {
    vi.useFakeTimers();
    const { unmount } = renderHook(
      () => useWebSocket({ url: 'ws://localhost/test', reconnectInterval: 1000 }),
      { wrapper }
    );
    act(() => {
      sockets[0].onopen?.();
    });
    unmount();
    expect(sockets[0].close).toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(sockets).toHaveLength(1);
  });
});
