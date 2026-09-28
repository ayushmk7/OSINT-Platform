import path from 'path';
import type Database from 'better-sqlite3';
import { AnalysisEngine } from './engine';
import { loadAnalysesFromDir } from './loader';
import { createProviderFromEnv } from './providers';
import { setAnalysisStatus } from './status';
import type { InsightRecord } from './types';

export { AnalysisEngine } from './engine';
export { createInsightsRouter } from './routes';
export { getAnalysisStatus, type AnalysisStatus } from './status';

/** Default `analysis.d/` at the repo root (resolves from both `src/` and `dist/`). */
export const DEFAULT_ANALYSIS_DIR = path.resolve(__dirname, '../../../analysis.d');

/**
 * Loads `analysis.d`, picks the LLM provider from the environment and starts the scheduler.
 * Returns null (after ONE info log) when no provider is configured — ingestion and the rest of
 * the app are unaffected, and `GET /api/insights` keeps answering with stored insights.
 */
export function startAnalysisEngine(
  db: Database.Database,
  options: { dir?: string; onInsight?: (insight: InsightRecord) => void } = {}
): AnalysisEngine | null {
  const dir = options.dir || process.env.MKOSINT_ANALYSIS_DIR || DEFAULT_ANALYSIS_DIR;
  const { analyses, errors } = loadAnalysesFromDir(dir);
  for (const e of errors) {
    console.warn(`[analysis] ${e.file} skipped: ${e.errors.join('; ')}`);
  }
  const listing = analyses.map((a) => ({
    name: a.name,
    description: a.description,
    schedule: a.schedule.source,
    enabled: a.enabled
  }));

  const selection = createProviderFromEnv();
  if (!selection.provider) {
    console.info(`[analysis] AI analysis disabled: ${selection.reason}`);
    setAnalysisStatus({
      enabled: false,
      reason: selection.reason,
      provider: null,
      model: null,
      analyses: listing
    });
    return null;
  }

  const engine = new AnalysisEngine(db, {
    provider: selection.provider,
    analyses,
    onInsight: options.onInsight
  });
  engine.start();
  setAnalysisStatus({
    enabled: true,
    reason: null,
    provider: selection.provider.name,
    model: selection.provider.model,
    analyses: listing
  });
  console.info(
    `[analysis] AI analysis enabled: ${engine.analysisNames.length} analyses from ${dir} ` +
      `(${selection.provider.name}/${selection.provider.model})`
  );
  return engine;
}
