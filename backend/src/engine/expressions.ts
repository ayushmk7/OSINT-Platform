/**
 * A small, sandboxed expression language for source YAML (`=expr` mapping values and
 * `filter: [{ expr }]` rules). It is a hand-written tokenizer + Pratt parser + tree-walking
 * evaluator: no `eval`, no `Function`, no access to globals or prototypes. Identifiers resolve
 * ONLY against own properties of the raw record, and calls resolve ONLY to the whitelisted
 * helpers in `HELPERS`.
 *
 * Grammar (lowest to highest precedence):
 *   cond ? a : b      a ?? b      a || b / a or b      a && b / a and b
 *   == != === !==     < <= > >=   + -                  * / %
 *   unary ! not -     postfix a.b a[expr] f(args)
 * Literals: numbers, 'single' or "double" quoted strings, true, false, null.
 * `$` is the whole record, so keys that are not identifiers read as `$['georss:point']`.
 */

export interface ExpressionContext {
  /** Named lookup tables from the source's top-level `lookups:` block. */
  lookups?: Record<string, unknown>;
}

type Node =
  | { t: 'lit'; v: unknown }
  | { t: 'var'; name: string }
  | { t: 'member'; obj: Node; prop: Node }
  | { t: 'call'; name: string; args: Node[] }
  | { t: 'unary'; op: string; a: Node }
  | { t: 'binary'; op: string; a: Node; b: Node }
  | { t: 'cond'; c: Node; a: Node; b: Node };

interface Token {
  k: 'num' | 'str' | 'id' | 'op' | 'eof';
  v: string;
  pos: number;
}

const OPERATORS = [
  '===',
  '!==',
  '??',
  '||',
  '&&',
  '==',
  '!=',
  '<=',
  '>=',
  '<',
  '>',
  '+',
  '-',
  '*',
  '/',
  '%',
  '!',
  '?',
  ':',
  '(',
  ')',
  '[',
  ']',
  ',',
  '.'
];

/** Property names that are never readable, whatever the record contains. */
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    const numMatch = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i));
    if (numMatch && !(ch === '.' && tokens.length > 0 && isValueEnd(tokens[tokens.length - 1]))) {
      tokens.push({ k: 'num', v: numMatch[0], pos: i });
      i += numMatch[0].length;
      continue;
    }
    if (ch === "'" || ch === '"') {
      let j = i + 1;
      let out = '';
      while (j < src.length && src[j] !== ch) {
        if (src[j] === '\\' && j + 1 < src.length) {
          const esc = src[j + 1];
          out += esc === 'n' ? '\n' : esc === 't' ? '\t' : esc;
          j += 2;
        } else {
          out += src[j++];
        }
      }
      if (j >= src.length) throw new Error(`unterminated string at ${i}`);
      tokens.push({ k: 'str', v: out, pos: i });
      i = j + 1;
      continue;
    }
    const idMatch = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(src.slice(i));
    if (idMatch) {
      tokens.push({ k: 'id', v: idMatch[0], pos: i });
      i += idMatch[0].length;
      continue;
    }
    const op = OPERATORS.find((o) => src.startsWith(o, i));
    if (!op) throw new Error(`unexpected character '${ch}' at ${i}`);
    tokens.push({ k: 'op', v: op, pos: i });
    i += op.length;
  }
  tokens.push({ k: 'eof', v: '', pos: src.length });
  return tokens;
}

function isValueEnd(tok: Token): boolean {
  return tok.k === 'id' || (tok.k === 'op' && (tok.v === ')' || tok.v === ']'));
}

const BINARY_PRECEDENCE: Record<string, number> = {
  '??': 2,
  '||': 3,
  or: 3,
  '&&': 4,
  and: 4,
  '==': 5,
  '!=': 5,
  '===': 5,
  '!==': 5,
  '<': 6,
  '<=': 6,
  '>': 6,
  '>=': 6,
  '+': 7,
  '-': 7,
  '*': 8,
  '/': 8,
  '%': 8
};

