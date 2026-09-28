import type { JsonSchema } from './json-schema';
import type { Schedule } from './schedule';

/** Ordered attention levels, lowest first. */
export const ATTENTION_LEVELS = ['info', 'low', 'medium', 'high', 'critical'] as const;
export type Attention = (typeof ATTENTION_LEVELS)[number];

export function isAttention(value: unknown): value is Attention {
  return typeof value === 'string' && (ATTENTION_LEVELS as readonly string[]).includes(value);
}

export function attentionRank(level: Attention): number {
  return ATTENTION_LEVELS.indexOf(level);
}

export const FILTER_OPS = ['==', '!=', '>', '>=', '<', '<=', 'in', 'contains', 'exists'] as const;
export type FilterOp = (typeof FILTER_OPS)[number];

export interface InputFilter {
  /** `name`, `category`, `source_id`, `latitude`, `longitude`, `altitude`, `timestamp`, `metadata.<path>` */
  field: string;
  op: FilterOp;
  value?: unknown;
}

export interface LayersInput {
  kind: 'layers';
  layers: string[];
  lookbackMs: number;
  maxRecords: number;
  filter: InputFilter[];
}

export interface SqlInput {
  kind: 'sql';
  sql: string;
  lookbackMs: number;
  maxRecords: number;
}

/** A validated `analysis.d/*.yaml` definition with defaults applied. */
export interface AnalysisDefinition {
  name: string;
  description: string;
  enabled: boolean;
  schedule: Schedule;
  input: (LayersInput | SqlInput) & { runIfEmpty: boolean };
  prompt: string;
  output: { maxInsights: number; dataSchema: JsonSchema | null };
  minAttention: Attention;
  dedupWindowMs: number;
  retentionMs: number;
  file: string;
}

/** One insight as returned by the model (before persistence). */
export interface ModelInsight {
  title: string;
  summary: string;
  attention: Attention;
  entity_ids: string[];
  data?: Record<string, unknown>;
}

/** Wire format of a stored insight (REST `GET /api/insights` and WS `ai_insight`). */
export interface InsightRecord {
  id: string;
  analysis: string;
  title: string;
  summary: string;
  attention: Attention;
  created_at: string;
  payload: Record<string, unknown>;
  refs: string[];
}
