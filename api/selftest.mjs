#!/usr/bin/env node
/**
 * Offline self-test: runs the API against the checked-in data files and
 * asserts every endpoint returns what the dashboard renders.
 *
 *   node api/selftest.mjs
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { createApp } from './src/app.js';
import { localReader } from './server.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(root, 'public', 'data');
const trending = JSON.parse(readFileSync(join(dataDir, 'trending.json'), 'utf8'));

const app = createApp({ env: {}, readLocal: localReader(dataDir) });

let passed = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) {
    passed++;
    return;
  }
  failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

function equal(name, actual, expected) {
  check(name, Object.is(actual, expected), `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

/** @returns {Promise<{ status: number, headers: Headers, body: any }>} */
async function get(path, init) {
  const res = await app.fetch(new Request(`https://api.test${path}`, init));
  const text = await res.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status: res.status, headers: res.headers, body };
}

/* --------------------------------- index --------------------------------- */

{
  const { status, body } = await get('/v1');
  equal('index: 200', status, 200);
  equal('index: version', body.version, 'v1');
  check('index: lists endpoints', body.endpoints.length >= 10);
  check('index: absolute links', body.endpoints.every((e) => e.path.startsWith('https://api.test/v1/')));

  const bare = await get('/');
  equal('index: served without prefix too', bare.status, 200);
  const prefixed = await get('/api/v1');
  equal('index: served under /api/v1', prefixed.status, 200);
  check('index: prefix preserved in links', prefixed.body.endpoints[0].path.startsWith('https://api.test/api/v1/'));
}

/* --------------------------------- health -------------------------------- */

{
  const { status, body, headers } = await get('/v1/health');
  equal('health: 200', status, 200);
  equal('health: ok', body.status, 'ok');
  equal('health: generatedAt', body.data.generatedAt, trending.generatedAt);
  equal('health: window', body.data.window, trending.window);
  equal('health: not cached', headers.get('cache-control'), 'no-store');
}

/* ---------------------------------- meta --------------------------------- */

