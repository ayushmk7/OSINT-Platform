import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import Database from 'better-sqlite3';
import { initDatabase, closeDatabase } from '../db/database';
import { createApp } from '../app';
import { loadAnalysesFromDir, parseAnalysis } from '../analysis/loader';
import {
  nextCronRun,
  nextRunTime,
  parseCron,
  parseDurationMs,
  parseSchedule
} from '../analysis/schedule';
import {
  assertReadOnlySql,
  bindParams,
  runReadOnlyQuery,
  SqlGuardError
} from '../analysis/sql-guard';
import { haversineKm, registerSqlFunctions } from '../analysis/sql-functions';
import { AnalysisEngine, buildOutputSchema } from '../analysis/engine';
import { collectInput, renderPrompt } from '../analysis/input';
import { validateJson } from '../analysis/json-schema';
import { AnthropicProvider } from '../analysis/providers/anthropic';
import { OpenAiCompatibleProvider } from '../analysis/providers/openai';
import { createProviderFromEnv, type LlmProvider } from '../analysis/providers';
import { insertInsight, listInsights } from '../analysis/store';
import { setAnalysisStatus } from '../analysis/status';
import type { AnalysisDefinition } from '../analysis/types';
import WebSocket from 'ws';
import { TelemetryBroadcaster } from '../websocket/broadcaster';

const REPO_ANALYSIS_DIR = path.resolve(__dirname, '../../../analysis.d');
const silentLog = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

function seed(db: Database.Database): void {
  db.prepare(
    `INSERT INTO sources (id, name, type, transport, url, update_interval_sec, enabled)
     VALUES ('src', 'S', 't', 'http_poll', 'http://x', 60, 1)`
  ).run();
}

function addEntity(
  db: Database.Database,
  id: string,
  category: string,
  lat: number,
  lon: number,
  ts: string,
  metadata: Record<string, unknown> = {}
): void {
  db.prepare(
    `INSERT OR REPLACE INTO entities (id, source_id, category, name, latitude, longitude, altitude, timestamp, metadata)
     VALUES (?, 'src', ?, ?, ?, ?, 0, ?, ?)`
  ).run(id, category, id.toUpperCase(), lat, lon, ts, JSON.stringify(metadata));
}

function definition(overrides: Record<string, unknown> = {}): AnalysisDefinition {
  const { analysis, errors } = parseAnalysis(
    {
      name: 'test_analysis',
      schedule: '15m',
      input: { layers: ['geological'], lookback: '6h' },
      prompt: 'Quakes at {{now}}: {{stats}}\n{{records}}',
      ...overrides
    },
    'test.yaml'
  );
  if (!analysis) throw new Error(errors.join('; '));
  return analysis;
}

/** A provider whose reply is scripted per call. */
function fakeProvider(reply: (user: string) => unknown): LlmProvider & { calls: string[] } {
  const calls: string[] = [];
  return {
    name: 'fake',
    model: 'fake-1',
    calls,
    async complete(req) {
      calls.push(req.user);
      return reply(req.user);
    }
  };
}

