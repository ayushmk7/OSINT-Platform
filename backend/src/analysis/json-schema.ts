/**
 * A deliberately tiny JSON Schema subset — enough to describe and check LLM output without a
 * validator dependency. Supported keywords: `type` (object, array, string, number, integer,
 * boolean, null, or an array of those), `properties`, `required`, `additionalProperties: false`,
 * `items`, `enum`, `description`. Anything else is ignored by the validator.
 *
 * The same subset is what both provider structured-output modes accept (Anthropic
 * `output_config.format` and OpenAI `response_format: json_schema` in strict mode), which is why
 * `normalizeSchema` forces `additionalProperties: false` and all-properties-required on objects.
 */

export interface JsonSchema {
  type?: string | string[];
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: JsonSchema;
  enum?: unknown[];
}

const TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']);

/** Structural check of a schema definition. Returns a list of problems (empty = OK). */
export function checkSchema(schema: unknown, path = 'schema'): string[] {
  if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) {
    return [`${path} must be an object`];
  }
  const s = schema as JsonSchema;
  const errors: string[] = [];
  const types = s.type === undefined ? [] : Array.isArray(s.type) ? s.type : [s.type];
  if (s.type === undefined && s.enum === undefined) errors.push(`${path}.type is required`);
  for (const t of types) if (!TYPES.has(t)) errors.push(`${path}.type "${t}" is not supported`);
  if (s.enum !== undefined && !Array.isArray(s.enum)) errors.push(`${path}.enum must be a list`);
  if (s.properties !== undefined) {
    if (typeof s.properties !== 'object' || s.properties === null) {
      errors.push(`${path}.properties must be a map`);
    } else {
      for (const [k, v] of Object.entries(s.properties)) {
        errors.push(...checkSchema(v, `${path}.properties.${k}`));
      }
    }
  }
  if (s.items !== undefined) errors.push(...checkSchema(s.items, `${path}.items`));
  return errors;
}

/**
 * Returns a copy with every object schema closed (`additionalProperties: false`) and every
 * declared property required — the strict form both providers need for guaranteed output.
 */
export function normalizeSchema(schema: JsonSchema): JsonSchema {
  const out: JsonSchema = { ...schema };
  if (schema.properties) {
    out.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([k, v]) => [k, normalizeSchema(v)])
    );
    out.required = Object.keys(schema.properties);
    out.additionalProperties = false;
    if (out.type === undefined) out.type = 'object';
  } else if (schema.type === 'object') {
    out.properties = {};
    out.required = [];
    out.additionalProperties = false;
  }
  if (schema.items) out.items = normalizeSchema(schema.items);
  return out;
}

function typeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function matchesType(value: unknown, type: string): boolean {
  const actual = typeOf(value);
  if (type === 'integer') return actual === 'number' && Number.isInteger(value);
  return actual === type;
}

/** Validates `value` against `schema`. Returns a list of errors (empty = valid). */
export function validateJson(value: unknown, schema: JsonSchema, path = '$'): string[] {
  const errors: string[] = [];
  if (schema.enum && !schema.enum.some((e) => e === value)) {
    errors.push(`${path}: must be one of ${schema.enum.map((e) => JSON.stringify(e)).join(', ')}`);
    return errors;
  }
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => matchesType(value, t))) {
      errors.push(`${path}: expected ${types.join('|')}, got ${typeOf(value)}`);
      return errors;
    }
  }
  if (typeOf(value) === 'object') {
    const obj = value as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (!(key in obj)) errors.push(`${path}.${key}: is required`);
    }
    for (const [key, v] of Object.entries(obj)) {
      const sub = schema.properties?.[key];
      if (sub) errors.push(...validateJson(v, sub, `${path}.${key}`));
      else if (schema.additionalProperties === false) {
        errors.push(`${path}.${key}: unexpected property`);
      }
    }
  }
  if (Array.isArray(value) && schema.items) {
    value.forEach((item, i) => errors.push(...validateJson(item, schema.items!, `${path}[${i}]`)));
  }
  return errors;
}
