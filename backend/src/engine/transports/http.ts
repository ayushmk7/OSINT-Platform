import { fetchUrl } from '../http-fetcher';
import { fetchPaginated } from '../pagination';
import { BackoffStrategy, DEFAULT_RETRY } from '../retry';
import { parseDurationMs } from '../transport-config';
import { TransportLike, maskedError, resolveRequest } from './request';

export type HttpTransport = TransportLike & {
  retry?: {
    max_attempts?: number;
    backoff?: BackoffStrategy;
    initial_delay?: string;
    max_delay?: string;
  };
};

/**
 * One HTTP poll: resolve env/auth, fetch (every page when `pagination` is set), and return
 * the parsed records of all pages concatenated. `parse` turns one response body into
 * records (the scheduler's configured parser). Errors are re-thrown with secrets masked.
 */
export async function fetchHttpRecords(
  transport: HttpTransport,
  parse: (content: string) => unknown[]
): Promise<unknown[]> {
  const timeoutMs = parseDurationMs(transport.timeout, 10000);
  const request = await resolveRequest(transport, timeoutMs);

  const fetchPage = (url: string): Promise<string> =>
    fetchUrl({
      url,
      method: request.method,
      headers: request.headers,
      body: request.body,
      timeoutMs,
      maxResponseBytes: transport.max_response_bytes,
      maxAttempts: transport.retry?.max_attempts ?? DEFAULT_RETRY.maxAttempts,
      initialDelayMs: parseDurationMs(transport.retry?.initial_delay, DEFAULT_RETRY.initialDelayMs),
      maxDelayMs: parseDurationMs(transport.retry?.max_delay, DEFAULT_RETRY.maxDelayMs),
      backoff: transport.retry?.backoff ?? DEFAULT_RETRY.backoff
    });

  try {
    if (transport.pagination) {
      return await fetchPaginated(transport.pagination, request.url, fetchPage, parse);
    }
    return parse(await fetchPage(request.url));
  } catch (err) {
    throw maskedError(err, request.secrets);
  }
}
