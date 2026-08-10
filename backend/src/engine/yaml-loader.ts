import fs from 'fs';
import path from 'path';
import YAML from 'yaml';

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
      backoff?: string;
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

/** Reject configs that would blow up further down the pipeline. */
function isValidConfig(config: unknown): config is SourceConfig {
  const candidate = config as SourceConfig | null;
  return Boolean(
    candidate &&
    typeof candidate === 'object' &&
    typeof candidate.name === 'string' &&
    candidate.transport &&
    typeof candidate.transport.url === 'string' &&
    candidate.parser &&
    typeof candidate.parser.format === 'string' &&
    candidate.entity &&
    typeof candidate.entity.external_id === 'string' &&
    candidate.observation &&
    typeof candidate.observation.latitude === 'string' &&
    typeof candidate.observation.longitude === 'string'
  );
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
      const parsed = YAML.parse(fileContent);
      if (isValidConfig(parsed)) {
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
        console.warn(`Skipping invalid source definition (missing required fields): ${filePath}`);
      }
    } catch (err) {
      console.error(`Failed to parse source definition ${filePath}:`, err);
    }
  }

  return configs;
}
