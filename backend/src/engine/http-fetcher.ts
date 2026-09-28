import { BackoffStrategy, DEFAULT_RETRY, retryDelayMs } from './retry';

export interface FetchOptions {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxAttempts?: number;
  /** First backoff delay in ms (default DEFAULT_RETRY.initialDelayMs). */
  initialDelayMs?: number;
  /** Upper bound for a single backoff delay in ms. */
  maxDelayMs?: number;
  /** How the delay grows between attempts (default exponential). */
  backoff?: BackoffStrategy;
  /** Request body, sent as-is (callers encode JSON / form bodies). */
  body?: string;
  /** Abort (without retrying) once the body exceeds this many bytes. Default 50 MB. */
  maxResponseBytes?: number;
}

export const DEFAULT_MAX_RESPONSE_BYTES = 50 * 1024 * 1024;

/** A response over `maxResponseBytes`. Not retried: the next attempt would be as large. */
export class ResponseTooLargeError extends Error {
  constructor(limit: number) {
    super(`response exceeds max_response_bytes (${limit})`);
    this.name = 'ResponseTooLargeError';
  }
}

/**
 * Read a response body as UTF-8 text, aborting as soon as it grows past `limit` bytes
 * (checked against Content-Length first, then while streaming).
 */
export async function readTextLimited(response: Response, limit: number): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) {
    await response.body?.cancel().catch(() => undefined);
    throw new ResponseTooLargeError(limit);
  }
  if (!response.body) return '';

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      throw new ResponseTooLargeError(limit);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

const USER_AGENT = 'MK-OSINT/1.0';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch a URL as text with a hard timeout and backoff retries (exponential by default).
 * Throws the last error once every attempt has been exhausted - failures are never
 * swallowed here; the caller (scheduler) decides how to log and continue.
 */
export async function fetchUrl(options: FetchOptions): Promise<string> {
  const {
    url,
    method = 'GET',
    headers = {},
    timeoutMs = 10000,
    maxAttempts = DEFAULT_RETRY.maxAttempts,
    initialDelayMs = DEFAULT_RETRY.initialDelayMs,
    maxDelayMs = DEFAULT_RETRY.maxDelayMs,
    backoff = DEFAULT_RETRY.backoff,
    body,
    maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES
  } = options;

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method,
        headers: { 'User-Agent': USER_AGENT, ...headers },
        body,
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await readTextLimited(response, maxResponseBytes);
    } catch (err) {
      if (err instanceof ResponseTooLargeError) throw err;
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxAttempts) {
        await sleep(retryDelayMs(attempt, backoff, initialDelayMs, maxDelayMs));
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw lastError || new Error(`Failed to fetch URL ${url}`);
}