describe('analysis loader', () => {
  it('loads every shipped analysis.d example without errors', () => {
    const { analyses, errors } = loadAnalysesFromDir(REPO_ANALYSIS_DIR);
    expect(errors).toEqual([]);
    expect(analyses.length).toBeGreaterThanOrEqual(6);
    expect(new Set(analyses.map((a) => a.name)).size).toBe(analyses.length);
  });

  it('every shipped SQL input passes the read-only guard and runs against the real schema', async () => {
    const db = initDatabase(':memory:');
    try {
      seed(db);
      const now = new Date();
      const recent = new Date(now.getTime() - 60_000).toISOString();
      addEntity(db, 'quake', 'geological', 35, 139, recent, { magnitude: 6.2 });
      addEntity(db, 'plane', 'aircraft', 35.5, 139.5, recent, { type: 'C130' });
      addEntity(db, 'rjtt', 'atc_zone', 35.55, 139.78, recent, { airport_type: 'large_airport' });
      for (const a of loadAnalysesFromDir(REPO_ANALYSIS_DIR).analyses) {
        if (a.input.kind !== 'sql') continue;
        const input = await collectInput(db, a, now);
        expect(Array.isArray(input.records)).toBe(true);
      }
      const byName = (n: string) =>
        loadAnalysesFromDir(REPO_ANALYSIS_DIR).analyses.find((a) => a.name === n)!;
      const pairs = await collectInput(db, byName('aircraft_near_quakes'), now);
      expect(pairs.records).toHaveLength(1);
      expect([...pairs.entityIds].sort()).toEqual(['plane', 'quake']);
      const exposure = await collectInput(db, byName('infrastructure_exposure'), now);
      expect(exposure.records[0]).toMatchObject({ facility_id: 'rjtt', quake_id: 'quake' });
    } finally {
      closeDatabase(db);
    }
  });

  it('applies defaults and tolerates unknown layer ids', () => {
    const a = definition({ input: { layers: ['not_a_real_layer_yet'] } });
    expect(a.enabled).toBe(true);
    expect(a.minAttention).toBe('low');
    expect(a.input).toMatchObject({
      kind: 'layers',
      maxRecords: 200,
      layers: ['not_a_real_layer_yet']
    });
    expect(a.output.dataSchema).toBeNull();
  });

  it('normalises the output data schema to the strict form', () => {
    const a = definition({
      output: { schema: { type: 'object', properties: { n: { type: 'integer' } } } }
    });
    expect(a.output.dataSchema).toEqual({
      type: 'object',
      properties: { n: { type: 'integer' } },
      required: ['n'],
      additionalProperties: false
    });
  });

  it.each([
    [{ name: 'Bad-Name' }, /name/],
    [{ schedule: '5s' }, /schedule/],
    [{ schedule: '* * *' }, /schedule/],
    [{ input: { layers: ['a'], sql: 'SELECT 1' } }, /exactly one/],
    [{ input: { sql: 'DELETE FROM entities' } }, /single SELECT/],
    [{ input: { sql: 'SELECT 1; DROP TABLE entities' } }, /single SELECT/],
    [{ input: { layers: ['a'], filter: [{ field: 'x', op: '==' }] } }, /filter\[0\]\.field/],
    [{ min_attention: 'urgent' }, /min_attention/],
    [{ output: { schema: { type: 'string' } } }, /describe an object/],
    [{ prompt: '' }, /prompt/]
  ])('rejects %j', (overrides, pattern) => {
    const { analysis, errors } = parseAnalysis(
      {
        name: 'x',
        schedule: '15m',
        input: { layers: ['geological'] },
        prompt: 'p',
        ...overrides
      },
      'f.yaml'
    );
    expect(analysis).toBeUndefined();
    expect(errors.join('\n')).toMatch(pattern);
  });

  it('reports YAML and duplicate-name errors per file and returns [] for a missing dir', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mkosint-analysis-'));
    const doc = 'name: dup\nschedule: 1h\ninput: { layers: [x] }\nprompt: hi\n';
    fs.writeFileSync(path.join(dir, 'a.yaml'), doc);
    fs.writeFileSync(path.join(dir, 'b.yaml'), doc);
    fs.writeFileSync(path.join(dir, 'c.yaml'), 'name: [unclosed');
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'ignored');
    const { analyses, errors } = loadAnalysesFromDir(dir);
    expect(analyses.map((a) => a.name)).toEqual(['dup']);
    expect(errors.map((e) => e.file)).toEqual(['b.yaml', 'c.yaml']);
    expect(loadAnalysesFromDir(path.join(dir, 'missing')).analyses).toEqual([]);
  });
});