class Parser {
  private i = 0;
  constructor(private readonly tokens: Token[]) {}

  parse(): Node {
    const node = this.expression(0);
    const tok = this.peek();
    if (tok.k !== 'eof') throw new Error(`unexpected '${tok.v}' at ${tok.pos}`);
    return node;
  }

  private peek(): Token {
    return this.tokens[this.i];
  }

  private next(): Token {
    return this.tokens[this.i++];
  }

  private expect(op: string): void {
    const tok = this.next();
    if (tok.k !== 'op' || tok.v !== op) {
      throw new Error(`expected '${op}' at ${tok.pos}, got '${tok.v || 'end of input'}'`);
    }
  }

  private binaryOp(tok: Token): string | undefined {
    if (tok.k === 'op' && BINARY_PRECEDENCE[tok.v] !== undefined) return tok.v;
    if (tok.k === 'id' && (tok.v === 'and' || tok.v === 'or')) return tok.v;
    return undefined;
  }

  private expression(minPrec: number): Node {
    let left = this.unary();
    for (;;) {
      const tok = this.peek();
      if (tok.k === 'op' && tok.v === '?' && minPrec <= 1) {
        this.next();
        const a = this.expression(1);
        this.expect(':');
        const b = this.expression(1);
        left = { t: 'cond', c: left, a, b };
        continue;
      }
      const op = this.binaryOp(tok);
      if (!op) break;
      const prec = BINARY_PRECEDENCE[op];
      if (prec < minPrec) break;
      this.next();
      const right = this.expression(prec + 1);
      left = { t: 'binary', op: op === 'and' ? '&&' : op === 'or' ? '||' : op, a: left, b: right };
    }
    return left;
  }

  private unary(): Node {
    const tok = this.peek();
    if (
      (tok.k === 'op' && (tok.v === '!' || tok.v === '-' || tok.v === '+')) ||
      (tok.k === 'id' && tok.v === 'not')
    ) {
      this.next();
      return { t: 'unary', op: tok.v === 'not' ? '!' : tok.v, a: this.unary() };
    }
    return this.postfix(this.primary());
  }

  private primary(): Node {
    const tok = this.next();
    if (tok.k === 'num') return { t: 'lit', v: Number(tok.v) };
    if (tok.k === 'str') return { t: 'lit', v: tok.v };
    if (tok.k === 'op' && tok.v === '(') {
      const inner = this.expression(0);
      this.expect(')');
      return inner;
    }
    if (tok.k === 'id') {
      if (tok.v === 'true') return { t: 'lit', v: true };
      if (tok.v === 'false') return { t: 'lit', v: false };
      if (tok.v === 'null') return { t: 'lit', v: null };
      const after = this.peek();
      if (after.k === 'op' && after.v === '(') {
        if (!Object.prototype.hasOwnProperty.call(HELPERS, tok.v)) {
          throw new Error(`unknown function '${tok.v}' at ${tok.pos}`);
        }
        this.next();
        const args: Node[] = [];
        if (!(this.peek().k === 'op' && this.peek().v === ')')) {
          for (;;) {
            args.push(this.expression(0));
            if (this.peek().k === 'op' && this.peek().v === ',') {
              this.next();
              continue;
            }
            break;
          }
        }
        this.expect(')');
        return { t: 'call', name: tok.v, args };
      }
      return { t: 'var', name: tok.v };
    }
    throw new Error(`unexpected '${tok.v || 'end of input'}' at ${tok.pos}`);
  }

