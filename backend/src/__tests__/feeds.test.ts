import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import Database from 'better-sqlite3';
import { createApp } from '../app';
import { initDatabase, closeDatabase } from '../db/database';
import { getAllSources } from '../db/queries';
import { IngestionScheduler } from '../engine/scheduler';
import { SourceConfig, loadSourcesFromDir, validateSourceConfig } from '../engine/yaml-loader';
import { parsePayload } from '../engine/parsers';
import { cleanText, mapFeedItem, mapIndicator, safeUrl } from '../feeds/mapper';
import {
  MAX_FEED_ITEMS_PER_SOURCE,
  MAX_INDICATOR_HISTORY,
  listFeedItems,
  listIndicators,
  pruneFeedItems,
  upsertFeedItems,
  upsertIndicators
} from '../feeds/store';
import type { FeedItem } from '../feeds/types';

const RSS = `<?xml version="1.0"?>
<rss version="2.0" xmlns:georss="http://www.georss.org/georss">
  <channel>
    <item>
      <title>Advisory &amp; patch</title>
      <link>https://example.org/a</link>
      <guid>a-1</guid>
      <description>&lt;p&gt;Critical &lt;b&gt;RCE&lt;/b&gt; fixed&lt;/p&gt;</description>
      <pubDate>${new Date(Date.now() - 3600_000).toUTCString()}</pubDate>
      <category>ics</category>
    </item>
    <item>
      <title>Quake near town</title>
      <link>javascript:alert(1)</link>
      <guid>b-2</guid>
      <pubDate>${new Date(Date.now() - 7200_000).toUTCString()}</pubDate>
      <georss:point>35.5 139.7</georss:point>
    </item>
    <item>
      <link>https://example.org/untitled</link>
    </item>
  </channel>
</rss>`;

function feedConfig(overrides: Partial<SourceConfig> = {}): SourceConfig {
  const raw = {
    name: 'news_src',
    source_type: 'news',
    layer_type: 'news',
    display_name: 'News',
    kind: 'feed',
    transport: { type: 'http_poll', url: 'https://example.org/rss', interval: '5m' },
    parser: { format: 'rss' },
    feed: {
      id: '=guid ?? link',
      title: 'title',
      url: 'link',
      summary: 'description',
      published: 'published',
      tags: 'categories',
      severity: '=contains(lower(title), "advisory") ? "high" : "info"',
      latitude: 'lat',
      longitude: 'lon'
    },
    ...overrides
  };
  return loadFromYaml(raw);
}

/** Round-trip through the real loader so defaults (entity/observation/layer) are applied. */
function loadFromYaml(raw: Record<string, unknown>): SourceConfig {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'feeds-'));
  fs.writeFileSync(path.join(dir, 'src.yaml'), JSON.stringify(raw));
  const [config] = loadSourcesFromDir(dir);
  fs.rmSync(dir, { recursive: true, force: true });
  if (!config) throw new Error(`config rejected: ${validateSourceConfig(raw).join('; ')}`);
  return config;
}

function register(db: Database.Database, config: SourceConfig): void {
  db.prepare(
    `INSERT INTO sources (id, name, type, transport, url, update_interval_sec, enabled, kind)
     VALUES (?, ?, 'x', 'http_poll', 'http://x', 60, 1, ?)`
  ).run(config.name, config.display_name ?? config.name, config.kind ?? 'geo');
}

function item(id: string, published: string, source = 's'): FeedItem {
  return {
    id: `${source}:${id}`,
    source_id: source,
    item_id: id,
    title: `Item ${id}`,
    url: null,
    summary: null,
    published,
    tags: [],
    severity: 'info',
    latitude: null,
    longitude: null,
    entity_id: null,
    first_seen: published
  };
}

