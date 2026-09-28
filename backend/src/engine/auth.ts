import { AuthConfig } from './transport-config';

/**
 * Apply a (placeholder-resolved) `transport.auth` block to a request. Returns the new URL and
 * headers plus every credential-derived string, so callers can mask them in log output.
 */
export interface AuthedRequest {
  url: string;
  headers: Record<string, string>;
  secrets: string[];
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

/** OAuth2 access tokens, keyed by token_url + client_id + scope, reused until near expiry. */
const tokenCache = new Map<string, CachedToken>();
/** Refresh this long before the server-declared expiry. */
const EXPIRY_SKEW_MS = 30_000;
/** Assumed lifetime when the token response has no `expires_in`. */
const DEFAULT_TOKEN_TTL_SEC = 3600;

export function clearTokenCache(): void {
  tokenCache.clear();
}

async function fetchOAuth2Token(auth: AuthConfig, timeoutMs: number): Promise<string> {
  const key = `${auth.token_url}\n${auth.client_id}\n${auth.scope ?? ''}`;
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  const form = new URLSearchParams({ grant_type: 'client_credentials' });
  if (auth.scope) form.set('scope', auth.scope);
  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json'
  };
  if (auth.client_auth === 'basic') {
    headers.Authorization =
      'Basic ' + Buffer.from(`${auth.client_id}:${auth.client_secret}`).toString('base64');
  } else {
    form.set('client_id', auth.client_id ?? '');
    form.set('client_secret', auth.client_secret ?? '');
  }

  const response = await fetch(auth.token_url as string, {
    method: 'POST',
    headers,
    body: form.toString(),
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) {
    // The token endpoint's body can echo credentials, so only the status is reported.
    throw new Error(`OAuth2 token request failed: HTTP ${response.status}`);
  }
  const json = (await response.json()) as { access_token?: unknown; expires_in?: unknown };
  if (typeof json.access_token !== 'string' || json.access_token === '') {
    throw new Error('OAuth2 token response has no access_token');
  }
  const ttlSec = Number(json.expires_in) > 0 ? Number(json.expires_in) : DEFAULT_TOKEN_TTL_SEC;
  tokenCache.set(key, {
    token: json.access_token,
    expiresAt: Date.now() + Math.max(0, ttlSec * 1000 - EXPIRY_SKEW_MS)
  });
  return json.access_token;
}

export async function applyAuth(
  auth: AuthConfig | undefined,
  url: string,
  headers: Record<string, string>,
  timeoutMs = 10000
): Promise<AuthedRequest> {
  const out: AuthedRequest = { url, headers: { ...headers }, secrets: [] };
  if (!auth) return out;

  switch (auth.type) {
    case 'bearer': {
      const token = auth.token ?? '';
      out.headers.Authorization = `Bearer ${token}`;
      out.secrets.push(token);
      break;
    }
    case 'basic': {
      const encoded = Buffer.from(`${auth.username}:${auth.password}`).toString('base64');
      out.headers.Authorization = `Basic ${encoded}`;
      out.secrets.push(auth.password ?? '', encoded);
      break;
    }
    case 'api_key': {
      const value = auth.value ?? '';
      const location = auth.in ?? (auth.query && !auth.header && !auth.name ? 'query' : 'header');
      const name = (auth.name ?? (location === 'query' ? auth.query : auth.header)) as string;
      if (location === 'query') {
        const u = new URL(url);
        u.searchParams.set(name, value);
        out.url = u.toString();
      } else {
        out.headers[name] = value;
      }
      out.secrets.push(value);
      break;
    }
    case 'oauth2_client_credentials': {
      out.secrets.push(auth.client_secret ?? '');
      const token = await fetchOAuth2Token(auth, timeoutMs);
      out.headers.Authorization = `Bearer ${token}`;
      out.secrets.push(token);
      break;
    }
  }
  return out;
}