  private postfix(node: Node): Node {
    for (;;) {
      const tok = this.peek();
      if (tok.k === 'op' && tok.v === '.') {
        this.next();
        const name = this.next();
        // `a.0` is allowed so numeric array indices read like the path syntax.
        if (name.k !== 'id' && name.k !== 'num') {
          throw new Error(`expected property name at ${name.pos}`);
        }
        node = { t: 'member', obj: node, prop: { t: 'lit', v: name.v } };
      } else if (tok.k === 'op' && tok.v === '[') {
        this.next();
        const prop = this.expression(0);
        this.expect(']');
        node = { t: 'member', obj: node, prop };
      } else {
        return node;
      }
    }
  }
}

/** Own-property read that never walks the prototype chain. */
function getOwn(obj: unknown, key: unknown): unknown {
  if (obj === null || obj === undefined || typeof obj !== 'object') {
    if (typeof obj === 'string' && key === 'length') return obj.length;
    return undefined;
  }
  const k = String(key);
  if (FORBIDDEN_KEYS.has(k)) return undefined;
  if (Array.isArray(obj) && k === 'length') return obj.length;
  return Object.prototype.hasOwnProperty.call(obj, k)
    ? (obj as Record<string, unknown>)[k]
    : undefined;
}

function isNullish(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === 'number' && Number.isNaN(v));
}

function isBlank(v: unknown): boolean {
  return isNullish(v) || (typeof v === 'string' && v.trim() === '');
}

/** Number coercion that treats blanks/non-numeric text as missing (NaN). */
export function toNum(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string' && v.trim() !== '') return Number(v.trim());
  return NaN;
}

function isNumeric(v: unknown): boolean {
  return typeof v === 'number' || (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v)));
}

function looseEquals(a: unknown, b: unknown): boolean {
  if (isNullish(a) || isNullish(b)) return isNullish(a) && isNullish(b);
  if (isNumeric(a) && isNumeric(b)) return toNum(a) === toNum(b);
  return String(a) === String(b);
}

