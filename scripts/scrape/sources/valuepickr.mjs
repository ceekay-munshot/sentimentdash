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

import { readSource, collectForum } from './transport.mjs';

const BASE = 'https://forum.valuepickr.com';

// A ValuePickr category counts as company discussion if its name matches
// STOCK_CATEGORY_PATTERN but not NON_COMPANY_PATTERN — the latter strips
// learning / screener / conference / meta categories that hold non-company
// threads (e.g. "Investment Learning", "VP at Investment Conferences").
const STOCK_CATEGORY_PATTERN = /stock|sme|business analysis|investment/i;
const NON_COMPANY_PATTERN =
  /learning|screen|conference|webinar|tracking|lounge|feedback|wiki|portfolio management/i;

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
async function fetchStockCategoryIds(read = readSource) {
  const data = await read(`${BASE}/categories.json?include_subcategories=true`);
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

export async function collectValuePickr(options = {}) {
  const previous = options.previous || {};
  if (Date.parse(previous.retryAt || '') > (options.now || new Date()).getTime()) return { posts: [], state: { ...previous, state: 'cooldown' } };
  let categories;
  try {
    categories = await fetchStockCategoryIds(options.read);
    if (!categories.size) throw new Error('No company categories were identified');
  } catch (error) {
    return { posts: [], state: { ...previous, state: 'failed', lastAttemptAt: (options.now || new Date()).toISOString(), error: error.message, retryAt: error.retryAt || null } };
  }
  const result = await collectForum({ ...options, base: BASE });
  return { ...result, posts: result.posts.filter(post => categories.has(post.category_id)).map(normalize) };
}

export async function fetchValuePickrPosts(options = {}) {
  return (await collectValuePickr(options)).posts;
}
