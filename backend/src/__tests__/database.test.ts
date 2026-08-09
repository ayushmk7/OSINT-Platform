import { initDatabase, closeDatabase } from '../db/database';
import Database from 'better-sqlite3';

describe('Database Initialization', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase(':memory:');
  });

  afterEach(() => {
    closeDatabase(db);
  });

  it('should create sources, entities, and observations tables', () => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {
      name: string;
    }[];

    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toContain('sources');
    expect(tableNames).toContain('entities');
    expect(tableNames).toContain('observations');
  });

  it('should allow inserting and fetching sources', () => {
    const stmt = db.prepare(`
      INSERT INTO sources (id, name, type, transport, url, update_interval_sec, enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      'test-source-1',
      'Test Source',
      'earthquakes',
      'http',
      'http://example.com/api',
      30,
      1
    );

    const source = db.prepare('SELECT * FROM sources WHERE id = ?').get('test-source-1') as any;
    expect(source).toBeDefined();
    expect(source.name).toBe('Test Source');
    expect(source.enabled).toBe(1);
  });
});
