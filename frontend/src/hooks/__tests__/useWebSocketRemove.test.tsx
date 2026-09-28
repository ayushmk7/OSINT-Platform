import type { ReactNode } from 'react';
import { renderHook, act } from '@testing-library/react';
import { Provider } from 'react-redux';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { store } from '../../store';
import { useWebSocket } from '../useWebSocket';

interface MockSocket {
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  onopen: (() => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
}

const wrapper = ({ children }: { children: ReactNode }) => (
  <Provider store={store}>{children}</Provider>
);

describe('useWebSocket: entity_remove + source_update', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('drops removed entities and merges a source_update', () => {
    const sockets: MockSocket[] = [];
    vi.stubGlobal(
      'WebSocket',
      vi.fn(() => {
        const s: MockSocket = {
          send: vi.fn(),
          close: vi.fn(),
          onopen: null,
          onmessage: null,
          onclose: null,
          onerror: null
        };
        sockets.push(s);
        return s;
      })
    );
    renderHook(() => useWebSocket({ url: 'ws://localhost/test' }), { wrapper });
    const send = (frame: object) =>
      act(() => {
        sockets[0].onmessage?.({ data: JSON.stringify(frame) });
      });

    const entity = (id: string) => ({
      id,
      source_id: 's1',
      category: 'x',
      name: id,
      latitude: 0,
      longitude: 0,
      altitude: 0,
      timestamp: '2026-09-28T00:00:00Z'
    });
    send({
      type: 'initial_state',
      data: {
        sources: [{ id: 's1', name: 'S1', enabled: true }],
        entities: [entity('a'), entity('b')]
      }
    });
    send({ type: 'entity_remove', data: { ids: ['a'] } });
    expect(Object.keys(store.getState().entities.entities)).toEqual(['b']);

    send({
      type: 'source_update',
      data: {
        sources: [
          { id: 's1', name: 'S1', enabled: true },
          { id: 's2', name: 'S2', enabled: true }
        ]
      }
    });
    expect(Object.keys(store.getState().sources.sources)).toEqual(['s1', 's2']);
  });
});
