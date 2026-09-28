import { parseDurationMs } from '../transport-config';
import { resolveRequest } from './request';
import { StreamOptions, StreamRunner, StreamTransportConfig } from './stream';

const USER_AGENT = 'MK-OSINT/1.0';

/**
 * Incremental Server-Sent Events decoder: feed it text chunks, it calls `onEvent` with the
 * joined `data:` lines of every complete event. Comments (`:`) and other fields are ignored
 * except `id:`, which is remembered for `Last-Event-ID` on reconnect.
 */
export class SseDecoder {
  private pending = '';
  private data: string[] = [];
  public lastEventId?: string;

  constructor(private readonly onEvent: (data: string) => void) {}

  public push(chunk: string): void {
    this.pending += chunk;
    let idx: number;
    while ((idx = this.pending.search(/\r\n|\r|\n/)) !== -1) {
      const line = this.pending.slice(0, idx);
      const sepLen = this.pending.startsWith('\r\n', idx) ? 2 : 1;
      // A lone trailing '\r' may be the first half of '\r\n'; wait for more input.
      if (sepLen === 1 && this.pending[idx] === '\r' && idx === this.pending.length - 1) break;
      this.pending = this.pending.slice(idx + sepLen);
      this.line(line);
    }
  }

  private line(line: string): void {
    if (line === '') {
      if (this.data.length > 0) this.onEvent(this.data.join('\n'));
      this.data = [];
      return;
    }
    if (line.startsWith(':')) return;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') this.data.push(value);
    else if (field === 'id') this.lastEventId = value;
  }
}

/**
 * `transport.type: sse`. A streaming GET (or POST when `body` is set) read with fetch; each
 * event's data is one message for the parser. Reconnects with backoff when the stream ends.
 */
export class SseStream extends StreamRunner {
  private controller?: AbortController;
  private decoder = new SseDecoder((data) => this.message(data));

  constructor(transport: StreamTransportConfig, options: StreamOptions) {
    super(transport, options);
  }

  protected async connect(): Promise<void> {
    const timeoutMs = parseDurationMs(this.transport.timeout, 10000);
    const request = await resolveRequest(this.transport, timeoutMs);
    this.secrets = request.secrets;
    if (this.stopped) return;

    const controller = new AbortController();
    this.controller = controller;
    const headers: Record<string, string> = {
      'User-Agent': USER_AGENT,
      Accept: 'text/event-stream',
      ...request.headers
    };
    if (this.decoder.lastEventId) headers['Last-Event-ID'] = this.decoder.lastEventId;

    const connectTimer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(request.url, {
        method: request.method,
        headers,
        body: request.body,
        signal: controller.signal
      });
      clearTimeout(connectTimer);
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      if (!response.body) return;
      this.opened();

      const reader = response.body.getReader();
      const text = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        this.decoder.push(text.decode(value, { stream: true }));
      }
    } catch (err) {
      if (this.stopped) return;
      throw err;
    } finally {
      clearTimeout(connectTimer);
      this.controller = undefined;
    }
  }

  protected close(): void {
    this.controller?.abort();
  }
}

export function startSseStream(
  transport: StreamTransportConfig,
  options: StreamOptions
): SseStream {
  return new SseStream(transport, options).start();
}
