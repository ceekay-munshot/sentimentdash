// Bounded public-source reads. A source refusal/cooldown stops that source's walk.
export class SourceError extends Error {
  constructor(message, retryAt = null) { super(message); this.retryAt = retryAt; }
}
export async function readSource(url, { type = 'json', fetcher = fetch, now = Date.now(), sleep = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetcher(url, {
        headers: { 'User-Agent': 'sentimentdash/0.2 (+https://github.com/ceekay-munshot/sentimentdash)', Accept: type === 'json' ? 'application/json' : 'application/rss+xml, application/xml, text/xml' },
        signal: AbortSignal.timeout(15000),
      });
      if (response.status === 429 || response.status === 403) {
        const retry = response.headers.get('retry-after');
        const until = /^\d+$/.test(retry || '') ? now + Number(retry) * 1000 : Date.parse(retry || '');
        throw new SourceError(`Source returned HTTP ${response.status}`, new Date(Math.max(now + 30 * 60000, until || 0)).toISOString());
      }
      if (!response.ok) throw new SourceError(`Source returned HTTP ${response.status}`);
      if (Number(response.headers.get('content-length')) > 8 * 1024 * 1024) throw new SourceError('Source response exceeds the supported page size');
      const text = await response.text();
      if (text.length > 8 * 1024 * 1024) throw new SourceError('Source response exceeds the supported page size');
      return type === 'json' ? JSON.parse(text) : text;
    } catch (error) {
      if (error.retryAt || attempt === 2) throw error;
      await sleep(1000 * 2 ** attempt);
    }
  }
}

// Resume at the last successfully read page. A failed page never advances its cursor.
export async function walkPosts({ base, before = null, cutoff, maxPages = 15, read = readSource, sleep = ms => new Promise(r => setTimeout(r, ms)) }) {
  const posts = [];
  let cursor = before, pages = 0, complete = false, error = null, retryAt = null;
  try {
    for (; pages < maxPages;) {
      const data = await read(`${base}/posts.json${cursor ? `?before=${encodeURIComponent(cursor)}` : ''}`);
      if (!Array.isArray(data?.latest_posts)) throw new Error('Forum returned an invalid post page');
      const batch = data.latest_posts;
      pages++;
      if (!batch.length) { complete = true; break; }
      const dates = batch.map(post => Date.parse(post.created_at));
      if (dates.some(date => !Number.isFinite(date))) throw new Error('Forum page contains undated posts');
      posts.push(...batch.filter((post, i) => dates[i] >= cutoff && post.post_type === 1 && !post.hidden && !post.deleted_at && post.username !== 'system'));
      if (dates.every(date => date < cutoff)) { complete = true; break; }
      const next = String(batch.at(-1)?.id || '');
      if (!next || next === String(cursor)) throw new Error('Forum pagination did not advance');
      cursor = next;
      if (pages < maxPages) await sleep(1500);
    }
  } catch (err) { error = String(err.message || err); retryAt = err.retryAt || null; }
  return { posts, before: complete ? null : cursor, pages, complete, error, retryAt };
}

// Refresh the recent head on every run; reconcile the 30-day source window in resumable slices.
export async function collectForum({ base, previous = {}, now = new Date(), read = readSource, sleep, headPages = 15, historyPages = 15 }) {
  const nowMs = now.getTime(), at = now.toISOString();
  if (Date.parse(previous.retryAt || '') > nowMs) return { posts: [], state: { ...previous, state: 'cooldown' } };
  const headCutoff = Math.min(nowMs - 24 * 3600000, Date.parse(previous.lastSuccessAt || at) - 3600000);
  const head = await walkPosts({ base, cutoff: headCutoff, maxPages: headPages, read, sleep });
  let history = previous.history || { before: null, cutoff: new Date(nowMs - 30 * 86400000).toISOString(), complete: false };
  if (history.complete && nowMs - Date.parse(history.completedAt || 0) >= 86400000) history = { before: null, cutoff: new Date(nowMs - 30 * 86400000).toISOString(), complete: false };
  let backfill = null;
  if (!head.error && !history.complete) {
    backfill = await walkPosts({ base, before: history.before, cutoff: Date.parse(history.cutoff), maxPages: historyPages, read, sleep });
    history = { ...history, before: backfill.before, complete: backfill.complete, ...(backfill.complete ? { completedAt: at } : {}) };
  }
  const error = head.error || backfill?.error || null;
  return {
    posts: [...new Map([...head.posts, ...(backfill?.posts || [])].map(post => [post.id, post])).values()],
    state: { ...previous, state: error ? 'failed' : !head.complete || !history.complete ? 'partial' : 'ok',
      lastAttemptAt: at, lastSuccessAt: head.complete && !head.error ? at : previous.lastSuccessAt || null,
      error, retryAt: head.retryAt || backfill?.retryAt || null, history,
      pages: head.pages + (backfill?.pages || 0), headComplete: head.complete },
  };
}