function compare(a: unknown, b: unknown): number | undefined {
  if (isNullish(a) || isNullish(b)) return undefined;
  if (isNumeric(a) && isNumeric(b)) return toNum(a) - toNum(b);
  const sa = String(a);
  const sb = String(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

function finiteOrNull(n: number): number | null {
  return Number.isFinite(n) ? n : null;
}

/** Epoch sec/ms or ISO text -> epoch milliseconds (null when unparseable). */
export function toEpochMs(v: unknown): number | null {
  if (isBlank(v)) return null;
  if (v instanceof Date) return finiteOrNull(v.getTime());
  if (isNumeric(v)) {
    const n = toNum(v);
    return n > 1e11 ? n : n * 1000; // heuristic: seconds vs milliseconds
  }
  const parsed = Date.parse(String(v));
  return Number.isNaN(parsed) ? null : parsed;
}

type Helper = (ctx: ExpressionContext, ...args: unknown[]) => unknown;

const HELPERS: Record<string, Helper> = Object.assign(Object.create(null) as object, {
  now: () => Date.now(),
  unix_ms: (_c: ExpressionContext, x: unknown) => toEpochMs(x),
  unix_s: (_c: ExpressionContext, x: unknown) => {
    const ms = toEpochMs(x);
    return ms === null ? null : ms / 1000;
  },
  parse_date: (_c: ExpressionContext, x: unknown) => {
    const ms = toEpochMs(x);
    return ms === null ? null : new Date(ms).toISOString();
  },
  number: (_c: ExpressionContext, x: unknown) => finiteOrNull(toNum(x)),
  string: (_c: ExpressionContext, x: unknown) => (isNullish(x) ? '' : String(x)),
  lower: (_c: ExpressionContext, x: unknown) => (isNullish(x) ? x : String(x).toLowerCase()),
  upper: (_c: ExpressionContext, x: unknown) => (isNullish(x) ? x : String(x).toUpperCase()),
  trim: (_c: ExpressionContext, x: unknown) => (isNullish(x) ? x : String(x).trim()),
  concat: (_c: ExpressionContext, ...xs: unknown[]) =>
    xs.map((x) => (isNullish(x) ? '' : String(x))).join(''),
  coalesce: (_c: ExpressionContext, ...xs: unknown[]) => xs.find((x) => !isBlank(x)) ?? null,
  round: (_c: ExpressionContext, x: unknown, digits?: unknown) => {
    const n = toNum(x);
    const d = digits === undefined ? 0 : Math.max(0, Math.min(15, Math.trunc(toNum(digits))));
    if (!Number.isFinite(n) || !Number.isFinite(d)) return null;
    const f = 10 ** d;
    return Math.round(n * f) / f;
  },
  floor: (_c: ExpressionContext, x: unknown) => finiteOrNull(Math.floor(toNum(x))),
  ceil: (_c: ExpressionContext, x: unknown) => finiteOrNull(Math.ceil(toNum(x))),
  abs: (_c: ExpressionContext, x: unknown) => finiteOrNull(Math.abs(toNum(x))),
  min: (_c: ExpressionContext, ...xs: unknown[]) => {
    const ns = xs.map(toNum).filter(Number.isFinite);
    return ns.length ? Math.min(...ns) : null;
  },
  max: (_c: ExpressionContext, ...xs: unknown[]) => {
    const ns = xs.map(toNum).filter(Number.isFinite);
    return ns.length ? Math.max(...ns) : null;
  },
  contains: (_c: ExpressionContext, hay: unknown, needle: unknown) => {
    if (Array.isArray(hay)) return hay.some((h) => looseEquals(h, needle));
    if (isNullish(hay) || isNullish(needle)) return false;
    return String(hay).toLowerCase().includes(String(needle).toLowerCase());
  },
  lookup: (ctx: ExpressionContext, table: unknown, key: unknown, fallback?: unknown) => {
    const tbl = getOwn(ctx.lookups, table);
    if (isNullish(key)) return fallback ?? null;
    const hit = getOwn(tbl, String(key).trim());
    return hit === undefined ? (fallback ?? null) : hit;
  }
} satisfies Record<string, Helper>);

/** Names of the helpers callable from expressions (for docs and tests). */
export const EXPRESSION_HELPERS = Object.keys(HELPERS);

function evaluate(node: Node, record: unknown, ctx: ExpressionContext): unknown {
  switch (node.t) {
    case 'lit':
      return node.v;
    case 'var':
      return node.name === '$' ? record : getOwn(record, node.name);
    case 'member':
      return getOwn(evaluate(node.obj, record, ctx), evaluate(node.prop, record, ctx));
    case 'call':
      return HELPERS[node.name](ctx, ...node.args.map((a) => evaluate(a, record, ctx)));
    case 'unary': {
      const v = evaluate(node.a, record, ctx);
      if (node.op === '!') return !v;
      const n = toNum(v);
      return finiteOrNull(node.op === '-' ? -n : n);
    }
    case 'cond':
      return evaluate(node.c, record, ctx)
        ? evaluate(node.a, record, ctx)
        : evaluate(node.b, record, ctx);
    case 'binary': {
      // Short-circuit operators evaluate the right side lazily.
      if (node.op === '??') {
        const a = evaluate(node.a, record, ctx);
        return isNullish(a) ? evaluate(node.b, record, ctx) : a;
      }
      if (node.op === '||') {
        const a = evaluate(node.a, record, ctx);
        return a ? a : evaluate(node.b, record, ctx);
      }
      if (node.op === '&&') {
        const a = evaluate(node.a, record, ctx);
        return a ? evaluate(node.b, record, ctx) : a;
      }
      const a = evaluate(node.a, record, ctx);
      const b = evaluate(node.b, record, ctx);
      switch (node.op) {
        case '==':
          return looseEquals(a, b);
        case '!=':
          return !looseEquals(a, b);
        case '===':
          return a === b;
        case '!==':
          return a !== b;
        case '<':
        case '<=':
        case '>':
        case '>=': {
          const c = compare(a, b);
          if (c === undefined || Number.isNaN(c)) return false;
          return node.op === '<'
            ? c < 0
            : node.op === '<='
              ? c <= 0
              : node.op === '>'
                ? c > 0
                : c >= 0;
        }
        case '+':
          if (isNumeric(a) && isNumeric(b)) return finiteOrNull(toNum(a) + toNum(b));
          if (isNullish(a) && isNullish(b)) return null;
          return (isNullish(a) ? '' : String(a)) + (isNullish(b) ? '' : String(b));
        case '-':
          return finiteOrNull(toNum(a) - toNum(b));
        case '*':
          return finiteOrNull(toNum(a) * toNum(b));
        case '/':
          return finiteOrNull(toNum(a) / toNum(b));
        case '%':
          return finiteOrNull(toNum(a) % toNum(b));
      }
      throw new Error(`unknown operator ${node.op}`);
    }
  }
}

export type CompiledExpression = (record: unknown, ctx?: ExpressionContext) => unknown;

const cache = new Map<string, CompiledExpression>();

/** Parse an expression (without the leading `=`). Throws a descriptive Error on bad syntax. */
export function compileExpression(src: string): CompiledExpression {
  const cached = cache.get(src);
  if (cached) return cached;
  const ast = new Parser(tokenize(src)).parse();
  const fn: CompiledExpression = (record, ctx = {}) => {
    try {
      return evaluate(ast, record, ctx);
    } catch {
      return undefined; // a runtime surprise leaves the field unresolved, never crashes a poll
    }
  };
  cache.set(src, fn);
  return fn;
}

/** Evaluate an expression against a record; undefined on any error. */
export function evaluateExpression(src: string, record: unknown, ctx?: ExpressionContext): unknown {
  try {
    return compileExpression(src)(record, ctx);
  } catch {
    return undefined;
  }
}

/** True when a YAML mapping value is an expression (`=...`) rather than a path. */
export function isExpression(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('=');
}

/** Syntax check for a single expression; returns the error message or undefined. */
export function expressionError(src: string): string | undefined {
  try {
    compileExpression(src);
    return undefined;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/**
 * Compile every expression a source config uses (mapping values starting with `=`, filter
 * `expr` rules, `recording.dedupe_fields`) and return one message per syntax error, so a
 * broken expression fails the source at load time instead of silently at every poll.
 */
export function collectExpressionErrors(config: Record<string, unknown>): string[] {
  const errors: string[] = [];
  const check = (value: unknown, label: string): void => {
    if (isExpression(value)) {
      const err = expressionError(value.slice(1));
      if (err) errors.push(`invalid expression in ${label}: ${err}`);
    }
  };
  const walk = (obj: unknown, label: string): void => {
    if (!obj || typeof obj !== 'object') return;
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'string') check(v, `${label}.${k}`);
      else if (v && typeof v === 'object' && !Array.isArray(v) && k !== 'scale') {
        walk(v, `${label}.${k}`);
      }
    }
  };
  walk(config.entity, 'entity');
  walk(config.observation, 'observation');

  if (Array.isArray(config.filter)) {
    config.filter.forEach((rule: unknown, i: number) => {
      const expr = (rule as { expr?: unknown } | null)?.expr;
      if (expr === undefined) return;
      if (typeof expr !== 'string' || expr.trim() === '') {
        errors.push(`filter[${i}].expr must be a non-empty string`);
        return;
      }
      const err = expressionError(expr.startsWith('=') ? expr.slice(1) : expr);
      if (err) errors.push(`invalid expression in filter[${i}].expr: ${err}`);
    });
  }

  const dedupe = (config.recording as { dedupe_fields?: unknown } | undefined)?.dedupe_fields;
  if (Array.isArray(dedupe)) dedupe.forEach((f, i) => check(f, `recording.dedupe_fields[${i}]`));
  return errors;
}