describe('analysis schedule', () => {
  it('parses durations', () => {
    expect(parseDurationMs('15m')).toBe(900_000);
    expect(parseDurationMs('7d')).toBe(604_800_000);
    expect(parseDurationMs('1.5h')).toBe(5_400_000);
    expect(parseDurationMs('soon')).toBeNull();
    expect(parseDurationMs('0s')).toBeNull();
  });

  it('computes the next cron run in UTC', () => {
    const from = new Date('2026-09-28T10:07:30Z');
    const at = (expr: string) => nextCronRun(parseCron(expr)!, from).toISOString();
    expect(at('*/15 * * * *')).toBe('2026-09-28T10:15:00.000Z');
    expect(at('5,35 * * * *')).toBe('2026-09-28T10:35:00.000Z');
    expect(at('0 6 * * *')).toBe('2026-09-29T06:00:00.000Z');
    expect(at('0 */3 * * *')).toBe('2026-09-28T12:00:00.000Z');
    // 2026-09-28 is a Monday; next Sunday 00:00 (both 0 and 7 mean Sunday).
    expect(at('0 0 * * 0')).toBe('2026-10-04T00:00:00.000Z');
    expect(at('0 0 * * 7')).toBe('2026-10-04T00:00:00.000Z');
    expect(at('30 9 1 1 *')).toBe('2027-01-01T09:30:00.000Z');
    // dom OR dow when both are restricted: the 1st of the month OR any Wednesday.
    expect(at('0 0 1 * 3')).toBe('2026-09-30T00:00:00.000Z');
    expect(parseCron('60 * * * *')).toBeNull();
    expect(parseCron('* * * *')).toBeNull();
  });

  it('interval schedules fire after the first-run delay, then every interval', () => {
    const s = parseSchedule('15m')!;
    const now = new Date('2026-01-01T00:00:00Z');
    expect(nextRunTime(s, now, null, 60_000).toISOString()).toBe('2026-01-01T00:01:00.000Z');
    expect(nextRunTime(s, now, now).toISOString()).toBe('2026-01-01T00:15:00.000Z');
    // A run that is overdue (server was busy) fires now rather than in the past.
    const late = new Date('2026-01-01T01:00:00Z');
    expect(nextRunTime(s, late, now).toISOString()).toBe(late.toISOString());
  });

  it('engine ticks run only due analyses and reschedule them', async () => {
    const db = initDatabase(':memory:');
    try {
      seed(db);
      let clock = new Date('2026-01-01T00:00:00Z');
      addEntity(db, 'q1', 'geological', 10, 10, '2026-01-01T00:00:00Z', { magnitude: 3 });
      const provider = fakeProvider(() => ({ insights: [] }));
      const engine = new AnalysisEngine(db, {
        provider,
        analyses: [definition({ dedup_window: '1s' })],
        now: () => clock,
        firstRunDelayMs: 60_000,
        log: silentLog
      });
      expect(engine.schedule()[0].next_run).toBe('2026-01-01T00:01:00.000Z');
      expect(await engine.tick()).toEqual([]);

      clock = new Date('2026-01-01T00:01:00Z');
      expect((await engine.tick()).map((r) => r.status)).toEqual(['ok']);
      expect(engine.schedule()[0].next_run).toBe('2026-01-01T00:16:00.000Z');

      clock = new Date('2026-01-01T00:10:00Z');
      expect(await engine.tick()).toEqual([]);
      clock = new Date('2026-01-01T00:16:00Z');
      expect(await engine.tick()).toHaveLength(1);
      expect(provider.calls).toHaveLength(2);
    } finally {
      closeDatabase(db);
    }
  });
});

