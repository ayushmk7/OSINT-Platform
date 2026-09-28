import { spawn } from 'child_process';
import Database from 'better-sqlite3';
import { HAVERSINE_JS, registerSqlFunctions } from './sql-functions';
import { looksLikeSelect } from './loader';

/** Rows returned by one SQL analysis input, regardless of the query's own LIMIT. */
export const SQL_ROW_CAP = 500;
export const SQL_TIMEOUT_MS = 5_000;

export class SqlGuardError extends Error {}

export interface SqlParams {
  /** ISO timestamp `now - lookback`, bound as `:since` when the query references it. */
  since: string;
  /** ISO timestamp of the run, bound as `:now` when referenced. */
  now: string;
}

/** Only the named parameters the statement actually uses — better-sqlite3 rejects extras. */
export function bindParams(sql: string, params: SqlParams): Record<string, string> {
  const out: Record<string, string> = {};
  if (/[:@$]since\b/.test(sql)) out.since = params.since;
  if (/[:@$]now\b/.test(sql)) out.now = params.now;
  return out;
}

/**
 * The read-only gate: a single statement that SQLite itself reports as read-only and as
 * returning rows. `stmt.readonly` is authoritative (it is `sqlite3_stmt_readonly`), so
 * `DELETE ... RETURNING`, `PRAGMA x = y`, `ATTACH`, CTE-wrapped writes etc. are all refused.
 * Throws SqlGuardError on violation. The connection must have `haversine_km` registered.
 */
export function assertReadOnlySql(db: Database.Database, sql: string): void {
  if (!looksLikeSelect(sql)) {
    throw new SqlGuardError('only a single SELECT statement is allowed');
  }
  let stmt: Database.Statement;
  try {
    stmt = db.prepare(sql);
  } catch (err) {
    throw new SqlGuardError(`SQL does not compile: ${(err as Error).message}`);
  }
  if (!stmt.readonly || !stmt.reader) {
    throw new SqlGuardError('SQL must be a read-only statement that returns rows');
  }
}

export interface QueryResult {
  rows: Record<string, unknown>[];
  truncated: boolean;
}

function capRows(
  stmt: Database.Statement,
  params: Record<string, string>,
  cap: number
): QueryResult {
  const rows: Record<string, unknown>[] = [];
  let truncated = false;
  for (const row of stmt.iterate(params) as Iterable<Record<string, unknown>>) {
    if (rows.length >= cap) {
      truncated = true;
      break;
    }
    rows.push(row);
  }
  return { rows, truncated };
}

/**
 * Script run by the query child process. Reads one JSON job from stdin, writes one JSON result
 * to stdout. A child process (not a worker thread) because a runaway query sits inside native
 * SQLite code where `worker.terminate()` cannot reach it — only a process kill stops it.
 */
const CHILD_SOURCE = `
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { input += c; });
process.stdin.on('end', () => {
  const job = JSON.parse(input);
  let db;
  let out;
  try {
    const Database = require(job.driver);
    db = new Database(job.file, { readonly: true, fileMustExist: true });
    db.function('haversine_km', { deterministic: true }, ${HAVERSINE_JS});
    const stmt = db.prepare(job.sql);
    if (!stmt.readonly || !stmt.reader) throw new Error('SQL must be a read-only statement that returns rows');
    const rows = [];
    let truncated = false;
    for (const row of stmt.iterate(job.params)) {
      if (rows.length >= job.cap) { truncated = true; break; }
      rows.push(row);
    }
    out = { ok: true, rows, truncated };
  } catch (err) {
    out = { ok: false, error: String((err && err.message) || err) };
  } finally {
    if (db) db.close();
  }
  process.stdout.write(JSON.stringify(out));
});
`;

interface ChildResult {
  ok: boolean;
  rows?: QueryResult['rows'];
  truncated?: boolean;
  error?: string;
}

/**
 * Runs a guarded SELECT. For a file-backed database the query executes in a short-lived child
 * process on a SEPARATE `readonly` connection and is SIGKILLed after `timeoutMs`, so an
 * analyst's runaway join can neither block the event loop nor write anything. An in-memory
 * database (tests) has no file to reopen, so it falls back to the given connection — still
 * gated by `stmt.readonly` and the row cap, but without the timeout.
 */
export async function runReadOnlyQuery(
  db: Database.Database,
  sql: string,
  params: SqlParams,
  options: { rowCap?: number; timeoutMs?: number } = {}
): Promise<QueryResult> {
  const cap = Math.min(options.rowCap ?? SQL_ROW_CAP, SQL_ROW_CAP);
  const timeoutMs = options.timeoutMs ?? SQL_TIMEOUT_MS;
  const bound = bindParams(sql, params);

  registerSqlFunctions(db);
  assertReadOnlySql(db, sql);

  if (db.memory || !db.name) {
    return capRows(db.prepare(sql), bound, cap);
  }

  return new Promise<QueryResult>((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', CHILD_SOURCE], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (child.exitCode === null) child.kill('SIGKILL');
      fn();
    };
    const timer = setTimeout(
      () => finish(() => reject(new SqlGuardError(`SQL timed out after ${timeoutMs}ms`))),
      timeoutMs
    );
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (c: string) => (stdout += c));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (c: string) => (stderr += c));
    child.on('error', (err) => finish(() => reject(new SqlGuardError(err.message))));
    child.on('close', () =>
      finish(() => {
        let msg: ChildResult;
        try {
          msg = JSON.parse(stdout) as ChildResult;
        } catch {
          reject(new SqlGuardError(`query process failed: ${stderr.trim().slice(0, 300)}`));
          return;
        }
        if (msg.ok) resolve({ rows: msg.rows ?? [], truncated: Boolean(msg.truncated) });
        else reject(new SqlGuardError(msg.error ?? 'query failed'));
      })
    );
    child.stdin.end(
      JSON.stringify({
        driver: require.resolve('better-sqlite3'),
        file: db.name,
        sql,
        params: bound,
        cap
      })
    );
  });
}
