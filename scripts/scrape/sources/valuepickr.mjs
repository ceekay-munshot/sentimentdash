/**
 * ValuePickr source — fetches recent posts about the tracked stocks from the
 * ValuePickr investor forum (forum.valuepickr.com, a Discourse instance).
 *
 * No account or API key required. ValuePickr's recent activity skews heavily
 * toward small/mid-caps, so a site-wide feed barely overlaps our large-cap
 * universe. Instead this runs one Discourse search per stock — search weights
 * topic titles, which carry the company name — and pre-attributes each
 * returned post to that stock via the shared `tickers` field.
 */
import { STOCKS } from '../stocks.mjs';

const UA =
  'sentimentdash/0.1 (Indian stock sentiment dashboard; +https://github.com/ceekay-munshot/sentimentdash)';

const BASE = 'https://forum.valuepickr.com';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Most ValuePickr topics are titled with the company name; a few need a
// different search term than the formal name in stocks.mjs.
const SEARCH_TERM_OVERRIDES = { PAYTM: 'Paytm' };
const searchTermFor = (stock) => SEARCH_TERM_OVERRIDES[stock.ticker] || stock.name;

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

/** Reduces a Discourse HTML snippet to plain text. */
function stripHtml(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;|&#39;|&amp;|&lt;|&gt;|&nbsp;|&hellip;/g, (m) => ENTITIES[m])
    .replace(/\s+/g, ' ')
    .trim();
}

function normalize(post, topicMap, ticker) {
  const author = post.username || post.name || 'unknown';
  let text = stripHtml(post.blurb);
  if (text.length > 600) text = `${text.slice(0, 600).trimEnd()}…`;
  const topic = topicMap.get(post.topic_id) || {};
  return {
    source: 'valuepickr',
    id: String(post.id),
    author,
    handle: `@${author}`,
    community: topic.title || 'ValuePickr',
    timestamp: new Date(post.created_at).toISOString(),
    text: text || '(no preview)',
    tickers: [ticker],
    url: topic.slug
      ? `${BASE}/t/${topic.slug}/${post.topic_id}/${post.post_number || 1}`
      : `${BASE}/t/${post.topic_id}`,
    likes: typeof post.like_count === 'number' ? post.like_count : 0,
    comments: 0,
  };
}

/** Searches ValuePickr for one stock and returns its recent posts. */
async function searchStock(stock, windowMs, maxPages) {
  const cutoff = Date.now() - windowMs;
  const query = encodeURIComponent(`${searchTermFor(stock)} order:latest`);
  const posts = [];

  for (let page = 1; page <= maxPages; page++) {
    const data = await fetchJSON(`${BASE}/search.json?q=${query}&page=${page}`);
    const results = data?.posts || [];
    if (results.length === 0) break;

    const topicMap = new Map(
      (data.topics || []).map((t) => [t.id, { title: t.title || t.fancy_title, slug: t.slug }]),
    );
    for (const p of results) {
      const ts = new Date(p.created_at).getTime();
      if (!Number.isFinite(ts) || ts < cutoff) continue;
      posts.push(normalize(p, topicMap, stock.ticker));
    }
    await sleep(2000);
  }
  return posts;
}

/**
 * Searches ValuePickr for every tracked stock within the time window.
 * A failing search is logged and skipped rather than aborting the run.
 */
export async function fetchValuePickrPosts({ windowHours = 24, maxPagesPerStock = 2 } = {}) {
  const windowMs = windowHours * 3600 * 1000;
  const all = [];

  for (const stock of STOCKS) {
    try {
      const posts = await searchStock(stock, windowMs, maxPagesPerStock);
      if (posts.length > 0) console.log(`[valuepickr] ${stock.ticker}: ${posts.length} posts`);
      all.push(...posts);
    } catch (err) {
      console.error(`[valuepickr] ${stock.ticker} search failed: ${err.message}`);
    }
    await sleep(5000); // gentle on Discourse search rate limits
  }

  // De-dupe identical (post, ticker) attributions.
  const seen = new Set();
  const deduped = all.filter((p) => {
    const key = `${p.id}:${p.tickers[0]}`;
    return !seen.has(key) && seen.add(key);
  });
  console.log(`[valuepickr] ${deduped.length} posts across ${STOCKS.length} stocks`);
  return deduped;
}
