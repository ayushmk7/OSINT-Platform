import Database from 'better-sqlite3';
import { SourceConfig } from './yaml-loader';

/**
 * Persist a source's defaults-applied `layer` / `display` blocks onto its `sources` row, so
 * GET /api/sources and the WS `initial_state` frame can hand them to the frontend.
 */
export function saveSourcePresentation(db: Database.Database, config: SourceConfig): void {
  db.prepare('UPDATE sources SET layer = ?, display = ? WHERE id = ?').run(
    config.layer ? JSON.stringify(config.layer) : null,
    config.display ? JSON.stringify(config.display) : null,
    config.name
  );
}
