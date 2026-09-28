import { getNestedProperty } from './parsers/types';
import { DEFAULT_MAX_PAGES, PaginationConfig } from './transport-config';

/** Set (or replace) one query parameter on a URL. */
export function withQueryParam(url: string, name: string, value: string | number): string {
  const u = new URL(url);
  u.searchParams.set(name, String(value));
  return u.toString();
}

/**
 * Walk a paginated endpoint and return the records of every page, concatenated in order.
 *
 * - `page`:   param = start (default 1), start+1, ...; `size_param=size` added when both set.
 * - `offset`: param = start (default 0), start+size, ...; `size_param=size` added when set.
 * - `cursor`: first request has no cursor; each next request sets param to the value at
 *             `cursor_path` in the previous JSON response. Stops when it is empty or repeats.
 *
 * Every mode stops after `max_pages` (default 10) requests, at the first page with no records
 * (unless `stop_when_empty: false`), and for page/offset at a short page (fewer than `size`).
 * `fetchPage` does the HTTP request; `parse` is the source's normal parser.
 */
export async function fetchPaginated(
  pagination: PaginationConfig,
  baseUrl: string,
  fetchPage: (url: string) => Promise<string>,
  parse: (content: string) => unknown[]
): Promise<unknown[]> {
  const maxPages = pagination.max_pages ?? DEFAULT_MAX_PAGES;
  const stopWhenEmpty = pagination.stop_when_empty !== false;
  const size = pagination.size;
  const all: unknown[] = [];
  let cursor: string | undefined;
  const seenCursors = new Set<string>();

  for (let i = 0; i < maxPages; i++) {
    let url = baseUrl;
    if (pagination.type === 'page') {
      url = withQueryParam(url, pagination.param, (pagination.start ?? 1) + i);
    } else if (pagination.type === 'offset') {
      url = withQueryParam(url, pagination.param, (pagination.start ?? 0) + i * (size ?? 0));
    } else if (cursor !== undefined) {
      url = withQueryParam(url, pagination.param, cursor);
    }
    if (pagination.size_param && size !== undefined) {
      url = withQueryParam(url, pagination.size_param, size);
    }

    const content = await fetchPage(url);
    const records = parse(content);
    all.push(...records);

    if (records.length === 0 && stopWhenEmpty) break;

    if (pagination.type === 'cursor') {
      let next: unknown;
      try {
        next = getNestedProperty(JSON.parse(content), pagination.cursor_path);
      } catch {
        next = undefined; // not JSON: no way to find a cursor, so this was the last page
      }
      if (next === undefined || next === null || next === '' || next === false) break;
      cursor = String(next);
      if (seenCursors.has(cursor)) break; // a server returning the same cursor would loop
      seenCursors.add(cursor);
    } else if (size !== undefined && records.length < size) {
      break;
    }
  }
  return all;
}
