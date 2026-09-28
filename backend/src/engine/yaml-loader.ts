import fs from 'fs';
import path from 'path';
import YAML from 'yaml';
import { BACKOFF_STRATEGIES, BackoffStrategy } from './retry';

/** `schema_version` values this engine understands. Absent is treated as 1. */
export const SUPPORTED_SCHEMA_VERSIONS = [1] as const;

/** Numeric observation fields that accept an `observation.scale` multiplier. */
export const SCALABLE_OBSERVATION_FIELDS = [
  'latitude',
  'longitude',
  'altitude',
  'speed',
  'heading'
] as const;
export type ScalableObservationField = (typeof SCALABLE_OBSERVATION_FIELDS)[number];

/**
 * The canonical `entities.category` enum. This is the ONE place the list lives on the
 * backend — source YAML, the tests and the frontend union all mirror these exact strings.
 */
export const ENTITY_CATEGORIES = [
  'satellite',
  'aircraft',
  'geological',
  'radiation',
  'maritime',
  'atc_zone'
] as const;

export type EntityCategory = (typeof ENTITY_CATEGORIES)[number];

export function isEntityCategory(value: unknown): value is EntityCategory {
  return typeof value === 'string' && (ENTITY_CATEGORIES as readonly string[]).includes(value);
}

/**
 * One record-level predicate from a source's `filter:` list. Every rule must hold for a raw
 * record to reach the mapper; a record that fails is dropped BEFORE mapping, so it is not
 * counted as a malformed record.
 */
export interface FilterRule {
  /** Path into the raw record, same syntax as the entity/observation mappings. */
  field: string;
  /** Value must be one of these (string-compared). */
  in?: Array<string | number>;
  /** Value must be present and not an empty/whitespace-only string. */
  not_empty?: boolean;
}

/**
 * A metadata field COMPUTED from the raw record rather than copied out of it. Kept
 * declarative so per-source logic never leaks into TypeScript. Exactly one of `map` or
 * `template` is used:
 *   - `map`: exact-match lookup of the `from` value, falling back to `default`.
 *   - `template`: literal text with `{path}` / `{path|lower}` / `{path|upper}` placeholders.
 */
export interface DerivedField {
  /** Path whose value drives the `map` lookup. */
  from?: string;
  map?: Record<string, string | number>;
  default?: string | number;
  template?: string;
}

export interface SourceConfig {
  schema_version?: number;
  name: string;
  source_type: string;
  layer_type: string;
  display_name: string;
  enabled?: boolean;
  transport: {
    type: string;
    url: string;
    method?: string;
    headers?: Record<string, string>;
    timeout?: string | number;
    interval: string | number;
    retry?: {
      max_attempts?: number;
      backoff?: BackoffStrategy;
      initial_delay?: string;
      max_delay?: string;
    };
  };
  parser: {
    format: 'json' | 'geojson' | 'xml' | 'csv';
    records_path?: string;
    max_records?: number;
  };
  /** Record-level predicates; ALL must hold. Absent = every record is accepted. */
  filter?: FilterRule[];
  entity: {
    external_id: string;
    name: string;
    category?: string;
    metadata?: Record<string, string>;
    /** Metadata computed by the mapper instead of copied from the record. */
    derived?: Record<string, DerivedField>;
  };
  observation: {
    latitude: string;
    longitude: string;
    altitude?: string;
    speed?: string;
    heading?: string;
    timestamp?: string;
    /**
     * Multiply a resolved numeric field by a constant, e.g. `{ altitude: 1000 }` for a km feed.
     * The engine stores altitude in metres; a negative factor flips sign (depth -> below surface).
     */
    scale?: Partial<Record<ScalableObservationField, number>>;
  };
  recording?: {
    mode?: 'upsert' | 'append';
  };
}

/**
 * Parse a duration expressed as "30s" / "5m" / "1h" / a bare number of seconds
 * into whole seconds. Returns `fallback` when the value is absent or unusable.
 */
