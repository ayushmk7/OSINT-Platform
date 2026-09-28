/**
 * Types and validation for the optional transport features: auth, request body, response
 * size cap, pagination and streaming (websocket / sse). Kept out of yaml-loader.ts so the
 * loader only needs to call `validateTransportExtras()`.
 */

export const AUTH_TYPES = ['bearer', 'api_key', 'basic', 'oauth2_client_credentials'] as const;
export type AuthType = (typeof AUTH_TYPES)[number];

export const PAGINATION_TYPES = ['page', 'offset', 'cursor'] as const;
export type PaginationType = (typeof PAGINATION_TYPES)[number];

/** `transport.type` values that open a long-lived stream instead of polling. */
export const STREAM_TRANSPORTS = ['websocket', 'sse'] as const;
export type StreamTransport = (typeof STREAM_TRANSPORTS)[number];

export function isStreamTransport(type: unknown): type is StreamTransport {
  return (STREAM_TRANSPORTS as readonly unknown[]).includes(type);
}

export interface AuthConfig {
  type: AuthType;
  /** bearer */
  token?: string;
  /** api_key: where the key goes (default `header`). */
  in?: 'header' | 'query';
  /** api_key: header or query parameter name. */
  name?: string;
  /** api_key shorthand: `header: X-Api-Key` (same as `in: header, name: X-Api-Key`). */
  header?: string;
  /** api_key shorthand: `query: apikey` (same as `in: query, name: apikey`). */
  query?: string;
  /** api_key */
  value?: string;
  /** basic */
  username?: string;
  password?: string;
  /** oauth2_client_credentials */
  token_url?: string;
  client_id?: string;
  client_secret?: string;
  scope?: string;
  /** oauth2: send client credentials as HTTP Basic (`basic`) or in the form body (`post`, default). */
  client_auth?: 'basic' | 'post';
}

export interface PaginationConfig {
  type: PaginationType;
  /** Query parameter carrying the page number / offset / cursor. */
  param: string;
  /** page: first page number (default 1). offset: first offset (default 0). */
  start?: number;
  /** Query parameter carrying the page size (optional for page, required for offset). */
  size_param?: string;
  size?: number;
  /** cursor: dot path into the parsed JSON response to the next cursor. */
  cursor_path?: string;
  /** Hard cap on requests per poll (default 10). */
  max_pages?: number;
  /** Stop at the first page that yields no records (default true). */
  stop_when_empty?: boolean;
}

/** Optional transport fields added on top of the base schema. */
export interface TransportExtras {
  auth?: AuthConfig;
  /** Request body: a string is sent verbatim, an object as JSON (or form, see content_type). */
  body?: string | Record<string, unknown> | unknown[];
  content_type?: string;
  /** Abort a response larger than this many bytes (default 50 MB). */
  max_response_bytes?: number;
  pagination?: PaginationConfig;
  /** websocket: message sent after each (re)connect; objects are JSON-encoded. */
  subscribe?: string | Record<string, unknown> | unknown[];
  /** websocket / sse: how long to buffer messages before ingesting them as one batch. */
  batch_window?: string | number;
}

export const DEFAULT_MAX_PAGES = 10;
export const DEFAULT_BATCH_WINDOW_MS = 2000;

/**
 * Parse "2s" / "500ms" / "1m" / a bare number of seconds into milliseconds (sub-second
 * precision, unlike parseDurationSeconds). Returns `fallback` when absent or unusable.
 */
export function parseDurationMs(value: string | number | undefined, fallback: number): number {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'number')
    return Number.isFinite(value) && value > 0 ? value * 1000 : fallback;
  const match = /^\s*(\d+(?:\.\d+)?)\s*(ms|s|m|h)?\s*$/i.exec(value);
  if (!match) return fallback;
  const amount = Number(match[1]);
  if (!(amount > 0)) return fallback;
  const unit = { ms: 1, s: 1000, m: 60000, h: 3600000 }[
    (match[2] || 's').toLowerCase() as 'ms' | 's' | 'm' | 'h'
  ];
  return Math.round(amount * unit);
}

