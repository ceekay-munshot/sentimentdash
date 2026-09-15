/** Scheduled collection: recent head, resumable forum reconciliation and durable captured history. */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectValuePickr } from './sources/valuepickr.mjs';
import { collectGoogleNews } from './sources/googlenews.mjs';
import { collectTradingQna } from './sources/tradingqna.mjs';
import { keyPosts } from './companies.mjs';
import { loadHistory } from './history.mjs';
import { buildData } from './aggregate.mjs';
import { readJson, writeJson, openArchive, postFiles, asRawPosts, recoverGitHistory } from './archive.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const INTERVAL_MS = 2 * 3600000;
export async function collect({ dataDir = join(ROOT, 'public/data'), now = new Date(), recover = true,
  readers = { valuepickr: collectValuePickr, news: collectGoogleNews, tradingqna: collectTradingQna }, scheduled = false } = {}) {
  const statePath = join(dataDir, 'collection.json');
  const prior = readJson(statePath, { version: 1, sources: {} });
  if (prior.version !== 1 || !prior.sources) throw new Error('Invalid collection checkpoint');
  const due = !scheduled || now.getTime() - Date.parse(prior.lastAttemptAt || '1970-01-01') >= INTERVAL_MS;
  if (!due && prior.archive?.recovery?.complete) return { skipped: true, collection: prior };
  const archive = openArchive(dataDir, now);
  // Seed the current files before the rolling window can age anything out.
  for (const file of postFiles(dataDir)) archive.merge(file);
  if (recover) archive.index.recovery = recoverGitHistory(archive, ROOT, archive.index.recovery);
  const sources = { ...prior.sources }, results = {};
  if (due) {
    for (const [source, reader] of Object.entries(readers)) {
      try {
        results[source] = await reader({ previous: sources[source] || {}, now });
        sources[source] = results[source].state;
      } catch (error) {
        results[source] = { posts: [] };
        sources[source] = { ...sources[source], state: 'failed', lastAttemptAt: now.toISOString(), error: error.message };
      }
    }
  }
  const pending = readJson(join(dataDir, 'pending-discovery.json'), { posts: [] });
  const observations = [...new Map([...pending.posts, ...Object.values(results).flatMap(result => result.posts).map(post => ({ ...post, firstSeenAt: now.toISOString(), lastSeenAt: now.toISOString() }))].map(post => [`${post.source}:${post.id}`, post])).values()];
  const known = asRawPosts(archive.recentFiles());
  const tagged = keyPosts([...known.filter(post => post.source === 'valuepickr'), ...observations.filter(post => post.source === 'valuepickr')],
    [...known.filter(post => post.source !== 'valuepickr').map(post => ({ ...post, companyName: post.topicTitle })), ...observations.filter(post => post.source !== 'valuepickr')]);
  const keyedIds = new Set(tagged.map(post => `${post.source}:${post.id}`));
  // Unresolved company discovery remains retained instead of disappearing when a query rotates.
  writeJson(join(dataDir, 'pending-discovery.json'), { version: 1, posts: observations.filter(post => !keyedIds.has(`${post.source}:${post.id}`)) });
  const merged = [...new Map([...known, ...tagged].map(post => [`${post.source}:${post.id}`, post])).values()];
  for (const file of buildData(tagged, { runs: [] }, now, { retainAll: true }).postsFiles) archive.merge(file);
  const { trending, postsFiles, history } = buildData(merged, loadHistory(join(dataDir, 'history.json')), now);
  for (const file of postsFiles) archive.merge(file);
  const retained = archive.save();
  const collection = { version: 1, intervalMinutes: INTERVAL_MS / 60000,
    lastAttemptAt: due ? now.toISOString() : prior.lastAttemptAt || null, sources,
    state: Object.values(sources).length === 3 && Object.values(sources).every(source => source.state === 'ok') ? 'ok' : 'partial',
    discoveryOnly: true, archive: { startedAt: retained.startedAt, totalPosts: retained.totalPosts,
      topics: Object.keys(retained.topics).length, recovery: retained.recovery || null,
      limitation: retained.limitation, unresolvedPosts: observations.filter(post => !keyedIds.has(`${post.source}:${post.id}`)).length } };
  // Old per-topic files remain usable. The recent dashboard is derived from all retained
  // observations still inside 30 days, including the last good layer of a failed source.
  for (const file of postsFiles) writeJson(join(dataDir, 'posts', `${file.ticker}.json`), file);
  writeJson(join(dataDir, 'trending.json'), { ...trending, collection });
  writeJson(join(dataDir, 'history.json'), history);
  writeJson(statePath, collection);
  console.log(JSON.stringify({ collection: collection.state, sources: Object.fromEntries(Object.entries(sources).map(([key, source]) => [key, source.state])), recentPosts: trending.totalPosts, retainedPosts: retained.totalPosts, recovery: retained.recovery }));
  return { trending, collection };
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  collect({ scheduled: process.env.GITHUB_EVENT_NAME === 'schedule' }).catch(error => { console.error(error); process.exitCode = 1; });
}