describe('kind: feed / indicator — loader validation', () => {
  const base = {
    name: 'x',
    source_type: 'x',
    transport: { type: 'http_poll', url: 'http://x', interval: 60 },
    parser: { format: 'json' }
  };

  it('accepts feed and indicator sources without entity/observation sections', () => {
    expect(validateSourceConfig({ ...base, kind: 'feed', feed: { id: 'id', title: 't' } })).toEqual(
      []
    );
    expect(
      validateSourceConfig({
        ...base,
        kind: 'indicator',
        indicator: { id: 'id', label: 'l', value: '=number(v)' }
      })
    ).toEqual([]);
  });

  it('still requires entity/observation for geo sources', () => {
    const errors = validateSourceConfig(base);
    expect(errors).toContain('missing required section "entity"');
    expect(errors).toContain('missing required section "observation"');
  });

  it('rejects unknown kinds, missing blocks/fields, unknown keys and bad expressions', () => {
    expect(validateSourceConfig({ ...base, kind: 'weird' }).join()).toMatch(/invalid kind/);
    expect(validateSourceConfig({ ...base, kind: 'feed' }).join()).toMatch(/needs a "feed:"/);
    expect(validateSourceConfig({ ...base, kind: 'feed', feed: { id: 'id' } }).join()).toMatch(
      /feed\.title/
    );
    expect(
      validateSourceConfig({
        ...base,
        kind: 'indicator',
        indicator: { id: 'a', label: 'b' }
      }).join()
    ).toMatch(/indicator\.value/);
    expect(
      validateSourceConfig({
        ...base,
        kind: 'feed',
        feed: { id: 'a', title: 'b', bogus: 'c' }
      }).join()
    ).toMatch(/unknown field "feed\.bogus"/);
    expect(
      validateSourceConfig({ ...base, kind: 'feed', feed: { id: '=(', title: 'b' } }).join()
    ).toMatch(/invalid expression in feed\.id/);
    expect(
      validateSourceConfig({ ...base, kind: 'feed', feed: { id: 'a', title: 'b', latitude: 'x' } })
        .length
    ).toBe(1);
  });

  it('synthesises entity/observation so located items can use the geo pipeline', () => {
    const config = feedConfig();
    expect(config.kind).toBe('feed');
    expect(config.entity.external_id).toBe('=guid ?? link');
    expect(config.observation).toMatchObject({ latitude: 'lat', longitude: 'lon', optional: true });
    expect(config.recording?.mode).toBe('upsert');
    expect(config.entity.category).toBe('news');
  });
});

describe('feed mapping', () => {
  const records = parsePayload(RSS, 'rss');

  it('maps RSS records to clean feed items', () => {
    const config = feedConfig();
    const [a, b, c] = records.map((r) => mapFeedItem(r, config, '2026-01-01T00:00:00.000Z'));
    expect(a).toMatchObject({
      id: 'news_src:a-1',
      title: 'Advisory & patch',
      url: 'https://example.org/a',
      summary: 'Critical RCE fixed',
      tags: ['ics'],
      severity: 'high',
      latitude: null,
      entity_id: null
    });
    expect(b).toMatchObject({ latitude: 35.5, longitude: 139.7, entity_id: 'news_src:b-2' });
    expect(b?.url).toBeNull(); // javascript: link dropped
    expect(c).toBeNull(); // no title
  });

  it('cleanText / safeUrl helpers', () => {
    expect(cleanText('<p>a&nbsp;&#8217;b&#x27;</p>  <script>x()</script>', 50)).toBe("a ’b'");
    expect(cleanText('x'.repeat(20), 10)).toHaveLength(10);
    expect(cleanText('   ', 10)).toBeNull();
    expect(safeUrl('ftp://x')).toBeNull();
    expect(safeUrl('https://a.b/c?d=1')).toBe('https://a.b/c?d=1');
  });
});

