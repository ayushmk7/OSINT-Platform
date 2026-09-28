import { useEffect, useRef, useState } from 'react';
import { useDispatch } from 'react-redux';
import { setInitialEntities, upsertEntity, type EntityRecord } from '../store/slices/entitiesSlice';
import { setSources, type SourceRecord } from '../store/slices/sourcesSlice';
import { addInsight, type InsightRecord } from '../store/slices/insightsSlice';

/** Canonical telemetry path — must match `WS_PATH` in the backend WebSocket server. */
export const WS_TELEMETRY_PATH = '/ws/telemetry';

export interface UseWebSocketOptions {
  /** Override the derived URL (tests point this at a mock socket). */
  url?: string;
  /** First reconnect delay in ms; each failure doubles it up to `maxReconnectInterval`. */
  reconnectInterval?: number;
  maxReconnectInterval?: number;
}

export interface WebSocketState {
  isConnected: boolean;
  isReconnecting: boolean;
  /** Messages received during the last one-second window. */
  messageRate: number;
  /** Server timestamp of the most recent frame, or null before the first frame. */
  lastSeenTimestamp: string | null;
}

interface TelemetryFrame {
  type?: string;
  timestamp?: string;
  data?: {
    entities?: EntityRecord[];
    sources?: SourceRecord[];
  } & Partial<EntityRecord>;
}

/** ws:// for http pages, wss:// for https — never hard-code the scheme. */
export function deriveTelemetryUrl(location: Pick<Location, 'protocol' | 'host'>): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}${WS_TELEMETRY_PATH}`;
}

/**
 * Live telemetry socket: connects to /ws/telemetry (through the Vite `/ws` proxy in dev),
 * pumps `initial_state` / `entity_update` frames straight into Redux, answers the server's
 * application-level `ping` heartbeat, measures throughput, and reconnects with exponential
 * backoff when the socket drops.
 */
export function useWebSocket(options: UseWebSocketOptions = {}): WebSocketState {
  const dispatch = useDispatch();
  const [isConnected, setIsConnected] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [messageRate, setMessageRate] = useState(0);
  const [lastSeenTimestamp, setLastSeenTimestamp] = useState<string | null>(null);
  const messageCountRef = useRef(0);
  const socketRef = useRef<WebSocket | null>(null);

  const wsUrl = options.url ?? deriveTelemetryUrl(window.location);
  const baseReconnectInterval = options.reconnectInterval ?? 3000;
  const maxReconnectInterval = options.maxReconnectInterval ?? 30000;

  useEffect(() => {
    let isMounted = true;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;

    const scheduleReconnect = () => {
      if (!isMounted) return;
      // Exponential backoff, capped — a backend restart must not turn into a connect storm.
      const delay = Math.min(baseReconnectInterval * 2 ** attempt, maxReconnectInterval);
      attempt += 1;
      setIsConnected(false);
      setIsReconnecting(true);
      reconnectTimer = setTimeout(connect, delay);
    };

    const connect = () => {
      if (!isMounted) return;
      let ws: WebSocket;
      try {
        ws = new WebSocket(wsUrl);
      } catch (err) {
        console.error('[ws] Failed to open telemetry socket:', err);
        scheduleReconnect();
        return;
      }
      socketRef.current = ws;

      ws.onopen = () => {
        if (!isMounted) return;
        attempt = 0;
        setIsConnected(true);
        setIsReconnecting(false);
      };

      ws.onmessage = (event: MessageEvent<string>) => {
        if (!isMounted) return;
        messageCountRef.current += 1;
        let payload: TelemetryFrame;
        try {
          payload = JSON.parse(event.data) as TelemetryFrame;
        } catch (err) {
          console.error('[ws] Failed to parse telemetry frame:', err);
          return;
        }

        if (payload.timestamp) setLastSeenTimestamp(payload.timestamp);

        if (payload.type === 'initial_state' && payload.data) {
          if (payload.data.sources) dispatch(setSources(payload.data.sources));
          if (payload.data.entities) dispatch(setInitialEntities(payload.data.entities));
        } else if (payload.type === 'entity_update' && payload.data) {
          dispatch(upsertEntity(payload.data as EntityRecord));
        } else if (payload.type === 'ai_insight' && payload.data) {
          dispatch(addInsight(payload.data as unknown as InsightRecord));
        } else if (payload.type === 'ping') {
          // Application-level heartbeat: browsers cannot answer protocol pings from JS.
          ws.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
        }
      };

      ws.onclose = () => {
        if (!isMounted) return;
        scheduleReconnect();
      };

      ws.onerror = () => {
        // `onclose` always follows, and that is where the reconnect is scheduled.
        ws.close();
      };
    };

    connect();

    const rateInterval = setInterval(() => {
      setMessageRate(messageCountRef.current);
      messageCountRef.current = 0;
    }, 1000);

    return () => {
      isMounted = false;
      clearInterval(rateInterval);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      const socket = socketRef.current;
      socketRef.current = null;
      if (socket) {
        // Drop handlers first so the teardown close does not schedule a reconnect.
        socket.onopen = null;
        socket.onmessage = null;
        socket.onclose = null;
        socket.onerror = null;
        socket.close();
      }
    };
  }, [wsUrl, baseReconnectInterval, maxReconnectInterval, dispatch]);

  return { isConnected, isReconnecting, messageRate, lastSeenTimestamp };
}