export function parseDurationSeconds(value: string | number | undefined, fallback: number): number {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : fallback;

  const match = /^\s*(\d+(?:\.\d+)?)\s*(ms|s|m|h)?\s*$/i.exec(value);
  if (!match) return fallback;

  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return fallback;

  switch ((match[2] || 's').toLowerCase()) {
    case 'ms':
      return Math.max(1, Math.round(amount / 1000));
    case 'm':
      return Math.round(amount * 60);
    case 'h':
      return Math.round(amount * 3600);
    default:
      return Math.round(amount);
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * Return every problem that would make this config fail further down the pipeline (an empty
 * list means it is usable). Covers every field the `sources` table stores as NOT NULL
 * (`name` -> id, `source_type` -> type, `transport.type` -> transport, `transport.url` -> url;
 * `display_name` falls back to `name`, `interval` to 60s), plus what the mapper needs.
 */
export function validateSourceConfig(config: unknown): string[] {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return ['file does not contain a YAML mapping'];
  }
  const c = config as Partial<SourceConfig> & Record<string, unknown>;
  const errors: string[] = [];
  const requireString = (value: unknown, label: string): void => {
    if (!isNonEmptyString(value)) errors.push(`missing or empty required field "${label}"`);
  };

  if (
    c.schema_version !== undefined &&
    !(SUPPORTED_SCHEMA_VERSIONS as readonly unknown[]).includes(c.schema_version)
  ) {
    errors.push(
      `unsupported schema_version ${JSON.stringify(c.schema_version)} ` +
        `(supported: ${SUPPORTED_SCHEMA_VERSIONS.join(', ')})`
    );
  }

  requireString(c.name, 'name');
  requireString(c.source_type, 'source_type');

  const transport = c.transport;
  if (!transport || typeof transport !== 'object') {
    errors.push('missing required section "transport"');
  } else {
    requireString(transport.type, 'transport.type');
    requireString(transport.url, 'transport.url');
    const backoff = transport.retry?.backoff;
    if (backoff !== undefined && !(BACKOFF_STRATEGIES as readonly unknown[]).includes(backoff)) {
      errors.push(
        `invalid retry.backoff ${JSON.stringify(backoff)} ` +
          `(expected one of: ${BACKOFF_STRATEGIES.join(', ')})`
      );
    }
  }

  if (!c.parser || typeof c.parser !== 'object') {
    errors.push('missing required section "parser"');
  } else {
    requireString(c.parser.format, 'parser.format');
  }

  if (!c.entity || typeof c.entity !== 'object') {
    errors.push('missing required section "entity"');
  } else {
    requireString(c.entity.external_id, 'entity.external_id');
  }

  const observation = c.observation;
  if (!observation || typeof observation !== 'object') {
    errors.push('missing required section "observation"');
  } else {
    requireString(observation.latitude, 'observation.latitude');
    requireString(observation.longitude, 'observation.longitude');
    if (observation.scale !== undefined) {
      if (!observation.scale || typeof observation.scale !== 'object') {
        errors.push('observation.scale must be a mapping of field -> number');
      } else {
        for (const [field, factor] of Object.entries(observation.scale)) {
          if (!(SCALABLE_OBSERVATION_FIELDS as readonly string[]).includes(field)) {
            errors.push(
              `observation.scale.${field} is not a scalable field ` +
                `(expected one of: ${SCALABLE_OBSERVATION_FIELDS.join(', ')})`
            );
          } else if (typeof factor !== 'number' || !Number.isFinite(factor)) {
            errors.push(`observation.scale.${field} must be a finite number`);
          }
        }
      }
    }
  }

  return errors;
}

/**
 * Discover every `*.yaml` / `*.yml` source definition in `dirPath`.
 * A malformed or incomplete file is logged and skipped; it never aborts the load.
 */
export function loadSourcesFromDir(dirPath: string): SourceConfig[] {
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  const files = fs.readdirSync(dirPath).sort();
  const configs: SourceConfig[] = [];

  for (const file of files) {
    if (!file.endsWith('.yaml') && !file.endsWith('.yml')) continue;

    const filePath = path.join(dirPath, file);
    try {
      const fileContent = fs.readFileSync(filePath, 'utf8');
      const raw: unknown = YAML.parse(fileContent);
      const errors = validateSourceConfig(raw);
      if (errors.length === 0) {
        const parsed = raw as SourceConfig;
        // A non-canonical category still loads (the engine is data-driven and must not
        // hard-fail on a new layer), but it is surfaced loudly because the frontend has no
        // marker for it.
        if (parsed.entity.category !== undefined && !isEntityCategory(parsed.entity.category)) {
          console.warn(
            `Source ${parsed.name}: non-canonical entity.category "${parsed.entity.category}" ` +
              `(expected one of: ${ENTITY_CATEGORIES.join(', ')})`
          );
        }
        configs.push(parsed);
      } else {
        console.error(`Skipping invalid source definition ${filePath}: ${errors.join('; ')}`);
      }
    } catch (err) {
      console.error(`Failed to parse source definition ${filePath}:`, err);
    }
  }

  return configs;
}