describe('indicator mapping', () => {
  const config = loadFromYaml({
    name: 'kp',
    source_type: 'space_weather',
    kind: 'indicator',
    transport: { type: 'http_poll', url: 'http://x', interval: '5m' },
    parser: { format: 'json' },
    indicator: {
      id: '="kp"',
      label: '="Planetary Kp"',
      value: '=number(kp)',
      unit: 'Kp',
      timestamp: 'time_tag',
      severity: '=value >= 5 ? "high" : "info"'
    }
  });

  it('maps value, literal unit, timestamp and a severity that reads the mapped value', () => {
    const r = mapIndicator({ kp: '5.33', time_tag: '2026-09-28T00:00:00' }, config);
    expect(r).toMatchObject({
      id: 'kp:kp',
      label: 'Planetary Kp',
      value: 5.33,
      unit: 'Kp',
      severity: 'high',
      timed: true
    });
    expect(mapIndicator({ kp: 'n/a' }, config)).toBeNull();
  });
});

describe('feed + indicator store', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = initDatabase(':memory:');
  });
  afterEach(() => closeDatabase(db));

  it('dedupes by id and returns only new items', () => {
    const now = new Date().toISOString();
    expect(upsertFeedItems(db, [item('1', now), item('2', now)])).toHaveLength(2);
    const again = upsertFeedItems(db, [item('1', now), { ...item('2', now), title: 'edited' }]);
    expect(again).toHaveLength(0);
    const list = listFeedItems(db);
    expect(list).toHaveLength(2);
    expect(list.find((i) => i.item_id === '2')?.title).toBe('edited');
  });

  it('keeps the newest 500 per source and ignores items past MKOSINT_FEED_MAX_AGE', () => {
    const base = Date.now();
    const many = Array.from({ length: MAX_FEED_ITEMS_PER_SOURCE + 20 }, (_, i) =>
      item(String(i), new Date(base - i * 1000).toISOString())
    );
    upsertFeedItems(db, many);
    expect(listFeedItems(db, { limit: 1000 })).toHaveLength(MAX_FEED_ITEMS_PER_SOURCE);
    // Re-polling the same oversized feed announces nothing new.
    expect(upsertFeedItems(db, many)).toHaveLength(0);

    const old = new Date(base - 20 * 86400_000).toISOString();
    expect(upsertFeedItems(db, [item('old', old, 't')])).toHaveLength(0);

    process.env.MKOSINT_FEED_MAX_AGE = '1s';
    try {
      expect(pruneFeedItems(db, base + 60_000)).toBe(MAX_FEED_ITEMS_PER_SOURCE);
    } finally {
      delete process.env.MKOSINT_FEED_MAX_AGE;
    }
  });

  it('filters by source and since', () => {
    upsertFeedItems(db, [
      item('1', new Date(Date.now() - 5000).toISOString(), 'a'),
      item('2', new Date().toISOString(), 'b')
    ]);
    expect(listFeedItems(db, { source: 'a' }).map((i) => i.item_id)).toEqual(['1']);
    expect(
      listFeedItems(db, { since: new Date(Date.now() - 2500).toISOString() }).map((i) => i.item_id)
    ).toEqual(['2']);
  });

  it('builds indicator history from series and repeated polls, capped at 100 points', () => {
    const reading = (t: string, v: number, timed = true) => ({
      id: 's:kp',
      source_id: 's',
      indicator_id: 'kp',
      label: 'Kp',
      value: v,
      unit: null,
      change: null,
      severity: 'info' as const,
      timestamp: t,
      timed
    });
    const series = Array.from({ length: 120 }, (_, i) =>
      reading(new Date(Date.UTC(2026, 0, 1, i)).toISOString(), i)
    );
    const changed = upsertIndicators(db, series.slice().reverse());
    expect(changed).toHaveLength(1);
    expect(changed[0].value).toBe(119);
    expect(changed[0].history).toHaveLength(MAX_INDICATOR_HISTORY);
    expect(changed[0].history[0].v).toBe(20);

    // Same series again: nothing changed, nothing broadcast.
    expect(upsertIndicators(db, series)).toHaveLength(0);
    // A new point.
    const next = upsertIndicators(db, [reading('2026-02-01T00:00:00.000Z', 3)]);
    expect(next[0].value).toBe(3);
    expect(listIndicators(db)[0].history.at(-1)).toEqual({ t: '2026-02-01T00:00:00.000Z', v: 3 });
  });
});

