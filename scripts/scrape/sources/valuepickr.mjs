/**
 * ValuePickr source — fetches recent posts from the ValuePickr investor forum
 * (forum.valuepickr.com, a Discourse instance) via its public JSON endpoints.
 *
 * No account or API key required. Discourse exposes /posts.json — a site-wide
 * stream of the latest posts — which is paged backwards until the configured
 * time window is covered.
 *
 * Each post carries a `matchText` field (topic title + body): ValuePickr posts
 * usually live inside a per-company topic and don't repeat the company name in
 * the body, so the topic title is essential for ticker matching.
 */

const UA =
  'sentimentdash/0.1 (Indian stock sentiment dashboard; +https://github.com/ceekay-munshot/sentimentdash)';

const BASE = 'https://forum.valuepickr.com';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** GET JSON with retry + exponential backoff on rate-limit / transient errors. */
async function fetchJSON(url) {
  let lastErr;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
      });
      if (res.ok) return await res.json();
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`HTTP ${res.status}`);
      } else {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch (err) {
      lastErr = err;
    }
    if (attempt < 4) await sleep(2 ** attempt * 1000);
  }
  throw lastErr;
}

const ENTITIES = {
  '&quot;': '"',
  '&#39;': "'",
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&nbsp;': ' ',
  '&hellip;': '…',
};

/** Discourse `cooked` is HTML; reduce it to plain text and drop quoted replies. */
function stripHtml(html) {
  return String(html || '')
    .replace(/<aside\b[^>]*\bquote\b[\s\S]*?<\/aside>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;|&#39;|&amp;|&lt;|&gt;|&nbsp;|&hellip;/g, (m) => ENTITIES[m])
    .replace(/\s+/g, ' ')
    .trim();
}

function normalize(post) {
  const author = post.username || post.name || 'unknown';
  const body = stripHtml(post.cooked);
  let text = body;
  if (text.length > 600) text = `${text.slice(0, 600).trimEnd()}…`;
  const topicTitle = post.topic_title || '';
  const likes = Array.isArray(post.actions_summary)
    ? post.actions_summary.find((a) => a.id === 2)?.count || 0
    : 0;
  return {
    source: 'valuepickr',
    id: String(post.id),
    author,
    handle: `@${author}`,
    community: topicTitle || 'ValuePickr',
    timestamp: new Date(post.created_at).toISOString(),
    text,
    matchText: `${topicTitle} ${body}`.trim(),
    url:
      post.topic_slug && post.topic_id
        ? `${BASE}/t/${post.topic_slug}/${post.topic_id}/${post.post_number || 1}`
        : BASE,
    likes,
    comments: typeof post.reply_count === 'number' ? post.reply_count : 0,
  };
}

/**
 * Fetches recent forum posts within the time window.
 * On failure it logs and returns whatever was gathered so far.
 */
export async function fetchValuePickrPosts({ windowHours = 24, maxPages = 6 } = {}) {
  const cutoff = Date.now() - windowHours * 3600 * 1000;
  const out = [];
  let before = null;

  for (let page = 0; page < maxPages; page++) {
    const url = `${BASE}/posts.json${before ? `?before=${before}` : ''}`;
    let data;
    try {
      data = await fetchJSON(url);
    } catch (err) {
      console.error(`[valuepickr] page ${page + 1} failed: ${err.message}`);
      break;
    }

    const posts = data?.latest_posts || [];
    if (posts.length === 0) break;

    let reachedOlder = false;
    for (const p of posts) {
      // Keep regular, visible posts only — skip system / "small action" entries.
      if (p.post_type !== 1 || p.hidden || p.deleted_at || p.username === 'system') continue;
      const ts = new Date(p.created_at).getTime();
      if (!Number.isFinite(ts)) continue;
      if (ts < cutoff) {
        reachedOlder = true;
        continue;
      }
      out.push(normalize(p));
    }

    before = posts[posts.length - 1]?.id;
    if (!before || reachedOlder) break;
    await sleep(1500);
  }

  // De-dupe by post id.
  const seen = new Set();
  const deduped = out.filter((p) => !seen.has(p.id) && seen.add(p.id));
  console.log(`[valuepickr] ${deduped.length} posts`);
  return deduped;
}
