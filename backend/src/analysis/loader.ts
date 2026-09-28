import fs from 'fs';
import path from 'path';
import YAML from 'yaml';
import { checkSchema, normalizeSchema, type JsonSchema } from './json-schema';
import { parseDurationMs, parseSchedule } from './schedule';
import {
  ATTENTION_LEVELS,
  FILTER_OPS,
  isAttention,
  type AnalysisDefinition,
  type InputFilter
} from './types';

/** Hard ceiling on records fed to one analysis run (both layer and SQL inputs). */
export const MAX_INPUT_RECORDS = 500;
export const DEFAULT_MAX_RECORDS = 200;
export const DEFAULT_LOOKBACK_MS = 60 * 60_000;
export const DEFAULT_DEDUP_WINDOW_MS = 24 * 3_600_000;
export const DEFAULT_RETENTION_MS = 7 * 86_400_000;
export const DEFAULT_MAX_INSIGHTS = 5;

const NAME_RE = /^[a-z][a-z0-9_]*$/;
const FILTER_FIELD_RE =
  /^(name|category|source_id|latitude|longitude|altitude|timestamp|metadata(\.[\w-]+)+)$/;

export interface LoadResult {
  analyses: AnalysisDefinition[];
  errors: { file: string; errors: string[] }[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Light syntactic gate for `input.sql`. The authoritative check is `stmt.readonly` on a real
 * connection (see sql-guard.ts); this only rejects obvious non-queries early, at load time.
 */
export function looksLikeSelect(sql: string): boolean {
  const body = sql.trim().replace(/;\s*$/, '');
  if (body.includes(';')) return false;
  return /^(select|with)\b/i.test(body);
}

/** Validates one parsed YAML document. Returns the definition or a list of errors. */
export function parseAnalysis(
  doc: unknown,
  file: string
): { analysis?: AnalysisDefinition; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(doc)) return { errors: ['document must be a mapping'] };

  if (doc.schema_version !== undefined && doc.schema_version !== 1) {
    errors.push(`unsupported schema_version ${String(doc.schema_version)}`);
  }
  const name = doc.name;
  if (typeof name !== 'string' || !NAME_RE.test(name)) {
    errors.push('name must be a lowercase snake_case string');
  }
  const schedule = parseSchedule(doc.schedule);
  if (!schedule) {
    errors.push('schedule must be an interval (>= 10s, e.g. "15m") or a 5-field cron expression');
  }
  if (typeof doc.prompt !== 'string' || doc.prompt.trim() === '') {
    errors.push('prompt is required');
  }

  // --- input ---
  const input = isRecord(doc.input) ? doc.input : null;
  let parsedInput: AnalysisDefinition['input'] | null = null;
  if (!input) {
    errors.push('input is required (either input.layers or input.sql)');
  } else {
    const lookbackMs =
      input.lookback === undefined ? DEFAULT_LOOKBACK_MS : parseDurationMs(input.lookback);
    if (lookbackMs === null) errors.push('input.lookback must be a duration such as "6h"');
    const maxRaw = input.max_records ?? DEFAULT_MAX_RECORDS;
    const maxRecords =
      typeof maxRaw === 'number' && Number.isInteger(maxRaw) && maxRaw > 0
        ? Math.min(maxRaw, MAX_INPUT_RECORDS)
        : null;
    if (maxRecords === null) errors.push('input.max_records must be a positive integer');
    const runIfEmpty = input.run_if_empty === true;

    const hasLayers = input.layers !== undefined;
    const hasSql = input.sql !== undefined;
    if (hasLayers === hasSql) {
      errors.push('input needs exactly one of `layers` or `sql`');
    } else if (hasSql) {
      if (typeof input.sql !== 'string' || !looksLikeSelect(input.sql)) {
        errors.push('input.sql must be a single SELECT (or WITH ... SELECT) statement');
      } else if (lookbackMs !== null && maxRecords !== null) {
        parsedInput = { kind: 'sql', sql: input.sql, lookbackMs, maxRecords, runIfEmpty };
      }
    } else {
      const layers = input.layers;
      // Layer ids are NOT checked against the loaded sources: sources come and go (and their ids
      // are being renamed), so an unknown layer simply contributes no records at run time.
      if (
        !Array.isArray(layers) ||
        layers.length === 0 ||
        !layers.every((l) => typeof l === 'string' && NAME_RE.test(l))
      ) {
        errors.push('input.layers must be a non-empty list of lowercase layer ids');
      }
      const filter: InputFilter[] = [];
      if (input.filter !== undefined) {
        if (!Array.isArray(input.filter)) {
          errors.push('input.filter must be a list');
        } else {
          input.filter.forEach((f, i) => {
            if (!isRecord(f) || typeof f.field !== 'string' || !FILTER_FIELD_RE.test(f.field)) {
              errors.push(`input.filter[${i}].field is invalid`);
            } else if (!(FILTER_OPS as readonly unknown[]).includes(f.op)) {
              errors.push(`input.filter[${i}].op must be one of ${FILTER_OPS.join(' ')}`);
            } else if (f.op === 'in' && !Array.isArray(f.value)) {
              errors.push(`input.filter[${i}].value must be a list for op "in"`);
            } else {
              filter.push({ field: f.field, op: f.op as InputFilter['op'], value: f.value });
            }
          });
        }
      }
      if (errors.length === 0 && lookbackMs !== null && maxRecords !== null) {
        parsedInput = {
          kind: 'layers',
          layers: layers as string[],
          lookbackMs,
          maxRecords,
          filter,
          runIfEmpty
        };
      }
    }
  }

  // --- output ---
  const output = doc.output === undefined ? {} : doc.output;
  let dataSchema: JsonSchema | null = null;
  let maxInsights = DEFAULT_MAX_INSIGHTS;
  if (!isRecord(output)) {
    errors.push('output must be a mapping');
  } else {
    if (output.max_insights !== undefined) {
      const m = output.max_insights;
      if (typeof m !== 'number' || !Number.isInteger(m) || m < 1 || m > 20) {
        errors.push('output.max_insights must be an integer 1-20');
      } else maxInsights = m;
    }
    if (output.schema !== undefined) {
      const problems = checkSchema(output.schema, 'output.schema');
      if (problems.length === 0 && (output.schema as JsonSchema).type !== 'object') {
        problems.push('output.schema must describe an object');
      }
      errors.push(...problems);
      if (problems.length === 0) dataSchema = normalizeSchema(output.schema as JsonSchema);
    }
  }

  const minAttention = doc.min_attention ?? 'low';
  if (!isAttention(minAttention)) {
    errors.push(`min_attention must be one of ${ATTENTION_LEVELS.join(', ')}`);
  }
  const dedupWindowMs =
    doc.dedup_window === undefined ? DEFAULT_DEDUP_WINDOW_MS : parseDurationMs(doc.dedup_window);
  if (dedupWindowMs === null) errors.push('dedup_window must be a duration');
  const retentionMs =
    doc.retention === undefined ? DEFAULT_RETENTION_MS : parseDurationMs(doc.retention);
  if (retentionMs === null) errors.push('retention must be a duration');

  if (errors.length > 0 || !parsedInput || !schedule) return { errors };
  return {
    errors,
    analysis: {
      name: name as string,
      description: typeof doc.description === 'string' ? doc.description.trim() : '',
      enabled: doc.enabled !== false,
      schedule,
      input: parsedInput,
      prompt: doc.prompt as string,
      output: { maxInsights, dataSchema },
      minAttention: minAttention as AnalysisDefinition['minAttention'],
      dedupWindowMs: dedupWindowMs as number,
      retentionMs: retentionMs as number,
      file
    }
  };
}

/** Loads every `*.yaml` / `*.yml` in `dir`. A missing directory yields no analyses. */
export function loadAnalysesFromDir(dir: string): LoadResult {
  const result: LoadResult = { analyses: [], errors: [] };
  if (!fs.existsSync(dir)) return result;
  const seen = new Set<string>();
  for (const entry of fs.readdirSync(dir).sort()) {
    if (!/\.ya?ml$/i.test(entry)) continue;
    const file = path.join(dir, entry);
    let doc: unknown;
    try {
      doc = YAML.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      result.errors.push({ file: entry, errors: [`YAML parse error: ${(err as Error).message}`] });
      continue;
    }
    const { analysis, errors } = parseAnalysis(doc, entry);
    if (analysis && seen.has(analysis.name)) {
      result.errors.push({ file: entry, errors: [`duplicate analysis name "${analysis.name}"`] });
    } else if (analysis) {
      seen.add(analysis.name);
      result.analyses.push(analysis);
    } else {
      result.errors.push({ file: entry, errors });
    }
  }
  return result;
}