const isStr = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
const isPosInt = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0;

function validateAuth(auth: unknown): string[] {
  if (!auth || typeof auth !== 'object' || Array.isArray(auth)) {
    return ['transport.auth must be a mapping'];
  }
  const a = auth as AuthConfig;
  if (!(AUTH_TYPES as readonly unknown[]).includes(a.type)) {
    return [
      `invalid transport.auth.type ${JSON.stringify(a.type)} (expected one of: ${AUTH_TYPES.join(', ')})`
    ];
  }
  const need = (fields: Array<keyof AuthConfig>): string[] =>
    fields.filter((f) => !isStr(a[f])).map((f) => `transport.auth.${f} is required for ${a.type}`);
  switch (a.type) {
    case 'bearer':
      return need(['token']);
    case 'basic':
      return need(['username', 'password']);
    case 'oauth2_client_credentials':
      return need(['token_url', 'client_id', 'client_secret']);
    case 'api_key': {
      const errors = need(['value']);
      if (!isStr(a.name ?? a.header ?? a.query)) {
        errors.push('transport.auth needs name (or header / query) for api_key');
      }
      if (a.in !== undefined && a.in !== 'header' && a.in !== 'query') {
        errors.push('transport.auth.in must be header or query');
      }
      return errors;
    }
  }
}

function validatePagination(p: unknown): string[] {
  if (!p || typeof p !== 'object' || Array.isArray(p)) {
    return ['transport.pagination must be a mapping'];
  }
  const c = p as PaginationConfig;
  if (!(PAGINATION_TYPES as readonly unknown[]).includes(c.type)) {
    return [
      `invalid transport.pagination.type ${JSON.stringify(c.type)} ` +
        `(expected one of: ${PAGINATION_TYPES.join(', ')})`
    ];
  }
  const errors: string[] = [];
  if (!isStr(c.param)) errors.push('transport.pagination.param is required');
  if (c.type === 'offset' && !isPosInt(c.size)) {
    errors.push('transport.pagination.size (positive integer) is required for offset');
  }
  if (c.type === 'cursor' && !isStr(c.cursor_path)) {
    errors.push('transport.pagination.cursor_path is required for cursor');
  }
  if (c.size !== undefined && !isPosInt(c.size)) {
    errors.push('transport.pagination.size must be a positive integer');
  }
  if (c.max_pages !== undefined && !isPosInt(c.max_pages)) {
    errors.push('transport.pagination.max_pages must be a positive integer');
  }
  if (c.start !== undefined && !Number.isInteger(c.start)) {
    errors.push('transport.pagination.start must be an integer');
  }
  return errors;
}

/** Problems with the optional transport fields (empty list = fine or absent). */
export function validateTransportExtras(transport: TransportExtras & { type?: unknown }): string[] {
  const errors: string[] = [];
  if (transport.auth !== undefined) errors.push(...validateAuth(transport.auth));
  if (transport.pagination !== undefined) {
    errors.push(...validatePagination(transport.pagination));
    if (isStreamTransport(transport.type)) {
      errors.push(`transport.pagination is not supported for ${String(transport.type)}`);
    }
  }
  if (transport.max_response_bytes !== undefined && !isPosInt(transport.max_response_bytes)) {
    errors.push('transport.max_response_bytes must be a positive integer');
  }
  if (transport.body !== undefined && transport.body !== null) {
    if (typeof transport.body !== 'string' && typeof transport.body !== 'object') {
      errors.push('transport.body must be a string or a mapping');
    }
  }
  if (transport.batch_window !== undefined && parseDurationMs(transport.batch_window, -1) === -1) {
    errors.push(`invalid transport.batch_window ${JSON.stringify(transport.batch_window)}`);
  }
  return errors;
}
