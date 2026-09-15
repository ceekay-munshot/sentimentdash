// All source responses and captures are synthetic and local. Never starts a production run.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { walkPosts, collectForum, readSource } from './sources/transport.mjs';
import { collectGoogleNews } from './sources/googlenews.mjs';
import { collectValuePickr } from './sources/valuepickr.mjs';
import { openArchive, readJson, writeJson, recoverGitHistory } from './archive.mjs';
import { collect } from './run.mjs';

const now = new Date('2026-09-15T12:00:00Z');
const raw = (id, at = '2026-09-15T10:00:00Z') => ({ id, created_at: at, post_type: 1, username: 'test', topic_id: 1, topic_title: 'Alpha', category_id: 1, cooked: 'Source fixture', post_number: id });
const noWait = async () => {};
let calls = [];
const interrupted = await walkPosts({ base: 'https://fixture.test', cutoff: now.getTime() - 86400000,
  read: async url => { calls.push(url); if (calls.length === 1) return { latest_posts: [raw(20), raw(19)] }; throw Error('offline'); }, sleep: noWait });
assert.equal(interrupted.posts.length, 2);
assert.equal(interrupted.before, '19');
assert.equal(interrupted.complete, false);
const resumed = await walkPosts({ base: 'https://fixture.test', before: interrupted.before, cutoff: now.getTime() - 86400000,
  read: async url => { assert(url.endsWith('before=19')); return { latest_posts: [raw(18, '2026-09-10T10:00:00Z')] }; }, sleep: noWait });
assert(resumed.complete);
assert.equal(resumed.posts.length, 0);
const malformed = await walkPosts({ base: 'https://fixture.test', cutoff: 0, read: async () => ({}), sleep: noWait });
assert(malformed.error);
const limited = await walkPosts({ base: 'https://fixture.test', cutoff: 0, maxPages: 1, read: async () => ({ latest_posts: [raw(20)] }), sleep: noWait });
assert(!limited.complete && limited.before === '20');

let cooldownCalls = 0;
await assert.rejects(readSource('https://fixture.test', { now: now.getTime(), sleep: noWait,
  fetcher: async () => { cooldownCalls++; return new Response('', { status: 429, headers: { 'retry-after': '7200' } }); } }), error => Date.parse(error.retryAt) === now.getTime() + 7200000);
assert.equal(cooldownCalls, 1);
const skipped = await collectForum({ base: 'https://fixture.test', now, previous: { retryAt: new Date(now.getTime() + 60000).toISOString() }, read: async () => { throw Error('must not read during cooldown'); } });
assert.equal(skipped.state.state, 'cooldown');

const source = await collectForum({ base: 'https://fixture.test', now, previous: {
  lastSuccessAt: '2026-09-15T08:00:00Z', history: { before: '5', cutoff: '2026-08-16T12:00:00Z', complete: false },
}, read: async url => ({ latest_posts: url.includes('before=5') ? [raw(4, '2026-08-01T00:00:00Z')] : [raw(10, '2026-09-13T00:00:00Z')] }), sleep: noWait });
assert.equal(source.state.state, 'ok');
assert(source.state.history.complete);
assert.equal(source.state.lastSuccessAt, now.toISOString());
const categoryFailure = await collectValuePickr({ now, read: async () => ({ category_list: { categories: [] } }) });
assert.equal(categoryFailure.state.state, 'failed');
assert.deepEqual(categoryFailure.posts, []);
let queryCalls = 0;
const news = await collectGoogleNews({ now, queries: ['one', 'two'], pause: noWait,
  read: async () => { if (++queryCalls === 2) throw Error('RSS unavailable'); return '<rss><channel></channel></rss>'; } });
assert.equal(news.state.state, 'partial');
assert.equal(news.state.queries.filter(query => query.ok).length, 1);
assert.equal(news.state.lastSuccessAt, null);

