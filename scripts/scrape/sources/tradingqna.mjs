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

import { collectForum } from './transport.mjs';
const BASE = 'https://tradingqna.com';

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

export async function collectTradingQna(options = {}) {
  const result = await collectForum({ ...options, base: BASE });
  return { ...result, posts: result.posts.map(normalize).filter(Boolean) };
}
export async function fetchTradingQnaPosts(options = {}) {
  return (await collectTradingQna(options)).posts;
}
