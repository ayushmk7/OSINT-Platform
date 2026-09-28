import fs from 'fs';
import path from 'path';
import YAML from 'yaml';
import { BACKOFF_STRATEGIES, BackoffStrategy } from './retry';
import { envScope, missingEnvVars } from './env';
import { TransportExtras, validateTransportExtras } from './transport-config';
import { collectExpressionErrors } from './expressions';
import { resolveLookups } from './lookups';
import type { ParserOptions, SupportedFormat } from './parsers/types';

/** `recording.mode` values. `dedupe` = content-hash identity + INSERT OR IGNORE. */
export const RECORDING_MODES = ['upsert', 'append', 'dedupe'] as const;
export type RecordingMode = (typeof RECORDING_MODES)[number];

/** `parser.format` values the engine can parse. */
export const PARSER_FORMATS = ['json', 'geojson', 'xml', 'csv', 'rss', 'tle', 'omm_json'] as const;
import {
  LAYER_ID_PATTERN,
  ResolvedDisplay,
  ResolvedLayer,
  resolveLayerDisplay,
  validateLayerDisplay
} from './layer-display';

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
 * The LEGACY category list. `entities.category` is no longer a closed enum — any lowercase
 * snake_case string is a valid category / layer id (see `layer-display.ts`) — but these six keep
 * their hand-drawn frontend styles, which the globe falls back to for a source that declares no
 * `display:` block.
 */
export const ENTITY_CATEGORIES = [
  'satellite',
  'aircraft',
  'geological',
  'radiation',
  'maritime',
  'atc_zone'
] as const;
export const LEGACY_ENTITY_CATEGORIES = ENTITY_CATEGORIES;

export type EntityCategory = string;

/** Any lowercase snake_case id is a valid category. */
export function isEntityCategory(value: unknown): value is EntityCategory {
  return typeof value === 'string' && LAYER_ID_PATTERN.test(value);
}

/** One of the six categories the frontend has a legacy (non-data-driven) style for. */
export function isLegacyEntityCategory(value: unknown): boolean {
  return typeof value === 'string' && (ENTITY_CATEGORIES as readonly string[]).includes(value);
}

/**
 * One record-level predicate from a source's `filter:` list. Every rule must hold for a raw
 * record to reach the mapper; a record that fails is dropped BEFORE mapping, so it is not
 * counted as a malformed record.
 */
export interface FilterRule {
  /** Path into the raw record, same syntax as the entity/observation mappings. */
  field?: string;
  /** Expression (see expressions.ts) that must be truthy, e.g. "mag >= 2.5". */
  expr?: string;
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
  /** Base fields plus the optional auth/body/pagination/stream fields (TransportExtras). */
  transport: TransportExtras & {
    type: string;
    url: string;
    method?: string;
    headers?: Record<string, string>;
    timeout?: string | number;
    interval: string | number;
    /** Orbital formats (tle/omm_json): re-propagate cached elements this often, no refetch. */
    propagate_interval?: string | number;
    retry?: {
      max_attempts?: number;
      backoff?: BackoffStrategy;
      initial_delay?: string;
      max_delay?: string;
    };
  };
  parser: ParserOptions & {
    format: SupportedFormat;
    records_path?: string;
    max_records?: number;
  };
  /**
   * Named tables for the `lookup(table, key, default)` expression helper: an inline map, or a
   * .json/.csv path relative to the sources directory (resolved to a map at load time).
   */
  lookups?: Record<string, Record<string, unknown> | string>;
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
    /** true: records whose lat/lon do not resolve are dropped silently (counted, not warned). */
    optional?: boolean;
  };
  recording?: {
    mode?: RecordingMode;
    /** dedupe mode: paths/`=expr` whose values form the identity hash. Default: mapped entity. */
    dedupe_fields?: string[];
    /** Ignore records whose source timestamp is older than this ('30m', '7d', seconds). */
    max_age?: string | number;
  };
  /** Legend layer. Always present (defaults applied) on a config returned by the loader. */
  layer?: ResolvedLayer;
  /** Marker style + entity card. Always present (defaults applied) after loading. */
  display?: ResolvedDisplay;
}

/**
 * Parse a duration expressed as "30s" / "5m" / "1h" / a bare number of seconds
 * into whole seconds. Returns `fallback` when the value is absent or unusable.
 */
