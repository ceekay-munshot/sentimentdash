/**
 * Entity tagging — attaches free-text posts (Substack articles) to the
 * companies ValuePickr is currently discussing.
 *
 * The aggregator groups posts by topicId (≈ a company). ValuePickr posts carry
 * one natively; Substack articles do not. This module derives a company name
 * index from the ValuePickr-discovered topics and, for every company a post
 * mentions, emits a copy of that post tagged with the company's topicId — so a
 * Substack article naming three stocks enriches three company cards.
 *
 * Companies are only ever introduced by ValuePickr; Substack enriches them.
 * A post mentioning no discovered company is dropped.
 */

// Trailing words generic enough to strip when deriving a short company alias
// ("Suzlon Energy" -> "suzlon"). The distinctive head of the name is kept.
const GENERIC_SUFFIX = new Set([
  'ltd', 'limited', 'industries', 'industry', 'laboratories', 'labs',
  'technologies', 'technology', 'pharmaceuticals', 'pharma', 'finance',
  'financial', 'services', 'service', 'energy', 'power', 'corporation',
  'corp', 'company', 'motors', 'bank', 'steel', 'cement', 'chemicals',
  'international', 'holdings', 'enterprises', 'systems', 'solutions',
  'projects', 'infrastructure', 'infra', 'capital', 'products', 'mills',
  'textiles', 'global', 'india', 'ventures', 'resources',
]);

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Derives the match aliases for a company name: the full name plus, where it
 *  ends in generic words, the distinctive head (kept only if specific enough). */
function aliasesFor(name) {
  const clean = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const out = new Set();
  if (clean.replace(/ /g, '').length >= 4) out.add(clean);

  let words = clean.split(' ').filter(Boolean);
  while (words.length > 1 && GENERIC_SUFFIX.has(words[words.length - 1])) {
    words = words.slice(0, -1);
    const short = words.join(' ');
    if (short.replace(/ /g, '').length >= 5) out.add(short);
  }
  return [...out];
}

/**
 * Builds the company index from ValuePickr posts (anything carrying a
 * topicId + topicTitle). Returns one entry per company with compiled,
 * word-boundary matchers.
 */
export function buildCompanyIndex(posts) {
  const nameByTopic = new Map();
  for (const p of posts) {
    if (p.topicId && p.topicTitle && !nameByTopic.has(p.topicId)) {
      nameByTopic.set(p.topicId, p.topicTitle);
    }
  }

  const index = [];
  for (const [topicId, name] of nameByTopic) {
    const aliases = aliasesFor(name);
    if (aliases.length === 0) continue;
    index.push({
      topicId,
      name,
      matchers: aliases.map((a) => new RegExp(`\\b${escapeRe(a)}\\b`, 'i')),
    });
  }
  return index;
}

/**
 * Tags each post against the company index. A post is emitted once per
 * company it mentions (with that company's topicId/topicTitle); posts
 * mentioning no indexed company are dropped.
 */
export function tagByEntities(posts, index) {
  if (index.length === 0) return [];

  const tagged = [];
  for (const post of posts) {
    const haystack = post.matchText || post.text || '';
    if (!haystack) continue;
    for (const company of index) {
      if (company.matchers.some((re) => re.test(haystack))) {
        tagged.push({ ...post, topicId: company.topicId, topicTitle: company.name });
      }
    }
  }
  return tagged;
}
