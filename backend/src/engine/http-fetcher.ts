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
    backoff = DEFAULT_RETRY.backoff
  } = options;

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method,
        headers: { 'User-Agent': USER_AGENT, ...headers },
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.text();
    } catch (err) {
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
