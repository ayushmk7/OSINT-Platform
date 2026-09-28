import WebSocket from 'ws';
import { substituteEnv } from '../env';
import { parseDurationMs } from '../transport-config';
import { resolveRequest } from './request';
import { StreamOptions, StreamRunner, StreamTransportConfig } from './stream';

const USER_AGENT = 'MK-OSINT/1.0';

/**
 * `transport.type: websocket`. Connects to `url` (env placeholders and `auth` applied, auth
 * headers sent on the upgrade request), sends `subscribe` after every (re)connect, and feeds
 * each text/binary message to the parser. Reconnects with backoff when the socket closes.
 */
export class WebSocketStream extends StreamRunner {
  private socket?: WebSocket;

  constructor(transport: StreamTransportConfig, options: StreamOptions) {
    super(transport, options);
  }

  protected async connect(): Promise<void> {
    const timeoutMs = parseDurationMs(this.transport.timeout, 10000);
    const request = await resolveRequest({ ...this.transport, body: undefined }, timeoutMs);
    this.secrets = request.secrets;
    const subscribe = substituteEnv(this.transport.subscribe);
    if (this.stopped) return;

    await new Promise<void>((resolve) => {
      const socket = new WebSocket(request.url, {
        headers: { 'User-Agent': USER_AGENT, ...request.headers },
        handshakeTimeout: timeoutMs
      });
      this.socket = socket;

      socket.on('open', () => {
        this.opened();
        if (subscribe !== undefined && subscribe !== null) {
          socket.send(typeof subscribe === 'string' ? subscribe : JSON.stringify(subscribe));
        }
      });
      socket.on('message', (data: WebSocket.RawData) => {
        const text = Array.isArray(data)
          ? Buffer.concat(data).toString('utf8')
          : Buffer.from(data as ArrayBuffer).toString('utf8');
        this.message(text);
      });
      socket.on('error', (err) => {
        console.warn(`Source ${this.options.name}: websocket error: ${this.mask(err)}`);
      });
      socket.on('close', () => {
        this.socket = undefined;
        resolve();
      });
    });
  }

  protected close(): void {
    const socket = this.socket;
    this.socket = undefined;
    if (!socket) return;
    if (socket.readyState === WebSocket.CONNECTING) socket.terminate();
    else socket.close();
  }
}

export function startWebSocketStream(
  transport: StreamTransportConfig,
  options: StreamOptions
): WebSocketStream {
  return new WebSocketStream(transport, options).start();
}
