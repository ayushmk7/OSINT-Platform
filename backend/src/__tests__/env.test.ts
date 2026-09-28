import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  MissingEnvError,
  envScope,
  maskSecrets,
  missingEnvVars,
  referencedSecretValues,
  substituteEnv
} from '../engine/env';
import { loadSourcesFromDir } from '../engine/yaml-loader';

describe('env substitution', () => {
  const env = { API_KEY: 'sekret-123', EMPTY: '', HOST: 'api.example.com' };

  it('replaces ${NAME} everywhere in nested values', () => {
    const out = substituteEnv(
      {
        url: 'https://${HOST}/v1?key=${API_KEY}',
        headers: { 'X-Key': '${API_KEY}' },
        body: { nested: ['${HOST}'], n: 5 }
      },
      env
    );
    expect(out).toEqual({
      url: 'https://api.example.com/v1?key=sekret-123',
      headers: { 'X-Key': 'sekret-123' },
      body: { nested: ['api.example.com'], n: 5 }
    });
  });

  it('uses ${NAME:-default} when unset or empty', () => {
    expect(substituteEnv('${NOPE:-fallback}/${EMPTY:-x}/${HOST:-y}', env)).toBe(
      'fallback/x/api.example.com'
    );
    expect(substituteEnv('${NOPE:-}', env)).toBe('');
  });

  it('throws MissingEnvError naming every missing variable', () => {
    expect(() => substituteEnv('${A_MISSING}${EMPTY}', env)).toThrow(MissingEnvError);
    expect(() => substituteEnv('${A_MISSING}${EMPTY}', env)).toThrow(/A_MISSING, EMPTY/);
  });

  it('lists missing vars (defaults do not count) and secret values', () => {
    const scope = { url: '${HOST}/${MISSING_ONE}', auth: { token: '${API_KEY}' }, x: '${D:-1}' };
    expect(missingEnvVars(scope, env)).toEqual(['MISSING_ONE']);
    expect(referencedSecretValues(scope, env).sort()).toEqual(['api.example.com', 'sekret-123']);
  });

  it('envScope picks only the substitutable transport fields', () => {
    expect(
      envScope({ url: 'u', headers: { a: 'b' }, interval: '${X}', auth: 1, body: 2, subscribe: 3 })
    ).toEqual({ url: 'u', headers: { a: 'b' }, auth: 1, body: 2, subscribe: 3 });
  });

  it('maskSecrets hides raw and url-encoded values, ignores very short ones', () => {
    expect(maskSecrets('k=a b&c, a%20b%26c, a+b%26c, x', ['a b&c', 'x'])).toBe(
      'k=***, ***, ***, x'
    );
  });
});

describe('loader: sources with missing env', () => {
  const yaml = (name: string, url: string): string => `
name: ${name}
source_type: test
layer_type: aircraft
display_name: T
transport:
  type: http_poll
  url: ${url}
  interval: 60s
parser:
  format: json
entity:
  external_id: id
  name: id
observation:
  latitude: lat
  longitude: lon
`;

  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mkosint-env-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    delete process.env.MKOSINT_TEST_KEY;
  });

  it('skips a source whose env var is unset, with a warning, and keeps the rest', () => {
    fs.writeFileSync(path.join(dir, 'a.yaml'), yaml('keyed', '"https://x/?k=${MKOSINT_TEST_KEY}"'));
    fs.writeFileSync(path.join(dir, 'b.yaml'), yaml('open', 'https://y/'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const names = loadSourcesFromDir(dir).map((c) => c.name);
    expect(names).toEqual(['open']);
    expect(warn).toHaveBeenCalledWith('source keyed disabled: missing env MKOSINT_TEST_KEY');
    warn.mockRestore();
  });

  it('loads it (placeholders kept, not resolved) once the var exists', () => {
    process.env.MKOSINT_TEST_KEY = 'abcd1234';
    fs.writeFileSync(path.join(dir, 'a.yaml'), yaml('keyed', '"https://x/?k=${MKOSINT_TEST_KEY}"'));
    const [config] = loadSourcesFromDir(dir);
    expect(config.transport.url).toBe('https://x/?k=${MKOSINT_TEST_KEY}');
  });

  it('rejects invalid auth / pagination blocks', () => {
    const text = yaml('bad', 'https://x/').replace(
      '  interval: 60s\n',
      '  interval: 60s\n  auth: { type: magic }\n  pagination: { type: offset, param: o }\n'
    );
    fs.writeFileSync(path.join(dir, 'a.yaml'), text);
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(loadSourcesFromDir(dir)).toEqual([]);
    const msg = String(error.mock.calls[0][0]);
    expect(msg).toMatch(/transport\.auth\.type/);
    expect(msg).toMatch(/pagination\.size/);
    error.mockRestore();
  });
});
