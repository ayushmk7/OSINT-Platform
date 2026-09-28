import { applyAuth } from '../auth';
import { maskSecrets, referencedSecretValues, substituteEnv } from '../env';
import { TransportExtras } from '../transport-config';

/** The subset of a source's transport block needed to build a request. */
export type TransportLike = TransportExtras & {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  timeout?: string | number;
};

/** A fully resolved request: placeholders substituted, auth applied, body encoded. */
export interface ResolvedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  /** Resolved secret strings, for `maskSecrets` on anything that gets logged. */
  secrets: string[];
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const lower = name.toLowerCase();
  return Object.keys(headers).some((h) => h.toLowerCase() === lower);
}

function encodeBody(
  body: TransportExtras['body'],
  contentType: string | undefined
): { body?: string; contentType?: string } {
  if (body === undefined || body === null) return {};
  if (typeof body === 'string') return { body, contentType };
  const type = contentType ?? 'application/json';
  if (type.toLowerCase().startsWith('application/x-www-form-urlencoded') && !Array.isArray(body)) {
    const form = new URLSearchParams();
    for (const [k, v] of Object.entries(body)) {
      form.set(k, typeof v === 'string' ? v : JSON.stringify(v));
    }
    return { body: form.toString(), contentType: type };
  }
  return { body: JSON.stringify(body), contentType: type };
}

/**
 * Resolve `${NAME}` placeholders (throws MissingEnvError), apply `auth`, and encode the body.
 * Done per request so env changes and OAuth2 token refreshes are always picked up.
 */
export async function resolveRequest(
  transport: TransportLike,
  timeoutMs = 10000
): Promise<ResolvedRequest> {
  const secrets = referencedSecretValues({
    url: transport.url,
    headers: transport.headers,
    body: transport.body,
    auth: transport.auth,
    subscribe: transport.subscribe
  });
  const url = substituteEnv(transport.url);
  const headers = substituteEnv(transport.headers ?? {});
  const auth = transport.auth ? substituteEnv(transport.auth) : undefined;
  const rawBody = substituteEnv(transport.body);

  let authed;
  try {
    authed = await applyAuth(auth, url, headers, timeoutMs);
  } catch (err) {
    throw maskedError(err, secrets);
  }
  secrets.push(...authed.secrets);

  const { body, contentType } = encodeBody(rawBody, transport.content_type);
  if (contentType && !hasHeader(authed.headers, 'content-type')) {
    authed.headers['Content-Type'] = contentType;
  }

  return {
    url: authed.url,
    method: (transport.method || (body !== undefined ? 'POST' : 'GET')).toUpperCase(),
    headers: authed.headers,
    body,
    secrets
  };
}

/** Wrap any thrown value in an Error whose message has every secret masked. */
export function maskedError(err: unknown, secrets: string[]): Error {
  const message = err instanceof Error ? err.message : String(err);
  const masked = new Error(maskSecrets(message, secrets));
  masked.name = err instanceof Error ? err.name : 'Error';
  return masked;
}
