import { maskSecrets } from '../env';
import { BackoffStrategy, DEFAULT_RETRY, retryDelayMs } from '../retry';
import { DEFAULT_BATCH_WINDOW_MS, parseDurationMs } from '../transport-config';
import { TransportLike } from './request';

export type StreamTransportConfig = TransportLike & {
  type: string;
  retry?: { backoff?: BackoffStrategy; initial_delay?: string; max_delay?: string };
};

export interface StreamOptions {
  /** Source name, for log lines. */
  name: string;
  /** Turn ONE message into records (the source's parser, records_path applied per message). */
  parse: (message: string) => unknown[];
  /** Called with every non-empty batch, once per batch window. */
  onBatch: (records: unknown[]) => void | Promise<void>;
}

export interface StreamHandle {
  stop(): void;
}

/** Longest wait between reconnect attempts when `retry.max_delay` is not set. */
export const DEFAULT_STREAM_MAX_DELAY_MS = 60_000;

/**
 * Shared plumbing for streaming transports: buffers parsed records and flushes them every
 * `batch_window`, and reconnects with the source's `retry` backoff (attempt counter resets
 * once a connection opens). A subclass supplies `connect()`, which resolves when the
 * connection ends (cleanly or not) and calls `opened()` / `message()` along the way.
 */
export abstract class StreamRunner implements StreamHandle {
  protected stopped = false;
  protected secrets: string[] = [];
  private buffer: unknown[] = [];
  private flushTimer?: NodeJS.Timeout;
  private reconnectTimer?: NodeJS.Timeout;
  private attempt = 0;
  private parseErrors = 0;

  constructor(
    protected readonly transport: StreamTransportConfig,
    protected readonly options: StreamOptions
  ) {}

  /** Open the connection; resolve when it has closed. */
  protected abstract connect(): Promise<void>;
  /** Tear down any open connection immediately. */
  protected abstract close(): void;

  public start(): this {
    const windowMs = parseDurationMs(this.transport.batch_window, DEFAULT_BATCH_WINDOW_MS);
    this.flushTimer = setInterval(() => void this.flush(), windowMs);
    void this.loop();
    return this;
  }

  public stop(): void {
    this.stopped = true;
    if (this.flushTimer) clearInterval(this.flushTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.close();
    void this.flush();
  }

  protected opened(): void {
    this.attempt = 0;
    console.log(`Source ${this.options.name}: ${this.transport.type} stream connected`);
  }

  protected message(text: string): void {
    try {
      this.buffer.push(...this.options.parse(text));
    } catch (err) {
      // One bad frame must not kill the stream; report the first and then every 100th.
      if (this.parseErrors++ % 100 === 0) {
        console.warn(
          `Source ${this.options.name}: unparseable stream message ` +
            `(${this.parseErrors} so far): ${this.mask(err)}`
        );
      }
    }
  }

  protected mask(err: unknown): string {
    return maskSecrets(err instanceof Error ? err.message : String(err), this.secrets);
  }

  /** Ingest everything buffered so far as one batch. */
  public async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const batch = this.buffer;
    this.buffer = [];
    try {
      await this.options.onBatch(batch);
    } catch (err) {
      console.error(
        `Source ${this.options.name}: failed to ingest stream batch: ${this.mask(err)}`
      );
    }
  }

  private async loop(): Promise<void> {
    if (this.stopped) return;
    try {
      await this.connect();
    } catch (err) {
      console.warn(`Source ${this.options.name}: ${this.transport.type} error: ${this.mask(err)}`);
    }
    if (this.stopped) return;
    const retry = this.transport.retry;
    const delay = retryDelayMs(
      ++this.attempt,
      retry?.backoff ?? DEFAULT_RETRY.backoff,
      parseDurationMs(retry?.initial_delay, DEFAULT_RETRY.initialDelayMs),
      parseDurationMs(retry?.max_delay, DEFAULT_STREAM_MAX_DELAY_MS)
    );
    console.warn(
      `Source ${this.options.name}: ${this.transport.type} disconnected; reconnecting in ${delay}ms`
    );
    this.reconnectTimer = setTimeout(() => void this.loop(), delay);
  }
}
