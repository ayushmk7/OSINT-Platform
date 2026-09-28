import crypto from 'crypto';
import type Database from 'better-sqlite3';
import { parseJsonObject } from '../db/queries';
import { attentionRank, type Attention, type InsightRecord, type ModelInsight } from './types';

export const MAX_INSIGHTS_PAGE = 200;
export const DEFAULT_INSIGHTS_PAGE = 50;

/**
 * Creates the insight tables. Called by the insights router and the analysis engine, so the
 * REST endpoint works (returning an empty list) even when no LLM provider is configured.
 * `attention_rank` duplicates `attention` as 0-4 so "at least medium" is an index-friendly `>=`.
 */
export function ensureInsightTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_insights (
        id TEXT PRIMARY KEY,
        analysis TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        attention TEXT NOT NULL,
        attention_rank INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        payload TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_ai_insights_created_at ON ai_insights(created_at);
    CREATE INDEX IF NOT EXISTS idx_ai_insights_analysis ON ai_insights(analysis, created_at);

    CREATE TABLE IF NOT EXISTS ai_insight_refs (
        insight_id TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        PRIMARY KEY (insight_id, entity_id),
        FOREIGN KEY (insight_id) REFERENCES ai_insights(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_ai_insight_refs_entity ON ai_insight_refs(entity_id);
  `);
}

type Row = Record<string, unknown>;

function toRecord(row: Row, refs: string[]): InsightRecord {
  return {
    id: String(row.id),
    analysis: String(row.analysis),
    title: String(row.title),
    summary: String(row.summary),
    attention: row.attention as Attention,
    created_at: String(row.created_at),
    payload: parseJsonObject(row.payload),
    refs
  };
}

/** Persists one model insight with its entity refs. Returns the wire record. */
export function insertInsight(
  db: Database.Database,
  analysis: string,
  insight: ModelInsight,
  payload: Record<string, unknown>,
  createdAt: Date
): InsightRecord {
  const id = crypto.randomUUID();
  const refs = [...new Set(insight.entity_ids)];
  const row = {
    id,
    analysis,
    title: insight.title,
    summary: insight.summary,
    attention: insight.attention,
    attention_rank: attentionRank(insight.attention),
    created_at: createdAt.toISOString(),
    payload: JSON.stringify(payload)
  };
  db.transaction(() => {
    db.prepare(
      `INSERT INTO ai_insights (id, analysis, title, summary, attention, attention_rank, created_at, payload)
       VALUES (@id, @analysis, @title, @summary, @attention, @attention_rank, @created_at, @payload)`
    ).run(row);
    const ref = db.prepare(
      'INSERT OR IGNORE INTO ai_insight_refs (insight_id, entity_id) VALUES (?, ?)'
    );
    for (const entityId of refs) ref.run(id, entityId);
  })();
  return toRecord(row, refs);
}

export interface InsightQuery {
  limit?: number;
  /** Minimum attention level (inclusive). */
  attention?: Attention;
  /** ISO timestamp; only insights created strictly after it. */
  since?: string;
}

export function listInsights(db: Database.Database, query: InsightQuery = {}): InsightRecord[] {
  const limit = Math.min(Math.max(query.limit ?? DEFAULT_INSIGHTS_PAGE, 1), MAX_INSIGHTS_PAGE);
  let where = 'WHERE 1=1';
  const params: (string | number)[] = [];
  if (query.attention) {
    where += ' AND attention_rank >= ?';
    params.push(attentionRank(query.attention));
  }
  if (query.since) {
    where += ' AND created_at > ?';
    params.push(query.since);
  }
  const rows = db
    .prepare(`SELECT * FROM ai_insights ${where} ORDER BY created_at DESC, id ASC LIMIT ?`)
    .all(...params, limit) as Row[];
  if (rows.length === 0) return [];
  const refRows = db
    .prepare(
      `SELECT insight_id, entity_id FROM ai_insight_refs
       WHERE insight_id IN (${rows.map(() => '?').join(',')}) ORDER BY rowid`
    )
    .all(...rows.map((r) => r.id as string)) as { insight_id: string; entity_id: string }[];
  const byInsight = new Map<string, string[]>();
  for (const r of refRows) {
    const list = byInsight.get(r.insight_id) ?? [];
    list.push(r.entity_id);
    byInsight.set(r.insight_id, list);
  }
  return rows.map((r) => toRecord(r, byInsight.get(r.id as string) ?? []));
}

/** Deletes an analysis's insights older than `before`. Returns rows removed. */
export function pruneInsights(db: Database.Database, analysis: string, before: Date): number {
  const cutoff = before.toISOString();
  return db.transaction(() => {
    db.prepare(
      `DELETE FROM ai_insight_refs WHERE insight_id IN
         (SELECT id FROM ai_insights WHERE analysis = ? AND created_at < ?)`
    ).run(analysis, cutoff);
    return db
      .prepare('DELETE FROM ai_insights WHERE analysis = ? AND created_at < ?')
      .run(analysis, cutoff).changes;
  })();
}