{
  const { body } = await get('/v1/meta');
  equal('meta: window', body.window, trending.window);
  equal('meta: 4 sources', body.sources.length, 4);
  check('meta: source labels', body.sources.some((s) => s.key === 'valuepickr' && s.label === 'ValuePickr'));
  check('meta: source colours', body.sources.every((s) => /^#[0-9a-f]{6}$/i.test(s.color)));
  equal('meta: 3 sentiments', body.sentiments.length, 3);
  equal('meta: mood threshold', body.moodThresholds.bullish, 0.12);
  equal('meta: dashboard sorts', body.sorts.length, 4);
  equal('meta: dashboard source filters', body.sourceFilters.length, 4);
}

/* -------------------------------- overview ------------------------------- */

{
  const { body } = await get('/v1/overview');
  equal('overview: totalPosts', body.totalPosts, trending.totalPosts);
  equal('overview: totalStocks', body.totalStocks, trending.totalStocks);
  equal('overview: mood score', body.marketMood.score, trending.marketMood.score);
  equal('overview: mood bullish', body.marketMood.bullish, trending.marketMood.bullish);
  equal(
    'overview: mood total',
    body.marketMood.total,
    trending.marketMood.bullish + trending.marketMood.bearish + trending.marketMood.neutral,
  );

  const expectedMover = [...trending.stocks].sort((a, b) => b.changePct - a.changePct)[0];
  const expectedBullish = [...trending.stocks].sort((a, b) => b.sentiment.score - a.sentiment.score)[0];
  equal('overview: top mover matches dashboard', body.topMover.ticker, expectedMover.ticker);
  equal('overview: most bullish matches dashboard', body.mostBullish.ticker, expectedBullish.ticker);

  const sourceSum = Object.values(body.sourceTotals).reduce((a, b) => a + b, 0);
  equal('overview: source totals sum to totalPosts', sourceSum, trending.totalPosts);
}

/* --------------------------------- stocks -------------------------------- */

{
  const { body } = await get('/v1/stocks?limit=5');
  equal('stocks: page size', body.stocks.length, 5);
  equal('stocks: total', body.pagination.total, trending.stocks.length);
  check('stocks: hasMore', body.pagination.hasMore === true);
  equal('stocks: rank order', body.stocks[0].rank, 1);
  equal('stocks: first ticker', body.stocks[0].ticker, trending.stocks[0].ticker);

  const first = body.stocks[0];
  const raw = trending.stocks[0];
  equal('stocks: mentions preserved', first.mentions, raw.mentions);
  equal('stocks: mentionsPrev preserved', first.mentionsPrev, raw.mentionsPrev);
  equal('stocks: changePct preserved', first.changePct, raw.changePct);
  equal('stocks: sentiment score preserved', first.sentiment.score, raw.sentiment.score);
  equal('stocks: sentiment label preserved', first.sentiment.label, raw.sentiment.label);
  equal('stocks: sparkline preserved', JSON.stringify(first.sparkline), JSON.stringify(raw.sparkline));
  equal('stocks: sources preserved', JSON.stringify(first.sources), JSON.stringify(raw.sources));
  check('stocks: sentiment total', first.sentiment.total === raw.sentiment.bullish + raw.sentiment.bearish + raw.sentiment.neutral);
  check('stocks: source label derived', typeof first.sourceLabel === 'string' && first.sourceLabel.length > 0);
  check('stocks: links', first.links.posts.endsWith(`/v1/stocks/${first.ticker}/posts`));

  const pctSum = first.sentiment.percent.bullish + first.sentiment.percent.bearish + first.sentiment.percent.neutral;
  check('stocks: percentages sum to ~100', Math.abs(pctSum - 100) < 0.5, `got ${pctSum}`);
}

{
  const offset = await get('/v1/stocks?limit=5&offset=5');
  equal('stocks: offset', offset.body.stocks[0].rank, 6);

  const all = await get('/v1/stocks?limit=all');
  equal('stocks: limit=all returns everything', all.body.stocks.length, trending.stocks.length);
}

{
  const bullish = await get('/v1/stocks?sort=bullish&limit=3');
  const scores = bullish.body.stocks.map((s) => s.sentiment.score);
  check('stocks: bullish sort descending', scores[0] >= scores[1] && scores[1] >= scores[2], scores.join(','));

  const bearish = await get('/v1/stocks?sort=bearish&limit=3');
  const bearScores = bearish.body.stocks.map((s) => s.sentiment.score);
  check('stocks: bearish sort ascending', bearScores[0] <= bearScores[1], bearScores.join(','));

  const movers = await get('/v1/stocks?sort=movers&limit=1');
  const expectedMover = [...trending.stocks].sort((a, b) => b.changePct - a.changePct)[0];
  equal('stocks: movers sort', movers.body.stocks[0].ticker, expectedMover.ticker);

  const flipped = await get('/v1/stocks?sort=trending&order=desc&limit=1');
  equal('stocks: order flip', flipped.body.stocks[0].rank, trending.stocks.length);
}

{
  const sample = trending.stocks.find((s) => (s.sources.valuepickr ?? 0) > 0);
  const filtered = await get('/v1/stocks?source=valuepickr&limit=all');
  const expected = trending.stocks.filter((s) => (s.sources.valuepickr ?? 0) > 0).length;
  equal('stocks: source filter count', filtered.body.pagination.total, expected);
  check('stocks: source filter contents', filtered.body.stocks.every((s) => s.sources.valuepickr > 0));
  check('stocks: source filter keeps sample', filtered.body.stocks.some((s) => s.ticker === sample.ticker));

  const query = trending.stocks[0].name.slice(0, 4);
  const searched = await get(`/v1/stocks?q=${encodeURIComponent(query)}&limit=all`);
  check(
    'stocks: search matches name or ticker',
    searched.body.stocks.every((s) =>
      `${s.ticker} ${s.name}`.toLowerCase().includes(query.toLowerCase()),
    ),
  );
  check('stocks: search finds the seed company', searched.body.stocks.some((s) => s.ticker === trending.stocks[0].ticker));

  const sentimentFiltered = await get('/v1/stocks?sentiment=bullish&limit=all');
  check('stocks: sentiment filter', sentimentFiltered.body.stocks.every((s) => s.sentiment.label === 'bullish'));

  const minMentions = await get('/v1/stocks?minMentions=5&limit=all');
  check('stocks: minMentions filter', minMentions.body.stocks.every((s) => s.mentions >= 5));
}

/* ------------------------------ stock detail ----------------------------- */

const sampleTicker = trending.stocks[0].ticker;

{
  const { status, body } = await get(`/v1/stocks/${sampleTicker}`);
  equal('stock: 200', status, 200);
  equal('stock: ticker', body.stock.ticker, sampleTicker);
  equal('stock: inTrending', body.inTrending, true);
  equal('stock: derivedFromPosts', body.derivedFromPosts, false);
  equal('stock: post count matches mentions', body.counts.total, trending.stocks[0].mentions);
  check('stock: source tallies', body.counts.bySource.valuepickr !== undefined);

  const withPosts = await get(`/v1/stocks/${sampleTicker}?includePosts=1&postLimit=3`);
  check('stock: embedded posts', withPosts.body.posts.length > 0 && withPosts.body.posts.length <= 3);
  check('stock: embedded posts labelled', withPosts.body.posts.every((p) => typeof p.sourceLabel === 'string'));
}

/* ------------------------------- stock posts ----------------------------- */

{
  const { status, body } = await get(`/v1/stocks/${sampleTicker}/posts?limit=100`);
  equal('posts: 200', status, 200);
  equal('posts: ticker', body.ticker, sampleTicker);
  equal('posts: total matches mentions', body.counts.total, trending.stocks[0].mentions);
  check('posts: newest first', body.posts.every((p, i) => i === 0 || body.posts[i - 1].timestamp >= p.timestamp));
  check(
    'posts: fields intact',
    body.posts.every((p) => p.id && p.source && p.url && p.text && p.sentiment && p.timestamp),
  );
  check('posts: engagement counts', body.posts.every((p) => typeof p.likes === 'number' && typeof p.comments === 'number'));

  const bySentiment = body.counts.bySentiment;
  equal('posts: sentiment tally matches trending', bySentiment.bullish, trending.stocks[0].sentiment.bullish);
  equal('posts: bearish tally matches trending', bySentiment.bearish, trending.stocks[0].sentiment.bearish);
  equal('posts: source tally matches trending', bySentiment.neutral, trending.stocks[0].sentiment.neutral);

  const oldest = await get(`/v1/stocks/${sampleTicker}/posts?sort=oldest&limit=100`);
  check('posts: oldest sort', oldest.body.posts.every((p, i) => i === 0 || oldest.body.posts[i - 1].timestamp <= p.timestamp));

  const filtered = await get(`/v1/stocks/${sampleTicker}/posts?sentiment=neutral&limit=100`);
  check('posts: sentiment filter', filtered.body.posts.every((p) => p.sentiment === 'neutral'));
  equal('posts: filtered count reported', filtered.body.counts.filtered, filtered.body.pagination.total);
}

/* -------------------------------- feed ----------------------------------- */

{
  const { status, body } = await get('/v1/posts?stocks=3&limit=10');
  equal('feed: 200', status, 200);
  equal('feed: tickers used', body.tickers.length, 3);
  check('feed: posts returned', body.posts.length > 0);
  check('feed: posts carry their ticker', body.posts.every((p) => body.tickers.includes(p.ticker)));
  check('feed: newest first', body.posts.every((p, i) => i === 0 || body.posts[i - 1].timestamp >= p.timestamp));

  const explicit = await get(`/v1/posts?tickers=${sampleTicker}&limit=5`);
  check('feed: explicit tickers', explicit.body.posts.every((p) => p.ticker === sampleTicker));
}

/* ------------------------------- history --------------------------------- */

{
  const { status, body } = await get('/v1/history?limit=3');
  equal('history: 200', status, 200);
  equal('history: run count', body.runs.length, 3);
  check('history: runs carry totals', body.runs.every((r) => typeof r.totalPosts === 'number' && r.at));
  check('history: counts omitted by default', body.runs.every((r) => r.counts === undefined));

  const withCounts = await get('/v1/history?limit=1&includeCounts=true');
  check('history: counts included on request', typeof withCounts.body.runs[0].counts === 'object');

  const series = await get(`/v1/history/${sampleTicker}`);
  equal('history: ticker series', series.body.ticker, sampleTicker);
  equal('history: latest matches trending', series.body.latest, trending.stocks[0].mentions);
  equal('history: previous matches trending', series.body.previous, trending.stocks[0].mentionsPrev);
  equal(
    'history: sparkline matches dashboard',
    JSON.stringify(series.body.sparkline),
    JSON.stringify(trending.stocks[0].sparkline),
  );
  check('history: points', series.body.points.every((p) => p.at && typeof p.mentions === 'number'));
}

/* ------------------------------- dashboard ------------------------------- */

{
  const { body } = await get('/v1/dashboard');
  equal('dashboard: every stock included', body.stocks.length, trending.stocks.length);
  equal('dashboard: overview embedded', body.overview.totalPosts, trending.totalPosts);
  equal('dashboard: window', body.window, trending.window);
}

/* -------------------------------- openapi -------------------------------- */

{
  const { status, body } = await get('/v1/openapi.json');
  equal('openapi: 200', status, 200);
  equal('openapi: version', body.openapi, '3.1.0');
  equal('openapi: server url', body.servers[0].url, 'https://api.test/v1');
  check('openapi: documents stocks', Boolean(body.paths['/stocks']));
  check('openapi: documents ticker posts', Boolean(body.paths['/stocks/{ticker}/posts']));
}

/* -------------------------- errors, CORS, caching ------------------------ */

{
  const missing = await get('/v1/stocks/definitely-not-a-company-xyz');
  equal('errors: unknown ticker 404', missing.status, 404);
  equal('errors: unknown ticker code', missing.body.error.code, 'unknown_ticker');

  const badRoute = await get('/v1/nope');
  equal('errors: unknown route 404', badRoute.status, 404);

  const badParam = await get('/v1/stocks?sort=sideways');
  equal('errors: invalid sort 400', badParam.status, 400);
  equal('errors: invalid sort code', badParam.body.error.code, 'invalid_param');

  const badLimit = await get('/v1/stocks?limit=99999');
  equal('errors: out-of-range limit 400', badLimit.status, 400);

  const traversal = await get('/v1/stocks/..%2F..%2Ftrending/posts');
  check('errors: path traversal rejected', traversal.status === 400 || traversal.status === 404, `got ${traversal.status}`);

  const malformed = await get('/v1/stocks/%E0%A4%A/posts');
  check('errors: malformed escape rejected', malformed.status === 400 || malformed.status === 404, `got ${malformed.status}`);

  const absolute = await get('/v1/stocks/https:%2F%2Fevil.example%2Fx/posts');
  check('errors: absolute url ticker rejected', absolute.status === 400, `got ${absolute.status}`);

  const post = await get('/v1/stocks', { method: 'POST' });
  equal('errors: POST rejected', post.status, 405);
}

{
  const { headers } = await get('/v1/overview', { headers: { Origin: 'https://other-dashboard.example' } });
  equal('cors: wildcard by default', headers.get('access-control-allow-origin'), '*');

  const preflight = await get('/v1/overview', { method: 'OPTIONS' });
  equal('cors: preflight 204', preflight.status, 204);
  check('cors: preflight methods', preflight.headers.get('access-control-allow-methods').includes('GET'));

  const restricted = createApp({
    env: { ALLOWED_ORIGINS: 'https://allowed.example' },
    readLocal: localReader(dataDir),
  });
  const allowed = await restricted.fetch(
    new Request('https://api.test/v1/overview', { headers: { Origin: 'https://allowed.example' } }),
  );
  equal('cors: allow-list echo', allowed.headers.get('access-control-allow-origin'), 'https://allowed.example');
  const denied = await restricted.fetch(
    new Request('https://api.test/v1/overview', { headers: { Origin: 'https://evil.example' } }),
  );
  check('cors: allow-list rejects others', denied.headers.get('access-control-allow-origin') !== 'https://evil.example');
}

{
  const first = await app.fetch(new Request('https://api.test/v1/overview'));
  const etag = first.headers.get('etag');
  check('cache: etag issued', Boolean(etag));
  equal('cache: data timestamp header', first.headers.get('x-data-generated-at'), trending.generatedAt);

  const second = await app.fetch(
    new Request('https://api.test/v1/overview', { headers: { 'If-None-Match': etag } }),
  );
  equal('cache: conditional 304', second.status, 304);

  const head = await app.fetch(new Request('https://api.test/v1/overview', { method: 'HEAD' }));
  equal('cache: HEAD 200', head.status, 200);
  equal('cache: HEAD has no body', await head.text(), '');
}

/* --------------------------------- report -------------------------------- */

console.log(`\n${passed} checks passed`);
if (failures.length > 0) {
  console.error(`${failures.length} failed:`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}
console.log('API self-test OK');
