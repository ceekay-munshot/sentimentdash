/**
 * TradingQnA source — discovers companies from Zerodha's TradingQnA forum
 * (tradingqna.com, a Discourse instance) via its public posts API.
 *
 * No login and no API key. Discourse serves JSON to datacenter IPs fine — the
 * same endpoint ValuePickr uses — so this works from CI.
 *
 * TradingQnA is a Q&A forum: each post belongs to a question whose title
 * usually names the stock ("Why is Suzlon Energy falling?"). The company is
 * extracted from that title with the heuristic Google News headlines use;
 * posts carry it as `companyName` and companies.mjs keys them. Q&A about
 * trading mechanics with no company simply yields nothing.
 */
import { extractCompany } from './googlenews.mjs';

const UA =
  'sentimentdash/0.1 (Indian stock sentiment dashboard; +https://github.com/ceekay-munshot/sentimentdash)';

const BASE = 'https://tradingqna.com';

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

/** Reduces a Discourse `cooked` HTML body to plain text, dropping quoted replies. */
function stripHtml(html) {
  return String(html || '')
    .replace(/<aside\b[^>]*\bquote\b[\s\S]*?<\/aside>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;|&#39;|&amp;|&lt;|&gt;|&nbsp;|&hellip;/g, (m) => ENTITIES[m])
    .replace(/\s+/g, ' ')
    .trim();
}

/** Pages through the site-wide post stream until the time window is covered. */
async function fetchRecentPosts(windowMs, maxPages) {
  const cutoff = Date.now() - windowMs;
  const posts = [];
  let before = null;

  for (let page = 0; page < maxPages; page++) {
    const data = await fetchJSON(`${BASE}/posts.json${before ? `?before=${before}` : ''}`);
    const batch = data?.latest_posts || [];
    if (batch.length === 0) break;

    let reachedOlder = false;
    for (const p of batch) {
      if (p.post_type !== 1 || p.hidden || p.deleted_at || p.username === 'system') continue;
      const ts = new Date(p.created_at).getTime();
      if (!Number.isFinite(ts)) continue;
      if (ts < cutoff) {
        reachedOlder = true;
        continue;
      }
      posts.push(p);
    }

    before = batch[batch.length - 1]?.id;
    if (!before || reachedOlder) break;
    await sleep(1500);
  }
  return posts;
}

function normalize(post) {
  const companyName = extractCompany(post.topic_title || '');
  if (!companyName) return null;

  const author = post.username || post.name || 'unknown';
  const body = stripHtml(post.cooked);
  let text = body ? `${post.topic_title} — ${body}` : String(post.topic_title || '');
  if (text.length > 600) text = `${text.slice(0, 600).trimEnd()}…`;

  const topicId = String(post.topic_id);
  const topicSlug = post.topic_slug || topicId;
  const likes = Array.isArray(post.actions_summary)
    ? post.actions_summary.find((a) => a.id === 2)?.count || 0
    : 0;

  return {
    source: 'tradingqna',
    id: `tqna-${post.id}`,
    author,
    handle: `@${author}`,
    community: 'TradingQnA',
    timestamp: new Date(post.created_at).toISOString(),
    text: text || '(no preview)',
    url: `${BASE}/t/${topicSlug}/${topicId}/${post.post_number || 1}`,
    likes,
    comments: typeof post.reply_count === 'number' ? post.reply_count : 0,
    companyName,
  };
}

/**
 * Fetches recent TradingQnA posts whose question title names a company.
 * Returns [] on failure rather than throwing.
 */
export async function fetchTradingQnaPosts({ windowHours = 720, maxPages = 30 } = {}) {
  const windowMs = windowHours * 3600 * 1000;

  const raw = await fetchRecentPosts(windowMs, maxPages);
  const posts = raw.map(normalize).filter(Boolean);

  const seen = new Set();
  const deduped = posts.filter((p) => !seen.has(p.id) && seen.add(p.id));
  console.log(`[tradingqna] ${deduped.length} posts with a company (from ${raw.length} fetched)`);
  return deduped;
}
