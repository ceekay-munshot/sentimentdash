import assert from 'node:assert/strict';
import { createApp } from './src/app.js';
const at = '2026-09-15T12:00:00Z';
const posts = Array.from({ length: 1201 }, (_, i) => ({ id: `valuepickr-${1201-i}`, source: 'valuepickr', timestamp: '2026-08-01T12:00:00Z', text: 'fixture', sentiment: 'neutral' }));
const collection = { intervalMinutes: 120, state: 'partial', sources: { news: { state: 'failed', lastSuccessAt: '2026-09-14T12:00:00Z' } } };
const files = {
  'trending.json': { generatedAt: at, window: '30d', stocks: [], totalPosts: 0, totalStocks: 0, collection },
  'archive/index.json': { version: 1, startedAt: '2026-08-01T12:00:00Z', totalPosts: posts.length, topics: { alpha: { ticker: 'alpha', name: 'Alpha', months: { '2026-08': { count: posts.length, revision: at } } } } },
  'archive/posts/alpha/2026-08.json': { ticker: 'alpha', name: 'Alpha', month: '2026-08', generatedAt: at, posts },
};
const app = createApp({ env: { CACHE_TTL_SECONDS: '0' }, readLocal: async path => files[path] ? JSON.stringify(files[path]) : null });
const request = path => app.fetch(new Request(`https://fixture.test/v1${path}`));
const health = await (await request('/health')).json();
assert.deepEqual(health.data.collection, collection);
assert.deepEqual((await (await request('/dashboard')).json()).collection, collection);
const catalogue = await (await request('/archive')).json();
assert(catalogue.available && catalogue.topics.length === 1);
const first = await (await request('/archive/alpha/2026-08?limit=1000')).json();
const next = await (await request('/archive/alpha/2026-08?limit=1000&offset=1000')).json();
assert(first.pagination.hasMore);
assert.equal(new Set([...first.posts, ...next.posts].map(post => post.id)).size, 1201);
assert.equal(next.pagination.hasMore, false);
assert.equal((await request('/archive/alpha/2026-13')).status, 404);
delete files['archive/posts/alpha/2026-08.json'];
assert.equal((await request('/archive/alpha/2026-08')).status, 502, 'a missing referenced partition is not an empty archive');
console.log('PASS source health propagation, archived-only topics, pagination beyond 1000, invalid months and missing partition failures');