describe('SQL guard', () => {
  let db: Database.Database;
  const params = { since: '2000-01-01T00:00:00Z', now: '2100-01-01T00:00:00Z' };

  beforeEach(() => {
    db = initDatabase(':memory:');
    registerSqlFunctions(db);
  });
  afterEach(() => closeDatabase(db));

  it.each([
    'DELETE FROM entities',
    'SELECT 1; DELETE FROM entities',
    'WITH x AS (SELECT 1) INSERT INTO sources SELECT * FROM x',
    'PRAGMA journal_mode = DELETE',
    "ATTACH DATABASE 'x.db' AS x",
    'SELECT * FROM no_such_table'
  ])('refuses %s', (sql) => {
    expect(() => assertReadOnlySql(db, sql)).toThrow(SqlGuardError);
  });

  it('binds only the parameters the SQL uses', () => {
    expect(bindParams('SELECT 1 WHERE :since < @now', params)).toEqual(params);
    expect(bindParams('SELECT 1', params)).toEqual({});
  });

  it('caps rows at the requested limit and provides haversine_km', async () => {
    const sql = `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 2000)
                 SELECT i, haversine_km(0, 0, 0, 1) AS d FROM n`;
    const res = await runReadOnlyQuery(db, sql, params, { rowCap: 50 });
    expect(res.rows).toHaveLength(50);
    expect(res.truncated).toBe(true);
    expect(res.rows[0].d as number).toBeCloseTo(111.19, 1);
  });

  it('haversine_km matches known distances and handles nulls', () => {
    expect(haversineKm(51.5074, -0.1278, 48.8566, 2.3522)!).toBeCloseTo(343.5, 0); // London-Paris
    expect(haversineKm(null, 0, 0, 0)).toBeNull();
    expect(db.prepare('SELECT haversine_km(NULL, 0, 0, 0) AS d').get()).toEqual({ d: null });
  });

  it('runs file-backed queries on a separate read-only process and kills runaway queries', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mkosint-sql-'));
    const fileDb = initDatabase(path.join(dir, 'test.db'));
    try {
      seed(fileDb);
      addEntity(fileDb, 'a', 'aircraft', 51.5, -0.12, '2026-01-01T00:00:00Z');
      const ok = await runReadOnlyQuery(
        fileDb,
        'SELECT id, haversine_km(latitude, longitude, 48.86, 2.35) AS d FROM entities WHERE timestamp >= :since',
        params
      );
      expect(ok.rows).toHaveLength(1);
      expect(ok.rows[0].d as number).toBeGreaterThan(300);

      const started = Date.now();
      await expect(
        runReadOnlyQuery(
          fileDb,
          'WITH RECURSIVE c(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM c) SELECT count(*) FROM c',
          params,
          { timeoutMs: 400 }
        )
      ).rejects.toThrow(/timed out/);
      expect(Date.now() - started).toBeLessThan(3000);
    } finally {
      closeDatabase(fileDb);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('analysis input, dedup and engine gates', () => {
  let db: Database.Database;
  let clock: Date;

  beforeEach(() => {
    db = initDatabase(':memory:');
    seed(db);
    clock = new Date('2026-01-01T12:00:00Z');
    addEntity(db, 'q1', 'geological', 35, 139, '2026-01-01T11:00:00Z', { magnitude: 5.1 });
    addEntity(db, 'q2', 'geological', 35.1, 139.1, '2026-01-01T11:30:00Z', { magnitude: 2.0 });
    addEntity(db, 'old', 'geological', 0, 0, '2025-12-01T00:00:00Z', { magnitude: 7 });
    addEntity(db, 'r1', 'radiation', 0, 0, '2026-01-01T11:00:00Z', { cpm: 40 });
  });
  afterEach(() => closeDatabase(db));

  it('collects layer records within the lookback, applying filters', async () => {
    const a = definition({
      input: {
        layers: ['geological', 'future_layer'],
        lookback: '6h',
        filter: [{ field: 'metadata.magnitude', op: '>=', value: 4 }]
      }
    });
    const input = await collectInput(db, a, clock);
    expect(input.records.map((r) => r.id)).toEqual(['q1']);
    expect(input.stats).toMatchObject({ total: 1, by_layer: { geological: 1 }, truncated: false });
    const prompt = renderPrompt(a.prompt, input, clock);
    expect(prompt).toContain('2026-01-01T12:00:00.000Z');
    expect(prompt).toContain('"id":"q1"');
    expect(prompt).not.toContain('{{');
  });

  it('appends records when the template has no {{records}} placeholder', async () => {
    const a = definition({ prompt: 'Look at these.' });
    const text = renderPrompt(a.prompt, await collectInput(db, a, clock), clock);
    expect(text).toMatch(/^Look at these\.\n\nRecords \(JSON lines\):\n/);
  });

  it('skips unchanged input within the dedup window and re-runs when it changes or expires', async () => {
    const provider = fakeProvider(() => ({ insights: [] }));
    const engine = new AnalysisEngine(db, {
      provider,
      analyses: [definition({ dedup_window: '1h' })],
      now: () => clock,
      log: silentLog
    });
    expect((await engine.runNow('test_analysis')).status).toBe('ok');
    expect((await engine.runNow('test_analysis')).status).toBe('skipped_duplicate');

    addEntity(db, 'q3', 'geological', 36, 140, '2026-01-01T11:45:00Z', { magnitude: 3 });
    expect((await engine.runNow('test_analysis')).status).toBe('ok');
    expect((await engine.runNow('test_analysis')).status).toBe('skipped_duplicate');

    clock = new Date(clock.getTime() + 61 * 60_000); // window expired; q1..q3 still in lookback
    expect((await engine.runNow('test_analysis')).status).toBe('ok');
    expect(provider.calls).toHaveLength(3);
  });

  it('does not call the model when the input is empty', async () => {
    const provider = fakeProvider(() => ({ insights: [] }));
    const engine = new AnalysisEngine(db, {
      provider,
      analyses: [definition({ input: { layers: ['nothing_here'] } })],
      now: () => clock,
      log: silentLog
    });
    expect((await engine.runNow('test_analysis')).status).toBe('skipped_empty');
    expect(provider.calls).toHaveLength(0);
  });

  it('stores insights above min_attention, drops unknown refs, broadcasts, and prunes by retention', async () => {
    const provider = fakeProvider(() => ({
      insights: [
        {
          title: 'Strong quake',
          summary: 'M5.1 near Tokyo.',
          attention: 'high',
          entity_ids: ['q1', 'q2', 'invented', 'r1'],
          data: { n: 2 }
        },
        { title: 'Noise', summary: 'meh', attention: 'info', entity_ids: [], data: { n: 0 } }
      ]
    }));
    const onInsight = jest.fn();
    const engine = new AnalysisEngine(db, {
      provider,
      analyses: [
        definition({
          min_attention: 'medium',
          retention: '30d',
          output: { schema: { type: 'object', properties: { n: { type: 'integer' } } } }
        })
      ],
      now: () => clock,
      onInsight,
      log: silentLog
    });
    insertInsight(
      db,
      'test_analysis',
      { title: 'ancient', summary: 's', attention: 'high', entity_ids: [] },
      {},
      new Date('2025-01-01T00:00:00Z')
    );
    const result = await engine.runNow('test_analysis');
    expect(result.status).toBe('ok');
    expect(result.insights).toHaveLength(1);
    // r1 exists but was not part of this analysis' input; `invented` does not exist at all.
    expect(result.insights[0].refs).toEqual(['q1', 'q2']);
    expect(result.insights[0].payload).toMatchObject({ model: 'fake-1', data: { n: 2 } });
    expect(onInsight).toHaveBeenCalledWith(result.insights[0]);

    const stored = listInsights(db);
    expect(stored.map((i) => i.title)).toEqual(['Strong quake']);
    expect(stored[0].refs).toEqual(['q1', 'q2']);
  });

  it('rejects model output that does not match the schema and retries next time', async () => {
    let good = false;
    const provider = fakeProvider(() =>
      good
        ? { insights: [] }
        : { insights: [{ title: 't', summary: 's', attention: 'extreme', entity_ids: [] }] }
    );
    const engine = new AnalysisEngine(db, {
      provider,
      analyses: [definition()],
      now: () => clock,
      log: silentLog
    });
    const bad = await engine.runNow('test_analysis');
    expect(bad.status).toBe('error');
    expect(bad.error).toMatch(/attention/);
    good = true;
    expect((await engine.runNow('test_analysis')).status).toBe('ok'); // not deduped after failure
  });

  it('builds a closed envelope schema with the optional data object', () => {
    const plain = buildOutputSchema(definition());
    expect(validateJson({ insights: [] }, plain)).toEqual([]);
    expect(validateJson({ insights: [], extra: 1 }, plain)).toEqual([
      '$.extra: unexpected property'
    ]);
    const withData = buildOutputSchema(
      definition({ output: { schema: { type: 'object', properties: { n: { type: 'integer' } } } } })
    );
    const item = { title: 't', summary: 's', attention: 'low', entity_ids: [] };
    expect(validateJson({ insights: [item] }, withData)).toEqual([
      '$.insights[0].data: is required'
    ]);
    expect(validateJson({ insights: [{ ...item, data: { n: 1.5 } }] }, withData)[0]).toMatch(
      /expected integer/
    );
  });
});

describe('LLM providers', () => {
  const req = {
    system: 'sys',
    user: 'usr',
    schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
    schemaName: 'mkosint_insights'
  };

  function mockFetch(body: unknown, status = 200) {
    return jest.fn(
      async () =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' }
        })
    );
  }

  it('anthropic: posts a Messages request with a JSON-schema output format', async () => {
    const fetchImpl = mockFetch({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: '{"insights":[]}' }]
    });
    const p = new AnthropicProvider({ apiKey: 'sk-test', fetchImpl });
    await expect(p.complete(req)).resolves.toEqual({ insights: [] });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.headers).toMatchObject({
      'x-api-key': 'sk-test',
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    });
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      model: 'claude-sonnet-5',
      system: 'sys',
      messages: [{ role: 'user', content: 'usr' }],
      output_config: { format: { type: 'json_schema', schema: req.schema } }
    });
    expect(body.max_tokens).toBeGreaterThan(0);
    expect(init.signal).toBeDefined();
  });

  it('anthropic: surfaces refusals, truncation and HTTP errors', async () => {
    const refusal = new AnthropicProvider({
      apiKey: 'k',
      fetchImpl: mockFetch({ stop_reason: 'refusal', content: [] })
    });
    await expect(refusal.complete(req)).rejects.toThrow(/refusal/);
    const cut = new AnthropicProvider({
      apiKey: 'k',
      fetchImpl: mockFetch({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{' }] })
    });
    await expect(cut.complete(req)).rejects.toThrow(/max_tokens/);
    const http = new AnthropicProvider({
      apiKey: 'k',
      fetchImpl: mockFetch({ error: { message: 'bad key' } }, 401)
    });
    await expect(http.complete(req)).rejects.toThrow(/HTTP 401/);
  });

  it('openai-compatible: strict json_schema by default, bearer auth only with a key', async () => {
    const fetchImpl = mockFetch({
      choices: [{ finish_reason: 'stop', message: { content: '```json\n{"insights":[]}\n```' } }]
    });
    const p = new OpenAiCompatibleProvider({
      baseUrl: 'http://localhost:11434/v1/',
      model: 'llama3.1',
      fetchImpl
    });
    await expect(p.complete(req)).resolves.toEqual({ insights: [] });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://localhost:11434/v1/chat/completions');
    expect(init.headers).not.toHaveProperty('authorization');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('llama3.1');
    expect(body.messages).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'usr' }
    ]);
    expect(body.response_format).toEqual({
      type: 'json_schema',
      json_schema: { name: 'mkosint_insights', strict: true, schema: req.schema }
    });
  });

  it('openai-compatible: json_object mode embeds the schema in the system prompt', () => {
    const p = new OpenAiCompatibleProvider({ apiKey: 'sk-o', responseFormat: 'json_object' });
    const { url, init } = p.buildRequest(req);
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(init.headers).toMatchObject({ authorization: 'Bearer sk-o' });
    const body = JSON.parse(init.body as string);
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.messages[0].content).toContain('"additionalProperties":false');
  });

  it('selects the provider from the environment', () => {
    expect(createProviderFromEnv({}).provider).toBeNull();
    expect(createProviderFromEnv({}).reason).toMatch(/ANTHROPIC_API_KEY/);
    const a = createProviderFromEnv({ ANTHROPIC_API_KEY: 'k', MKOSINT_LLM_MODEL: 'claude-opus-5' });
    expect(a.provider).toMatchObject({ name: 'anthropic', model: 'claude-opus-5' });
    const o = createProviderFromEnv({
      MKOSINT_LLM_PROVIDER: 'openai',
      MKOSINT_OPENAI_BASE_URL: 'http://localhost:1234/v1'
    });
    expect(o.provider).toMatchObject({ name: 'openai' });
    expect(createProviderFromEnv({ MKOSINT_LLM_PROVIDER: 'openai' }).provider).toBeNull();
    expect(createProviderFromEnv({ MKOSINT_LLM_PROVIDER: 'nope' }).reason).toMatch(/unknown/);
  });
});

