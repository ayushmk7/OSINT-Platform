import { applyAuth, clearTokenCache } from '../engine/auth';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

describe('transport.auth', () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    clearTokenCache();
    fetchSpy = jest.spyOn(global, 'fetch');
  });
  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('bearer sets Authorization', async () => {
    const r = await applyAuth({ type: 'bearer', token: 'tok-1' }, 'https://x/', { A: 'b' });
    expect(r.headers).toEqual({ A: 'b', Authorization: 'Bearer tok-1' });
    expect(r.secrets).toContain('tok-1');
  });

  it('basic sets a base64 Authorization header', async () => {
    const r = await applyAuth({ type: 'basic', username: 'u', password: 'p@ss' }, 'https://x/', {});
    expect(r.headers.Authorization).toBe('Basic ' + Buffer.from('u:p@ss').toString('base64'));
    expect(r.secrets).toContain('p@ss');
  });

  it('api_key goes into a header by default, or the query string', async () => {
    const h = await applyAuth(
      { type: 'api_key', name: 'X-Api-Key', value: 'k1' },
      'https://x/a?b=1',
      {}
    );
    expect(h.headers['X-Api-Key']).toBe('k1');
    expect(h.url).toBe('https://x/a?b=1');

    const q = await applyAuth(
      { type: 'api_key', in: 'query', name: 'apikey', value: 'k 2' },
      'https://x/a?b=1',
      {}
    );
    expect(q.url).toBe('https://x/a?b=1&apikey=k+2');

    // Shorthands: `header: Name` / `query: name`.
    const s1 = await applyAuth({ type: 'api_key', query: 'token', value: 'k3' }, 'https://x/', {});
    expect(s1.url).toBe('https://x/?token=k3');
    const s2 = await applyAuth({ type: 'api_key', header: 'X-K', value: 'k4' }, 'https://x/', {});
    expect(s2.headers['X-K']).toBe('k4');
  });

  it('oauth2_client_credentials fetches a token once and caches it until expiry', async () => {
    fetchSpy.mockImplementation(async () =>
      jsonResponse({ access_token: 'AT1', expires_in: 3600 })
    );
    const auth = {
      type: 'oauth2_client_credentials' as const,
      token_url: 'https://auth.example/token',
      client_id: 'cid',
      client_secret: 'csecret',
      scope: 'read'
    };
    const a = await applyAuth(auth, 'https://x/', {});
    const b = await applyAuth(auth, 'https://x/', {});
    expect(a.headers.Authorization).toBe('Bearer AT1');
    expect(b.headers.Authorization).toBe('Bearer AT1');
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://auth.example/token');
    expect(init.method).toBe('POST');
    const form = new URLSearchParams(init.body);
    expect(form.get('grant_type')).toBe('client_credentials');
    expect(form.get('client_id')).toBe('cid');
    expect(form.get('client_secret')).toBe('csecret');
    expect(form.get('scope')).toBe('read');
    expect(a.secrets).toEqual(expect.arrayContaining(['csecret', 'AT1']));
  });

  it('oauth2 refreshes an expired token', async () => {
    let n = 0;
    fetchSpy.mockImplementation(async () =>
      jsonResponse({ access_token: `T${++n}`, expires_in: 1 })
    );
    const auth = {
      type: 'oauth2_client_credentials' as const,
      token_url: 'https://auth.example/token',
      client_id: 'cid',
      client_secret: 'cs',
      client_auth: 'basic' as const
    };
    // expires_in (1s) is inside the 30s refresh skew, so every call refetches.
    expect((await applyAuth(auth, 'https://x/', {})).headers.Authorization).toBe('Bearer T1');
    expect((await applyAuth(auth, 'https://x/', {})).headers.Authorization).toBe('Bearer T2');
    const init = fetchSpy.mock.calls[0][1];
    expect(init.headers.Authorization).toBe('Basic ' + Buffer.from('cid:cs').toString('base64'));
    expect(new URLSearchParams(init.body).get('client_secret')).toBeNull();
  });

  it('oauth2 failure reports only the status', async () => {
    fetchSpy.mockImplementation(async () => new Response('bad client csecret', { status: 401 }));
    await expect(
      applyAuth(
        {
          type: 'oauth2_client_credentials',
          token_url: 'https://auth.example/token',
          client_id: 'cid',
          client_secret: 'csecret'
        },
        'https://x/',
        {}
      )
    ).rejects.toThrow('OAuth2 token request failed: HTTP 401');
  });
});
