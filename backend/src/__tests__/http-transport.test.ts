import { clearTokenCache } from '../engine/auth';
import { ResponseTooLargeError, fetchUrl } from '../engine/http-fetcher';
import { parsePayload } from '../engine/parsers';
import { fetchHttpRecords } from '../engine/transports/http';

type Handler = (url: URL, init: RequestInit) => Response | Promise<Response>;

const json = (body: unknown): Response =>
  new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });

const parseJson =
  (recordsPath?: string) =>
  (content: string): unknown[] =>
    parsePayload(content, 'json', recordsPath);

describe('HTTP transport: env, auth, body, size cap, pagination', () => {
  let fetchSpy: jest.SpyInstance;
  let calls: Array<{ url: URL; init: RequestInit }>;

  const route = (handler: Handler): void => {
    fetchSpy.mockImplementation(async (input: string, init: RequestInit) => {
      const url = new URL(input);
      calls.push({ url, init });
      return handler(url, init);
    });
  };

  beforeEach(() => {
    calls = [];
    clearTokenCache();
    fetchSpy = jest.spyOn(global, 'fetch');
    process.env.MKOSINT_T_KEY = 'super-secret-key';
  });
  afterEach(() => {
    fetchSpy.mockRestore();
    delete process.env.MKOSINT_T_KEY;
  });

  it('substitutes env into url and headers at request time', async () => {
    route(() => json([{ id: 1 }]));
    const records = await fetchHttpRecords(
      {
        url: 'https://api.test/v1?key=${MKOSINT_T_KEY}&region=${MKOSINT_T_REGION:-eu}',
        headers: { 'X-Key': '${MKOSINT_T_KEY}' }
      },
      parseJson()
    );
    expect(records).toEqual([{ id: 1 }]);
    expect(calls[0].url.searchParams.get('key')).toBe('super-secret-key');
    expect(calls[0].url.searchParams.get('region')).toBe('eu');
    expect((calls[0].init.headers as Record<string, string>)['X-Key']).toBe('super-secret-key');
  });

  it('masks secrets in thrown errors', async () => {
    route(() => {
      throw new Error('connect failed for https://api.test/?key=super-secret-key');
    });
    const err = await fetchHttpRecords(
      {
        url: 'https://api.test/?key=${MKOSINT_T_KEY}',
        retry: { max_attempts: 1 }
      },
      parseJson()
    ).catch((e: Error) => e);
    expect(String(err)).toContain('key=***');
    expect(String(err)).not.toContain('super-secret-key');
  });

  it('sends a POST with a JSON body (object) and custom content_type (string)', async () => {
    route(() => json([]));
    await fetchHttpRecords(
      { url: 'https://api.test/q', method: 'POST', body: { q: '${MKOSINT_T_KEY}', n: 2 } },
      parseJson()
    );
    expect(calls[0].init.method).toBe('POST');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ q: 'super-secret-key', n: 2 });
    expect((calls[0].init.headers as Record<string, string>)['Content-Type']).toBe(
      'application/json'
    );

    await fetchHttpRecords(
      { url: 'https://api.test/q', body: '[out:json];node(1);out;', content_type: 'text/plain' },
      parseJson()
    );
    expect(calls[1].init.method).toBe('POST'); // body without method implies POST
    expect(calls[1].init.body).toBe('[out:json];node(1);out;');
    expect((calls[1].init.headers as Record<string, string>)['Content-Type']).toBe('text/plain');

    await fetchHttpRecords(
      {
        url: 'https://api.test/q',
        body: { a: 'x y', b: 1 },
        content_type: 'application/x-www-form-urlencoded'
      },
      parseJson()
    );
    expect(calls[2].init.body).toBe('a=x+y&b=1');
  });

  it('applies auth from the transport block', async () => {
    route(() => json([]));
    await fetchHttpRecords(
      {
        url: 'https://api.test/',
        auth: { type: 'api_key', in: 'query', name: 'apikey', value: '${MKOSINT_T_KEY}' }
      },
      parseJson()
    );
    expect(calls[0].url.searchParams.get('apikey')).toBe('super-secret-key');
  });

  it('enforces max_response_bytes while reading (Content-Length and streamed)', async () => {
    route(() => new Response('x'.repeat(100), { headers: { 'Content-Length': '100' } }));
    await expect(
      fetchUrl({ url: 'https://api.test/', maxResponseBytes: 50, maxAttempts: 3 })
    ).rejects.toBeInstanceOf(ResponseTooLargeError);
    expect(calls).toHaveLength(1); // not retried

    route(() => {
      const chunk = new TextEncoder().encode('y'.repeat(40));
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(chunk);
          controller.enqueue(chunk);
          controller.close();
        }
      });
      return new Response(stream);
    });
    await expect(
      fetchHttpRecords({ url: 'https://api.test/', max_response_bytes: 50 }, parseJson())
    ).rejects.toThrow(/max_response_bytes/);
    expect(await fetchUrl({ url: 'https://api.test/', maxResponseBytes: 80 })).toHaveLength(80);
  });

  it('page pagination: walks pages until an empty page', async () => {
    route((url) => {
      const page = Number(url.searchParams.get('page'));
      return json({ items: page <= 3 ? [{ id: page }] : [] });
    });
    const records = await fetchHttpRecords(
      {
        url: 'https://api.test/list',
        pagination: { type: 'page', param: 'page', start: 1, size_param: 'per_page' }
      },
      parseJson('items')
    );
    expect(records).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    expect(calls.map((c) => c.url.searchParams.get('page'))).toEqual(['1', '2', '3', '4']);
    expect(calls[0].url.searchParams.get('per_page')).toBeNull(); // no size -> no size param
  });

  it('page pagination respects max_pages', async () => {
    route((url) => json([{ id: url.searchParams.get('p') }]));
    const records = await fetchHttpRecords(
      { url: 'https://api.test/', pagination: { type: 'page', param: 'p', max_pages: 2 } },
      parseJson()
    );
    expect(records).toEqual([{ id: '1' }, { id: '2' }]);
  });

  it('offset pagination: advances by size and stops at a short page', async () => {
    const data = Array.from({ length: 5 }, (_, i) => ({ id: i }));
    route((url) => {
      const off = Number(url.searchParams.get('offset'));
      const lim = Number(url.searchParams.get('limit'));
      return json(data.slice(off, off + lim));
    });
    const records = await fetchHttpRecords(
      {
        url: 'https://api.test/',
        pagination: { type: 'offset', param: 'offset', size_param: 'limit', size: 2 }
      },
      parseJson()
    );
    expect(records).toEqual(data);
    expect(calls.map((c) => c.url.searchParams.get('offset'))).toEqual(['0', '2', '4']);
  });

  it('cursor pagination: follows cursor_path until it is absent', async () => {
    const pages: Record<string, unknown> = {
      '': { data: [{ id: 'a' }], meta: { next: 'c2' } },
      c2: { data: [{ id: 'b' }], meta: { next: 'c3' } },
      c3: { data: [{ id: 'c' }], meta: { next: null } }
    };
    route((url) => json(pages[url.searchParams.get('cursor') ?? '']));
    const records = await fetchHttpRecords(
      {
        url: 'https://api.test/',
        pagination: { type: 'cursor', param: 'cursor', cursor_path: 'meta.next' }
      },
      parseJson('data')
    );
    expect(records.map((r) => (r as { id: string }).id)).toEqual(['a', 'b', 'c']);
    expect(calls[0].url.searchParams.has('cursor')).toBe(false);
  });

  it('cursor pagination stops on a repeated cursor', async () => {
    route(() => json({ data: [{ id: 1 }], next: 'same' }));
    const records = await fetchHttpRecords(
      {
        url: 'https://api.test/',
        pagination: { type: 'cursor', param: 'c', cursor_path: 'next', max_pages: 50 }
      },
      parseJson('data')
    );
    expect(calls).toHaveLength(2);
    expect(records).toHaveLength(2);
  });
});
