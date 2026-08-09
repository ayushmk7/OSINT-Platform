export interface FetchOptions {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxAttempts?: number;
  /** First backoff delay in ms; each subsequent attempt doubles it. */
  initialDelayMs?: number;
  /** Upper bound for a single backoff delay in ms. */
  maxDelayMs?: number;
}

const USER_AGENT = 'ReconVillage-OSINT/1.0';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch a URL as text with a hard timeout and exponential-backoff retries.
 * Throws the last error once every attempt has been exhausted - failures are never
 * swallowed here; the caller (scheduler) decides how to log and continue.
 */
export async function fetchUrl(options: FetchOptions): Promise<string> {
  const {
    url,
    method = 'GET',
    headers = {},
    timeoutMs = 10000,
    maxAttempts = 3,
    initialDelayMs = 400,
    maxDelayMs = 15000
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
        await sleep(Math.min(initialDelayMs * Math.pow(2, attempt - 1), maxDelayMs));
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw lastError || new Error(`Failed to fetch URL ${url}`);
}
