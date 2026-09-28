import {
  EXPRESSION_HELPERS,
  collectExpressionErrors,
  compileExpression,
  evaluateExpression,
  expressionError
} from '../engine/expressions';

const ev = (src: string, rec: unknown = {}, lookups?: Record<string, unknown>): unknown =>
  evaluateExpression(src, rec, { lookups });

describe('expression engine', () => {
  it('reads fields, nested paths and array indices', () => {
    const rec = { a: 1, p: { mag: 4.5 }, g: { c: [10, 20] }, 'georss:point': '1 2' };
    expect(ev('a', rec)).toBe(1);
    expect(ev('p.mag', rec)).toBe(4.5);
    expect(ev('g.c[1]', rec)).toBe(20);
    expect(ev('g.c.0', rec)).toBe(10);
    expect(ev("$['georss:point']", rec)).toBe('1 2');
    expect(ev('missing.deep', rec)).toBeUndefined();
  });

  it('supports ?? and the ternary from the spec', () => {
    expect(ev('callsign ?? hex', { hex: 'abc' })).toBe('abc');
    expect(ev('callsign ?? hex', { callsign: 'UAL1', hex: 'abc' })).toBe('UAL1');
    const alt = "alt_baro == 'ground' ? 0 : alt_baro * 0.3048";
    expect(ev(alt, { alt_baro: 'ground' })).toBe(0);
    expect(ev(alt, { alt_baro: 10000 })).toBeCloseTo(3048);
    expect(ev('a ? b ? 1 : 2 : 3', { a: true, b: false })).toBe(2);
  });

  it('implements arithmetic, comparison and logic with precedence', () => {
    expect(ev('1 + 2 * 3')).toBe(7);
    expect(ev('(1 + 2) * 3')).toBe(9);
    expect(ev('-x + 1', { x: 2 })).toBe(-1);
    expect(ev('10 % 4')).toBe(2);
    expect(ev('1 / 0')).toBeNull();
    expect(ev("'5' + 1")).toBe(6); // numeric strings add as numbers (CSV values)
    expect(ev("'a' + 1")).toBe('a1');
    expect(ev('mag >= 2.5', { mag: '3.1' })).toBe(true);
    expect(ev('mag >= 2.5', { mag: 1 })).toBe(false);
    expect(ev('mag >= 2.5', {})).toBe(false);
    expect(ev('a == 1 && b != 2', { a: '1', b: 3 })).toBe(true);
    expect(ev('a === 1', { a: '1' })).toBe(false);
    expect(ev('x and not y or z', { x: true, y: true, z: false })).toBe(false);
    expect(ev('!missing')).toBe(true);
  });

  it('provides the helper library', () => {
    expect(EXPRESSION_HELPERS).toEqual(
      expect.arrayContaining(['now', 'unix_ms', 'lookup', 'coalesce', 'round'])
    );
    expect(typeof ev('now()')).toBe('number');
    expect(ev('unix_ms(t)', { t: 1700000000 })).toBe(1700000000000);
    expect(ev('unix_ms(t)', { t: '2024-01-01T00:00:00Z' })).toBe(Date.UTC(2024, 0, 1));
    expect(ev('unix_s(t)', { t: 1700000000000 })).toBe(1700000000);
    expect(ev('parse_date(t)', { t: 1700000000 })).toBe('2023-11-14T22:13:20.000Z');
    expect(ev('parse_date(t)', { t: 'garbage' })).toBeNull();
    expect(ev("number('4.5')")).toBe(4.5);
    expect(ev("number('x')")).toBeNull();
    expect(ev("lower(' AbC ')")).toBe(' abc ');
    expect(ev("upper(trim(' ab '))")).toBe('AB');
    expect(ev("concat(a, '-', b, c)", { a: 'x', b: 2 })).toBe('x-2');
    expect(ev("coalesce(a, b, 'z')", { a: '  ', b: null })).toBe('z');
    expect(ev('round(3.14159, 2)')).toBe(3.14);
    expect(ev('round(2.5)')).toBe(3);
    expect(ev('abs(-2)')).toBe(2);
    expect(ev('min(3, 1, 2)')).toBe(1);
    expect(ev('max(3, x, 2)', { x: '9' })).toBe(9);
    expect(ev("contains(title, 'quake')", { title: 'Big Quake hits' })).toBe(true);
  });

  it('looks up values in named tables with a default', () => {
    const lookups = { cc: { US: 'United States', FR: 'France' } };
    expect(ev("lookup('cc', code)", { code: 'FR' }, lookups)).toBe('France');
    expect(ev("lookup('cc', code, 'Unknown')", { code: 'XX' }, lookups)).toBe('Unknown');
    expect(ev("lookup('nope', code, 'd')", { code: 'US' }, lookups)).toBe('d');
    expect(ev("lookup('cc', 'toString', 'd')", {}, lookups)).toBe('d');
  });

  it('cannot reach prototypes, globals or arbitrary functions', () => {
    expect(ev('constructor', {})).toBeUndefined();
    expect(ev('a.__proto__', { a: {} })).toBeUndefined();
    expect(ev("a['constructor']", { a: {} })).toBeUndefined();
    expect(ev('toString', {})).toBeUndefined();
    expect(ev('process', {})).toBeUndefined();
    expect(expressionError('eval("1")')).toMatch(/unknown function 'eval'/);
    expect(expressionError('Function("x")')).toMatch(/unknown function/);
    expect(expressionError('a.constructor("x")')).toBeDefined();
  });

  it('reports syntax errors at compile time and caches compiled expressions', () => {
    expect(expressionError('1 +')).toBeDefined();
    expect(expressionError("'open")).toMatch(/unterminated/);
    expect(expressionError('a ? b')).toMatch(/expected ':'/);
    expect(expressionError('a # b')).toMatch(/unexpected character/);
    expect(compileExpression('a + 1')).toBe(compileExpression('a + 1'));
  });

  it('collects expression errors from a whole source config', () => {
    const errors = collectExpressionErrors({
      entity: { external_id: 'id', name: '=callsign ??', metadata: { ok: '=a + 1' } },
      observation: { latitude: '=lat +', longitude: 'lon' },
      filter: [{ expr: 'mag >=' }, { field: 'x', in: [1] }, { expr: '' }],
      recording: { dedupe_fields: ['title', '=lower('] }
    });
    expect(errors).toHaveLength(5);
    expect(errors.join('\n')).toMatch(/entity\.name/);
    expect(errors.join('\n')).toMatch(/observation\.latitude/);
    expect(errors.join('\n')).toMatch(/filter\[0\]/);
    expect(errors.join('\n')).toMatch(/filter\[2\]/);
    expect(errors.join('\n')).toMatch(/dedupe_fields\[1\]/);
  });
});