export function parseDurationSeconds(value: string | number | undefined, fallback: number): number {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : fallback;

  const match = /^\s*(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)?\s*$/i.exec(value);
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
    case 'd':
      return Math.round(amount * 86400);
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
    errors.push(...validateTransportExtras(transport));
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

  errors.push(...validateLayerDisplay(c));
  errors.push(...validateParsingAndRecording(c));
  return errors;
}

/**
 * Validation for parser formats/options, recording modes, filter rules and expressions.
 * Kept separate from the core field checks above.
 */
function validateParsingAndRecording(c: Record<string, unknown>): string[] {
  const errors: string[] = [];
  const parser = c.parser as Record<string, unknown> | undefined;
  if (parser && typeof parser === 'object') {
    if (
      isNonEmptyString(parser.format) &&
      !(PARSER_FORMATS as readonly string[]).includes(parser.format)
    ) {
      errors.push(
        `unsupported parser.format "${parser.format}" (expected one of: ${PARSER_FORMATS.join(', ')})`
      );
    }
    const csv = parser.csv as Record<string, unknown> | undefined;
    if (csv !== undefined) {
      if (!csv || typeof csv !== 'object' || Array.isArray(csv)) {
        errors.push('parser.csv must be a mapping');
      } else {
        if (csv.delimiter !== undefined && !isNonEmptyString(csv.delimiter)) {
          errors.push('parser.csv.delimiter must be a non-empty string');
        }
        if (csv.columns !== undefined && !Array.isArray(csv.columns)) {
          errors.push('parser.csv.columns must be a list of names');
        }
        if (
          csv.skip_lines !== undefined &&
          !(Number.isInteger(csv.skip_lines) && (csv.skip_lines as number) >= 0)
        ) {
          errors.push('parser.csv.skip_lines must be a non-negative integer');
        }
      }
    }
    const cols = parser.array_columns;
    if (cols !== undefined && cols !== 'header' && !Array.isArray(cols)) {
      errors.push("parser.array_columns must be a list of names or 'header'");
    }
  }

  const recording = c.recording as Record<string, unknown> | undefined;
  if (recording && typeof recording === 'object') {
    if (
      recording.mode !== undefined &&
      !(RECORDING_MODES as readonly unknown[]).includes(recording.mode)
    ) {
      errors.push(
        `invalid recording.mode ${JSON.stringify(recording.mode)} ` +
          `(expected one of: ${RECORDING_MODES.join(', ')})`
      );
    }
    if (recording.dedupe_fields !== undefined && !Array.isArray(recording.dedupe_fields)) {
      errors.push('recording.dedupe_fields must be a list of paths/expressions');
    }
    if (
      recording.max_age !== undefined &&
      parseDurationSeconds(recording.max_age as string | number, -1) <= 0
    ) {
      errors.push(`invalid recording.max_age ${JSON.stringify(recording.max_age)}`);
    }
  }

  if (c.filter !== undefined) {
    if (!Array.isArray(c.filter)) {
      errors.push('filter must be a list of rules');
    } else {
      c.filter.forEach((rule: unknown, i: number) => {
        const r = rule as Record<string, unknown> | null;
        if (!r || typeof r !== 'object' || (r.field === undefined && r.expr === undefined)) {
          errors.push(`filter[${i}] needs a "field" or an "expr"`);
        }
      });
    }
  }

  errors.push(...collectExpressionErrors(c));
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
        // `${NAME}` placeholders are resolved per request; a source whose required env var
        // is unset stays inert (skipped with a warning) instead of failing every poll.
        const missingEnv = missingEnvVars(envScope(parsed.transport));
        if (missingEnv.length > 0) {
          console.warn(`source ${parsed.name} disabled: missing env ${missingEnv.join(', ')}`);
          continue;
        }
        // File-backed lookup tables are read once here; a missing file skips the source.
        if (parsed.lookups !== undefined) parsed.lookups = resolveLookups(parsed.lookups, dirPath);
        const { layer, display } = resolveLayerDisplay(raw as Record<string, unknown>, (message) =>
          console.warn(`Source ${parsed.name}: ${message}`)
        );
        parsed.layer = layer;
        parsed.display = display;
        // The layer id doubles as the entity category unless the source overrides it.
        if (parsed.entity.category === undefined) parsed.entity.category = layer.id;
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
