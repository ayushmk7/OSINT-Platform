/**
 * Durations and schedules for analyses.
 *
 * - Duration: `<number><unit>` with unit ms | s | m | h | d (e.g. `90s`, `15m`, `7d`).
 * - Schedule: either a duration (`15m` = every 15 minutes, minimum 10s) or a 5-field cron
 *   expression `minute hour day-of-month month day-of-week`, evaluated in UTC. Each field accepts
 *   `*`, numbers, ranges `a-b`, lists `a,b,c` and steps (`*` or a range followed by `/n`).
 *   Day-of-week is 0-6 with 0 = Sunday (7 is accepted as Sunday too). When both day fields are
 *   restricted, a day matches if EITHER matches (classic cron semantics).
 */

const UNIT_MS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000
};

/** Parses `15m` / `2h` / `7d` into milliseconds. Returns null when invalid or not positive. */
export function parseDurationMs(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value * 1000 : null;
  if (typeof value !== 'string') return null;
  const match = /^\s*(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)\s*$/i.exec(value);
  if (!match) return null;
  const ms = Number(match[1]) * UNIT_MS[match[2].toLowerCase()];
  return Number.isFinite(ms) && ms > 0 ? Math.round(ms) : null;
}

export interface CronSpec {
  minutes: Set<number>;
  hours: Set<number>;
  daysOfMonth: Set<number>;
  months: Set<number>;
  daysOfWeek: Set<number>;
  domRestricted: boolean;
  dowRestricted: boolean;
}

export type Schedule =
  | { kind: 'interval'; everyMs: number; source: string }
  | { kind: 'cron'; cron: CronSpec; source: string };

/** Smallest interval an analysis may run at — an LLM call every few seconds is never intended. */
export const MIN_INTERVAL_MS = 10_000;

function parseCronField(field: string, min: number, max: number): Set<number> | null {
  const out = new Set<number>();
  for (const part of field.split(',')) {
    const m = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(part);
    if (!m) return null;
    let lo = min;
    let hi = max;
    if (m[1] !== '*') {
      lo = Number(m[2]);
      hi = m[3] !== undefined ? Number(m[3]) : m[4] !== undefined ? max : lo;
    }
    const step = m[4] !== undefined ? Number(m[4]) : 1;
    if (lo < min || hi > max || lo > hi || step < 1) return null;
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out.size > 0 ? out : null;
}

export function parseCron(expr: string): CronSpec | null {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const minutes = parseCronField(fields[0], 0, 59);
  const hours = parseCronField(fields[1], 0, 23);
  const daysOfMonth = parseCronField(fields[2], 1, 31);
  const months = parseCronField(fields[3], 1, 12);
  const dowRaw = parseCronField(fields[4], 0, 7);
  if (!minutes || !hours || !daysOfMonth || !months || !dowRaw) return null;
  return {
    minutes,
    hours,
    daysOfMonth,
    months,
    daysOfWeek: new Set([...dowRaw].map((d) => d % 7)),
    domRestricted: fields[2] !== '*',
    dowRestricted: fields[4] !== '*'
  };
}

export function parseSchedule(value: unknown): Schedule | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const everyMs = parseDurationMs(value);
  if (everyMs !== null) {
    return everyMs >= MIN_INTERVAL_MS ? { kind: 'interval', everyMs, source: value } : null;
  }
  const cron = parseCron(value);
  return cron ? { kind: 'cron', cron, source: value } : null;
}

function dayMatches(cron: CronSpec, d: Date): boolean {
  const dom = cron.daysOfMonth.has(d.getUTCDate());
  const dow = cron.daysOfWeek.has(d.getUTCDay());
  if (cron.domRestricted && cron.dowRestricted) return dom || dow;
  return dom && dow;
}

/** First instant strictly after `from` at which the cron fires (UTC, minute resolution). */
export function nextCronRun(cron: CronSpec, from: Date): Date {
  const t = new Date(from.getTime());
  t.setUTCSeconds(0, 0);
  t.setUTCMinutes(t.getUTCMinutes() + 1);
  // Bounded search; an impossible spec such as `0 0 31 2 *` gives up instead of spinning.
  for (let guard = 0; guard < 100_000; guard++) {
    if (!cron.months.has(t.getUTCMonth() + 1) || !dayMatches(cron, t)) {
      t.setUTCDate(t.getUTCDate() + 1);
      t.setUTCHours(0, 0, 0, 0);
      continue;
    }
    if (!cron.hours.has(t.getUTCHours())) {
      t.setUTCHours(t.getUTCHours() + 1, 0, 0, 0);
      continue;
    }
    if (!cron.minutes.has(t.getUTCMinutes())) {
      t.setUTCMinutes(t.getUTCMinutes() + 1, 0, 0);
      continue;
    }
    return t;
  }
  throw new Error('cron expression never fires');
}

/**
 * Next run for an analysis. Interval schedules fire `everyMs` after the previous run; with no
 * previous run they fire after `firstDelayMs` (capped at the interval) so a freshly started
 * server produces a result without waiting a full, possibly 24h, interval. Cron schedules fire
 * at the next matching minute after `now`.
 */
export function nextRunTime(
  schedule: Schedule,
  now: Date,
  lastRun: Date | null,
  firstDelayMs = 60_000
): Date {
  if (schedule.kind === 'interval') {
    if (!lastRun) return new Date(now.getTime() + Math.min(firstDelayMs, schedule.everyMs));
    return new Date(Math.max(lastRun.getTime() + schedule.everyMs, now.getTime()));
  }
  return nextCronRun(schedule.cron, now);
}
