/**
 * Retry policy shared by the HTTP fetcher and the scheduler. Kept in its own module (no I/O)
 * so tests that mock the fetcher still see the real defaults.
 */

/** Supported `transport.retry.backoff` strategies. */
export const BACKOFF_STRATEGIES = ['exponential', 'linear', 'fixed'] as const;
export type BackoffStrategy = (typeof BACKOFF_STRATEGIES)[number];

/**
 * The ONE default retry policy. The scheduler (YAML `transport.retry`) and direct callers of
 * `fetchUrl` both fall back to these values, so there is no second set of defaults to drift.
 */
export const DEFAULT_RETRY = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 15000,
  backoff: 'exponential' as BackoffStrategy
};

/**
 * Delay before retry number `attempt` (1-based: the wait after the first failure is attempt 1).
 *   exponential: initial * 2^(attempt-1)   linear: initial * attempt   fixed: initial
 * Always capped at `maxDelayMs`.
 */
export function retryDelayMs(
  attempt: number,
  backoff: BackoffStrategy,
  initialDelayMs: number,
  maxDelayMs: number
): number {
  let delay: number;
  switch (backoff) {
    case 'fixed':
      delay = initialDelayMs;
      break;
    case 'linear':
      delay = initialDelayMs * attempt;
      break;
    default:
      delay = initialDelayMs * Math.pow(2, attempt - 1);
  }
  return Math.min(delay, maxDelayMs);
}