const dir = mkdtempSync(join(tmpdir(), 'chatter-reliability-'));
const post = (id, timestamp = '2026-09-14T12:00:00Z', text = 'Captured fixture') => ({ id: `valuepickr-${id}`, source: 'valuepickr', timestamp, text, url: `https://fixture.test/${id}`, sentiment: 'neutral' });
try {
  const archive = openArchive(dir, now);
  archive.merge({ ticker: 'alpha', name: 'Alpha', generatedAt: '2026-09-14T13:00:00Z', posts: [post(1), post(2, '2026-05-01T12:00:00Z')] });
  archive.merge({ ticker: 'alpha', name: 'Alpha', generatedAt: now.toISOString(), posts: [post(1, undefined, 'Source correction')] });
  archive.merge({ ticker: 'alpha', name: 'Alpha', generatedAt: '2026-09-14T13:00:00Z', posts: [post(1)] });
  assert.equal(archive.save().totalPosts, 2);
  const saved = readJson(join(dir, 'archive/posts/alpha/2026-09.json'));
  assert.equal(saved.posts[0].text, 'Source correction', 'older recovery cannot overwrite a newer observation');
  assert.equal(saved.posts[0].firstSeenAt, '2026-09-14T13:00:00Z');
  assert.equal(archive.recentFiles()[0].posts.length, 1);
  writeJson(join(dir, 'posts/alpha.json'), { ticker: 'alpha', name: 'Alpha', generatedAt: now.toISOString(), posts: [post(1)] });
  const readers = {
    valuepickr: async () => ({ posts: [{ source: 'valuepickr', id: '3', topicId: '1', topicTitle: 'Alpha', timestamp: now.toISOString(), text: 'New observation', url: 'https://fixture.test/3' }], state: { state: 'ok', lastSuccessAt: now.toISOString() } }),
    news: async () => { throw Error('News unavailable'); },
    tradingqna: async () => ({ posts: [], state: { state: 'ok', lastSuccessAt: now.toISOString() } }),
  };
  const collected = await collect({ dataDir: dir, now, readers, recover: false });
  assert.equal(collected.trending.totalPosts, 2);
  assert.equal(collected.collection.sources.news.state, 'failed');
  assert.equal(readJson(join(dir, 'archive/index.json')).totalPosts, 3);
  const oldCheckedAt = readJson(join(dir, 'archive/posts/alpha/2026-09.json')).posts.find(post => post.id === 'valuepickr-1').lastSeenAt;
  assert.equal(oldCheckedAt, now.toISOString(), 'known source time is preserved');
  const offline = Object.fromEntries(Object.keys(readers).map(key => [key, async () => { throw Error('offline'); }]));
  const later = await collect({ dataDir: dir, now: new Date('2026-10-20T12:00:00Z'), readers: offline, recover: false });
  assert.equal(later.trending.totalPosts, 0, 'old observations leave the display window');
  assert.equal(readJson(join(dir, 'archive/index.json')).totalPosts, 3, 'rollover and failed sources do not erase history');
  writeFileSync(join(dir, 'archive/index.json'), '{broken');
  assert.throws(() => openArchive(dir, now), 'corrupt history cannot be silently replaced');
} finally { rmSync(dir, { recursive: true, force: true }); }
console.log('PASS interrupted pagination, cooldowns, category failure, partial/empty queries, durable deduplication, recovery ordering, source isolation, rollover and corrupt-history protection');

const gitDir = mkdtempSync(join(tmpdir(), 'chatter-git-fixture-'));
try {
  const git = (...args) => execFileSync('git', args, { cwd: gitDir, stdio: 'pipe' });
  git('init'); git('config', 'user.name', 'Local fixture'); git('config', 'user.email', 'fixture@example.test');
  const target = join(gitDir, 'public/data/posts/alpha.json');
  const file = posts => ({ ticker: 'alpha', name: 'Alpha', generatedAt: now.toISOString(), posts });
  writeJson(target, file([{ id: 'valuepickr-ALPHA-0', source: 'valuepickr', timestamp: now.toISOString(), text: 'Demo' }]));
  git('add', '.'); git('commit', '-m', 'Demo fixture');
  writeJson(target, file([{ id: 'valuepickr-123', source: 'valuepickr', timestamp: now.toISOString(), text: 'Real-format fixture' }]));
  git('add', '.'); git('commit', '-m', 'Capture fixture');
  const archive = openArchive(join(gitDir, 'retained'), now);
  const first = recoverGitHistory(archive, gitDir, {}, { maxBlobs: 1 });
  assert.equal(first.complete, false);
  const second = recoverGitHistory(archive, gitDir, first, { maxBlobs: 1 });
  assert.equal(second.complete, true); assert.equal(second.offset, 2);
  assert.equal(archive.save().totalPosts, 1, 'historical demo data cannot return as evidence');
} finally { rmSync(gitDir, { recursive: true, force: true }); }
console.log('PASS batch Git recovery, durable cursor and exclusion of synthetic history');
