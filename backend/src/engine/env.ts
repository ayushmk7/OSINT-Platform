/**
 * `${NAME}` / `${NAME:-default}` substitution for source YAML, plus secret masking.
 *
 * Source files keep the placeholders; they are resolved from `process.env` only at request
 * time, so resolved secrets never reach the `sources` table, the API or the logs.
 */

const ENV_REF = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g;

type Env = Record<string, string | undefined>;

/** Thrown when a referenced variable without a default is unset or empty. */
export class MissingEnvError extends Error {
  constructor(public readonly names: string[]) {
    super(`missing env ${names.join(', ')}`);
    this.name = 'MissingEnvError';
  }
}

function isSet(value: string | undefined): value is string {
  return value !== undefined && value !== '';
}

/** Visit every string inside a JSON-like value. */
function walkStrings(value: unknown, visit: (s: string) => void): void {
  if (typeof value === 'string') visit(value);
  else if (Array.isArray(value)) value.forEach((v) => walkStrings(v, visit));
  else if (value && typeof value === 'object') {
    Object.values(value).forEach((v) => walkStrings(v, visit));
  }
}

/** Names referenced by `value` that have no default and are unset/empty in `env`. */
export function missingEnvVars(value: unknown, env: Env = process.env): string[] {
  const missing = new Set<string>();
  walkStrings(value, (s) => {
    for (const m of s.matchAll(ENV_REF)) {
      if (m[2] === undefined && !isSet(env[m[1]])) missing.add(m[1]);
    }
  });
  return [...missing];
}

/**
 * Values of every referenced variable that is actually set - the strings to mask in logs.
 * Defaults are not secrets and are not included.
 */
export function referencedSecretValues(value: unknown, env: Env = process.env): string[] {
  const secrets = new Set<string>();
  walkStrings(value, (s) => {
    for (const m of s.matchAll(ENV_REF)) {
      const v = env[m[1]];
      if (isSet(v)) secrets.add(v);
    }
  });
  return [...secrets];
}

function substituteString(s: string, env: Env): string {
  const missing: string[] = [];
  const out = s.replace(ENV_REF, (_match, name: string, fallback: string | undefined) => {
    const v = env[name];
    if (isSet(v)) return v;
    if (fallback !== undefined) return fallback;
    missing.push(name);
    return '';
  });
  if (missing.length > 0) throw new MissingEnvError(missing);
  return out;
}

/**
 * Deep copy of `value` with every placeholder resolved. Throws `MissingEnvError` if a
 * variable without a default is unset. Non-string leaves are copied as-is.
 */
export function substituteEnv<T>(value: T, env: Env = process.env): T {
  if (typeof value === 'string') return substituteString(value, env) as T;
  if (Array.isArray(value)) return value.map((v) => substituteEnv(v, env)) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = substituteEnv(v, env);
    return out as T;
  }
  return value;
}

/** The parts of a transport block that may carry `${NAME}` placeholders. */
export function envScope(transport: object | undefined): unknown {
  if (!transport) return {};
  const { url, headers, body, auth, subscribe } = transport as Record<string, unknown>;
  return { url, headers, body, auth, subscribe };
}

/** Very short values (e.g. "1") would mask unrelated text, so they are left alone. */
const MIN_MASK_LENGTH = 4;

/** Replace every occurrence of each secret (raw, URL- and form-encoded) with `***`. */
export function maskSecrets(text: string, secrets: Iterable<string>): string {
  let out = text;
  for (const secret of secrets) {
    if (!secret || secret.length < MIN_MASK_LENGTH) continue;
    const formEncoded = new URLSearchParams({ s: secret }).toString().slice(2);
    for (const variant of new Set([secret, encodeURIComponent(secret), formEncoded])) {
      out = out.split(variant).join('***');
    }
  }
  return out;
}
