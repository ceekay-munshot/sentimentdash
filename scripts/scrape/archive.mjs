// Public captured mentions are retained independently of the rolling dashboard.
// Git publishes the complete set atomically. Monthly topic files keep individual reads bounded.
import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const SLUG = /^[a-z0-9][a-z0-9._-]{0,160}$/i;
export function readJson(path, fallback = null) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, 'utf8')); // Corrupt history must stop publication, never become empty.
}
export function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(`${path}.tmp`, `${JSON.stringify(value)}\n`);
  renameSync(`${path}.tmp`, path);
}
export function postFiles(dataDir) {
  const dir = join(dataDir, 'posts');
  return existsSync(dir) ? readdirSync(dir).filter(name => name.endsWith('.json')).map(name => readJson(join(dir, name))) : [];
}
export function openArchive(dataDir, now = new Date()) {
  const indexPath = join(dataDir, 'archive/index.json');
  const index = readJson(indexPath, { version: 1, startedAt: now.toISOString(), topics: {}, totalPosts: 0,
    limitation: 'Retained captured mentions, not an exhaustive source archive. Earlier deletions and records never captured may be unrecoverable.' });
  if (index.version !== 1 || !index.topics || !Number.isFinite(index.totalPosts)) throw new Error('Invalid retained chatter index');
  const changed = new Map(), identities = new Map(), dirtyIdentities = new Set();
  const partitionPath = (ticker, month) => join(dataDir, 'archive/posts', ticker, `${month}.json`);
  const readPartition = (ticker, month) => changed.get(partitionPath(ticker, month)) || readJson(partitionPath(ticker, month));
  function identityShard(id) {
    const shard = createHash('sha256').update(id).digest('hex').slice(0, 2);
    const path = join(dataDir, 'archive/identities', `${shard}.json`);
    if (!identities.has(path)) {
      const value = readJson(path, {});
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid archive identity checkpoint');
      identities.set(path, value);
    }
    return { path, records: identities.get(path) };
  }
  function savePartition(file) {
    const { ticker, month } = file;
    const posts = file.posts.sort((a, b) => b.timestamp.localeCompare(a.timestamp) || a.id.localeCompare(b.id));
    changed.set(partitionPath(ticker, month), { ...file, generatedAt: now.toISOString(), posts });
    const topic = index.topics[ticker] ||= { ticker, name: file.name, months: {} };
    if (posts.length) topic.months[month] = { count: posts.length, revision: now.toISOString(),
      earliestAt: posts.at(-1).timestamp, latestAt: posts[0].timestamp };
    else delete topic.months[month];
    topic.count = Object.values(topic.months).reduce((sum, part) => sum + part.count, 0);
    if (!topic.count) { delete index.topics[ticker]; return; }
    // Older indices did not include each month's date bounds. Resolve those once on upgrade.
    for (const [key, part] of Object.entries(topic.months)) if (!part.earliestAt || !part.latestAt) {
      const held = readPartition(ticker, key);
      if (!Array.isArray(held?.posts) || held.posts.length !== part.count) throw new Error('Retained partition is missing or incomplete');
      const dates = held.posts.map(post => post.timestamp).sort();
      part.earliestAt = dates[0]; part.latestAt = dates.at(-1);
    }
    topic.earliestAt = Object.values(topic.months).map(part => part.earliestAt).sort()[0];
    topic.latestAt = Object.values(topic.months).map(part => part.latestAt).sort().at(-1);
  }
  function merge(file) {
    if (!file || !SLUG.test(file.ticker) || !Array.isArray(file.posts)) throw new Error('Invalid captured topic');
    const observed = file.generatedAt || now.toISOString();
    if (file.posts.length) index.startedAt = [index.startedAt, observed].filter(Boolean).sort()[0];
    for (const post of file.posts) {
      if (!post.id || !post.source || !Number.isFinite(Date.parse(post.timestamp))) throw new Error('Invalid captured mention');
      const month = new Date(post.timestamp).toISOString().slice(0, 7);
      const incomingAt = post.lastSeenAt || observed;
      const shard = identityShard(post.id), location = shard.records[post.id];
      let old;
      if (location) {
        const held = readPartition(location.ticker, location.month);
        old = held?.posts?.find(row => row.id === post.id);
        if (!old) throw new Error('Retained identity points to a missing post');
        if (incomingAt < (old.lastSeenAt || old.firstSeenAt || '')) {
          // Recover earlier observation time without resurrecting the old date/topic/text.
          const firstSeenAt = [old.firstSeenAt, post.firstSeenAt, observed].filter(Boolean).sort()[0];
          if (firstSeenAt !== old.firstSeenAt) savePartition({ ...held, posts: held.posts.map(row => row.id === post.id ? { ...row, firstSeenAt } : row) });
          continue;
        }
        if (location.ticker !== file.ticker || location.month !== month) {
          savePartition({ ...held, posts: held.posts.filter(row => row.id !== post.id) });
        }
      }
      const prior = readPartition(file.ticker, month) || { ticker: file.ticker, name: file.name, month, posts: [] };
      if (!Array.isArray(prior.posts) || prior.ticker !== file.ticker || prior.month !== month) throw new Error('Invalid retained mention partition');
      const byId = new Map(prior.posts.map(row => [row.id, row]));
      old ||= byId.get(post.id);
      const oldAt = old?.lastSeenAt || old?.firstSeenAt || '';
      const latest = !old || incomingAt >= oldAt ? post : old;
      byId.set(post.id, { ...latest,
        firstSeenAt: [old?.firstSeenAt, post.firstSeenAt, observed].filter(Boolean).sort()[0],
        lastSeenAt: [oldAt, incomingAt].sort().at(-1) });
      savePartition({ ...prior, name: file.name || prior.name, posts: [...byId.values()] });
      shard.records[post.id] = { ticker: file.ticker, month };
      dirtyIdentities.add(shard.path);
      index.startedAt = [index.startedAt, observed].filter(Boolean).sort()[0];
    }
  }
  function recentFiles() {
    const cutoff = now.getTime() - 30 * 86400000;
    const files = [];
    for (const topic of Object.values(index.topics)) {
      const posts = [];
      for (const month of Object.keys(topic.months).filter(month => month >= new Date(cutoff).toISOString().slice(0, 7))) {
        const path = join(dataDir, 'archive/posts', topic.ticker, `${month}.json`);
        const file = changed.get(path) || readJson(path);
        if (!Array.isArray(file?.posts)) throw new Error('Retained mention partition is missing');
        posts.push(...file.posts.filter(post => Date.parse(post.timestamp) >= cutoff));
      }
      if (posts.length) files.push({ ticker: topic.ticker, name: topic.name, posts });
    }
    return files;
  }
  function save() {
    for (const [path, value] of changed) writeJson(path, value);
    for (const path of dirtyIdentities) writeJson(path, identities.get(path));
    index.updatedAt = now.toISOString();
    index.totalPosts = Object.values(index.topics).reduce((sum, topic) => sum + topic.count, 0);
    writeJson(indexPath, index);
    return index;
  }
  if (!index.identityVersion) {
    // Upgrade existing captures once, including any cross-month duplicate from older code.
    const files = Object.values(index.topics).flatMap(topic => Object.keys(topic.months).map(month => {
      const file = readPartition(topic.ticker, month);
      if (!file) throw new Error('Retained partition is missing');
      return file;
    }));
    index.topics = {};
    for (const file of files) changed.set(partitionPath(file.ticker, file.month), { ...file, posts: [] });
    for (const file of files) merge(file);
    index.identityVersion = 1;
  }
  return { index, merge, recentFiles, save };
}

