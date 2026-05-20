/**
 * ValuePickr source — discovers what the ValuePickr investor forum
 * (forum.valuepickr.com, a Discourse instance) is currently discussing.
 *
 * There is no fixed stock list. It reads the forum's recent posts; the
 * pipeline then groups them by topic, and every company topic with recent
 * activity becomes a trending entry — small-caps surface by buzz alone.
 *
 * Posts are restricted to ValuePickr's stock/company categories so the
 * trending list is companies rather than macro/strategy/lounge threads.
 */

const UA =
  'sentimentdash/0.1 (Indian stock sentiment dashboard; +https://github.com/ceekay-munshot/sentimentdash)';

const BASE = 'https://forum.valuepickr.com';

// A ValuePickr category counts as company discussion if its name matches
// STOCK_CATEGORY_PATTERN but not NON_COMPANY_PATTERN — the latter strips
// learning / screener / conference / meta categories that hold non-company
// threads (e.g. "Investment Learning", "VP at Investment Conferences").
const STOCK_CATEGORY_PATTERN = /stock|sme|business analysis|investment/i;
const NON_COMPANY_PATTERN =
  /learning|screen|conference|webinar|tracking|lounge|feedback|wiki|portfolio management/i;

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

/** Discovers the ids of ValuePickr's company-discussion categories. */
async function fetchStockCategoryIds() {
  const data = await fetchJSON(`${BASE}/categories.json?include_subcategories=true`);
  const top = data?.category_list?.categories || [];
  const flat = [];
  for (const c of top) {
    flat.push(c);
    for (const sub of c.subcategory_list || []) flat.push(sub);
  }
  const selected = flat.filter((c) => {
    const name = c.name || '';
    return STOCK_CATEGORY_PATTERN.test(name) && !NON_COMPANY_PATTERN.test(name);
  });
  console.log(
    `[valuepickr] categories: ${flat.length} found, ${selected.length} selected` +
      (selected.length ? ` (${selected.map((c) => c.name).join(', ')})` : ''),
  );
  return new Set(selected.map((c) => c.id));
}

function normalize(post) {
  const author = post.username || post.name || 'unknown';
  let text = stripHtml(post.cooked);
  if (text.length > 600) text = `${text.slice(0, 600).trimEnd()}…`;
  const topicId = String(post.topic_id);
  const topicSlug = post.topic_slug || topicId;
  const topicTitle = post.topic_title || topicSlug;
  const likes = Array.isArray(post.actions_summary)
    ? post.actions_summary.find((a) => a.id === 2)?.count || 0
    : 0;
  return {
    source: 'valuepickr',
    id: String(post.id),
    author,
    handle: `@${author}`,
    community: topicTitle,
    timestamp: new Date(post.created_at).toISOString(),
    text: text || '(no preview)',
    url: `${BASE}/t/${topicSlug}/${topicId}/${post.post_number || 1}`,
    likes,
    comments: typeof post.reply_count === 'number' ? post.reply_count : 0,
    topicId,
    topicTitle,
    categoryId: post.category_id,
  };
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
      posts.push(normalize(p));
    }

    before = batch[batch.length - 1]?.id;
    if (!before || reachedOlder) break;
    await sleep(1500);
  }
  return posts;
}

/**
 * Fetches recent ValuePickr posts within the time window, restricted to the
 * company-discussion categories. If the category filter would drop everything
 * (e.g. category lookup failed), it degrades to returning all posts.
 */
export async function fetchValuePickrPosts({ windowHours = 24, maxPages = 8 } = {}) {
  const windowMs = windowHours * 3600 * 1000;

  let categoryIds = new Set();
  try {
    categoryIds = await fetchStockCategoryIds();
  } catch (err) {
    console.error(`[valuepickr] category lookup failed: ${err.message}`);
  }

  let posts = [];
  try {
    posts = await fetchRecentPosts(windowMs, maxPages);
  } catch (err) {
    console.error(`[valuepickr] post fetch failed: ${err.message}`);
  }

  let scoped = posts;
  if (categoryIds.size > 0) {
    const filtered = posts.filter((p) => categoryIds.has(p.categoryId));
    if (filtered.length > 0) {
      scoped = filtered;
    } else if (posts.length > 0) {
      console.warn('[valuepickr] category filter matched no posts — keeping all topics');
    }
  } else {
    console.warn('[valuepickr] no stock categories identified — keeping all topics');
  }

  const seen = new Set();
  const deduped = scoped.filter((p) => !seen.has(p.id) && seen.add(p.id));
  console.log(`[valuepickr] ${deduped.length} posts in window (from ${posts.length} fetched)`);
  return deduped;
}