describe('scheduler + API integration', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = initDatabase(':memory:');
  });
  afterEach(() => closeDatabase(db));

  it('ingests a feed, broadcasts new items once, and plots located items as entities', () => {
    const config = feedConfig();
    register(db, config);
    const scheduler = new IngestionScheduler(db, '/x');
    const announced: FeedItem[] = [];
    const entityUpdates: string[] = [];
    scheduler.onFeedItem = (i) => announced.push(i);
    scheduler.onEntityUpdate = (e) => entityUpdates.push(e.id);

    const records = parsePayload(RSS, 'rss');
    expect(scheduler.ingestRecords(config, records)).toBe(2);
    expect(announced.map((i) => i.item_id)).toEqual(['b-2', 'a-1']); // oldest first
    expect(entityUpdates).toEqual(['news_src:b-2']);
    const entity = db.prepare('SELECT * FROM entities').get() as Record<string, unknown>;
    expect(entity).toMatchObject({ id: 'news_src:b-2', category: 'news', name: 'Quake near town' });
    expect(scheduler.lastStats.get('news_src')).toMatchObject({ written: 2, skipped: 1 });

    scheduler.ingestRecords(config, records);
    expect(announced).toHaveLength(2);
  });

  it('ingests indicators and serves /api/feed, /api/indicators and source kind', async () => {
    const config = loadFromYaml({
      name: 'kev',
      source_type: 'cyber',
      kind: 'indicator',
      transport: { type: 'http_poll', url: 'http://x', interval: '1h' },
      parser: { format: 'json' },
      indicator: { id: '="count"', label: '="KEV entries"', value: 'count' }
    });
    const scheduler = new IngestionScheduler(db, '/x');
    const updates: unknown[] = [];
    scheduler.onIndicator = (i) => updates.push(i);
    register(db, config);
    db.prepare("UPDATE sources SET kind = 'indicator' WHERE id = 'kev'").run();
    scheduler.ingestRecords(config, [{ count: 1200 }]);
    expect(updates).toHaveLength(1);

    const feed = feedConfig();
    register(db, feed);
    scheduler.ingestRecords(feed, parsePayload(RSS, 'rss'));

    const app = createApp(db);
    const f = await request(app).get('/api/feed?source=news_src&limit=1');
    expect(f.status).toBe(200);
    expect(f.body.limit).toBe(1);
    expect(f.body.items).toHaveLength(1);
    expect(f.body.items[0].item_id).toBe('a-1');
    expect((await request(app).get('/api/feed?limit=abc')).status).toBe(400);
    expect((await request(app).get('/api/feed?since=nope')).status).toBe(400);

    const ind = await request(app).get('/api/indicators');
    expect(ind.body.indicators[0]).toMatchObject({ id: 'kev:count', value: 1200 });
    expect(getAllSources().find((s) => s.id === 'kev')?.kind).toBe('indicator');
    expect(getAllSources().find((s) => s.id === 'news_src')?.kind).toBe('feed');
  });
});

describe('xml entity limits', () => {
  it('parses feeds with thousands of escaped characters (rss and xml parsers)', () => {
    const items = Array.from(
      { length: 400 },
      (_, i) => `<item><title>A &amp; B &lt;${i}&gt;</title><guid>${i}</guid></item>`
    ).join('');
    const doc = `<?xml version="1.0"?><rss version="2.0"><channel>${items}</channel></rss>`;
    const rss = parsePayload(doc, 'rss') as Array<{ title: string }>;
    expect(rss).toHaveLength(400);
    expect(rss[0].title).toBe('A & B <0>');
    expect(parsePayload(doc, 'xml', 'rss.channel.item')).toHaveLength(400);
  });
});