// Recover retained Git blobs in bounded batches. The pinned commit and offset survive later
// collector runs; old observations cannot overwrite a newer source correction.
export function recoverGitHistory(archive, root, previous = {}, { maxBlobs = 50000, maxDurationMs = 30000 } = {}) {
  if (previous.complete) return previous;
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  const head = previous.head || git(['rev-parse', 'HEAD']).trim();
  const objects = git(['rev-list', '--objects', head, '--', 'public/data/posts/']).trim().split('\n')
    .filter(line => /^[a-f0-9]{40} public\/data\/posts\/[^/]+\.json$/.test(line));
  let offset = previous.offset || 0;
  const selected = objects.slice(offset, offset + maxBlobs);
  const deadline = Date.now() + maxDurationMs;
  // One Git process per 100 blobs, rather than thousands of process launches per run.
  for (let start = 0; start < selected.length && Date.now() < deadline; start += 100) {
    const hashes = selected.slice(start, start + 100).map(line => line.split(' ')[0]);
    const data = execFileSync('git', ['cat-file', '--batch'], { cwd: root,
      input: hashes.join('\n') + '\n', maxBuffer: 128 * 1024 * 1024 });
    let cursor = 0;
    for (const hash of hashes) {
      const end = data.indexOf(10, cursor);
      const [id, type, bytes] = data.subarray(cursor, end).toString().split(' ');
      const size = Number(bytes);
      if (end < 0 || id !== hash || type !== 'blob' || !Number.isInteger(size)) throw new Error('Invalid historical Git blob');
      cursor = end + 1;
      const file = JSON.parse(data.subarray(cursor, cursor + size).toString());
      cursor += size + 1;
      // The initial demo used generated examples. Only real source IDs are evidence.
      file.posts = (file.posts || []).filter(post =>
        (post.source === 'valuepickr' && /^valuepickr-\d+$/.test(post.id)) ||
        (post.source === 'tradingqna' && /^tradingqna-tqna-\d+$/.test(post.id)) ||
        (post.source === 'news' && /^news-gn-/.test(post.id)));
      if (file.posts.length) archive.merge(file);
      offset++;
    }
  }
  return { head, offset, totalBlobs: objects.length, complete: offset >= objects.length };
}

export function asRawPosts(files) {
  return files.flatMap(file => file.posts.map(post => ({ ...post,
    id: post.id.startsWith(`${post.source}-`) ? post.id.slice(post.source.length + 1) : post.id,
    topicId: file.ticker, topicTitle: file.name })));
}