describe('GET /api/insights', () => {
  let db: Database.Database;
  let app: ReturnType<typeof createApp>;

  beforeAll(() => {
    db = initDatabase(':memory:');
    app = createApp(db);
    const at = (iso: string) => new Date(iso);
    insertInsight(
      db,
      'a',
      { title: 'one', summary: 's', attention: 'info', entity_ids: [] },
      {},
      at('2026-01-01T00:00:00Z')
    );
    insertInsight(
      db,
      'a',
      { title: 'two', summary: 's', attention: 'high', entity_ids: ['e1', 'e2'] },
      { k: 1 },
      at('2026-01-02T00:00:00Z')
    );
    insertInsight(
      db,
      'b',
      { title: 'three', summary: 's', attention: 'medium', entity_ids: [] },
      {},
      at('2026-01-03T00:00:00Z')
    );
  });
  afterAll(() => closeDatabase(db));

  it('lists newest first with refs and parsed payload', async () => {
    const res = await request(app).get('/api/insights');
    expect(res.status).toBe(200);
    expect(res.body.insights.map((i: { title: string }) => i.title)).toEqual([
      'three',
      'two',
      'one'
    ]);
    const two = res.body.insights[1];
    expect(two).toMatchObject({
      analysis: 'a',
      attention: 'high',
      refs: ['e1', 'e2'],
      payload: { k: 1 }
    });
  });

  it('filters by minimum attention, since, and limit', async () => {
    const byAttention = await request(app).get('/api/insights?attention=medium');
    expect(byAttention.body.insights.map((i: { title: string }) => i.title)).toEqual([
      'three',
      'two'
    ]);
    const since = await request(app).get('/api/insights?since=2026-01-01T12:00:00Z');
    expect(since.body.insights).toHaveLength(2);
    const limited = await request(app).get('/api/insights?limit=1');
    expect(limited.body).toMatchObject({ limit: 1 });
    expect(limited.body.insights).toHaveLength(1);
  });

  it.each(['attention=urgent', 'since=yesterday', 'limit=abc'])(
    'rejects %s with 400',
    async (q) => {
      const res = await request(app).get(`/api/insights?${q}`);
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ status: 400, error: 'Bad Request', details: null });
    }
  );

  it('reports engine status', async () => {
    setAnalysisStatus({
      enabled: false,
      reason: 'ANTHROPIC_API_KEY is not set',
      provider: null,
      model: null,
      analyses: []
    });
    const res = await request(app).get('/api/insights/status');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ enabled: false, reason: 'ANTHROPIC_API_KEY is not set' });
  });
});

describe('ai_insight WebSocket frame', () => {
  it('broadcasts the insight record to open sockets', () => {
    const b = new TelemetryBroadcaster();
    const send = jest.fn();
    b.addClient({ readyState: WebSocket.OPEN, send } as unknown as WebSocket);
    b.broadcastAiInsight({ id: 'x', title: 't', refs: [] });
    const frame = JSON.parse(send.mock.calls[0][0]);
    expect(frame).toMatchObject({ type: 'ai_insight', data: { id: 'x', title: 't', refs: [] } });
    expect(typeof frame.timestamp).toBe('string');
  });
});
