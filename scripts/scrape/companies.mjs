/**
 * Company identity — collapses the two sources' raw company labels onto one
 * canonical key per company, so a company discovered by both ValuePickr and
 * Google News becomes a single dashboard card with combined buzz.
 *
 * ValuePickr gives a forum topic title (often with an editorial subtitle);
 * Google News gives a name extracted from a headline. Both are reduced to a
 * slug key; every post is then re-tagged with that key as its topicId so the
 * aggregator groups them together.
 *
 * Two kinds of noise are dropped: ValuePickr threads that are themes rather
 * than companies ("Data Center Value Chain in India"), and companies seen in
 * too few posts to be real.
 *
 * Discovery is done only by ValuePickr and Google News. TradingQnA is
 * enrichment-only — its Q&A titles are too noisy to trust as company names, so
 * a TradingQnA post counts only when its company is already discovered by
 * ValuePickr or Google News; it can never introduce a company on its own.
 */

const MIN_NEWS_HEADLINES = 2;
const DISCOVERY_SOURCES = new Set(['news']); // ValuePickr handled separately

// Words that mark a label as a theme/discussion thread, not a company name:
// phrase/function words a company name never contains, plus topic words.
const NON_COMPANY_WORDS = new Set([
  'in', 'for', 'with', 'to', 'at', 'on', 'the', 'a', 'an', 'why', 'how',
  'what', 'when', 'your', 'you', 'is', 'are', 'chain', 'story', 'stories',
  'theme', 'themes', 'sector', 'sectors', 'space', 'basket', 'idea', 'ideas',
  'opportunity', 'opportunities', 'tracker', 'watchlist', 'primer', 'journey',
  'framework', 'learnings', 'play', 'plays', 'strategy', 'discussion',
  'portfolio',
]);

/** Reduces a ValuePickr topic title to the company name: drops an editorial
 *  subtitle ("X - subtitle", "X: theme") and a trailing Ltd/Limited. */
export function cleanCompanyName(title) {
  let s = String(title || '').trim();
  const cut = s.search(/\s[-–—]\s|:\s|\s\|\s|\s\(/);
  if (cut > 0) s = s.slice(0, cut);
  return s
    .replace(/[?.,!]+$/, '')
    .replace(/[\s,]+(?:ltd\.?|limited)\.?$/i, '')
    .trim();
}

/** Heuristic: true when a name looks like a company, not a theme/topic thread. */
export function isCompanyName(name) {
  const words = String(name || '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0 || words.length > 8) return false;
  return !words.some((w) => NON_COMPANY_WORDS.has(w));
}

/** Canonical slug key for a company name — the merge key shared across sources. */
export function companyKey(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\b(?:ltd\.?|limited)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, '-');
}

/**
 * Re-keys ValuePickr + extracted-name posts onto shared company keys.
 *
 * @param {object[]} vpPosts         ValuePickr posts (carry topicId/topicTitle)
 * @param {object[]} extractedPosts  Google News / TradingQnA posts (carry companyName)
 * @returns {object[]} every kept post, re-tagged with topicId (key) + topicTitle
 */
export function keyPosts(vpPosts, extractedPosts) {
  const displayByKey = new Map(); // key -> canonical display name
  const vpKeys = new Set();

  const vpTagged = [];
  for (const p of vpPosts) {
    const name = cleanCompanyName(p.topicTitle);
    const key = companyKey(name);
    if (!key || !isCompanyName(name)) continue;
    vpKeys.add(key);
    if (!displayByKey.has(key)) displayByKey.set(key, name);
    vpTagged.push({ ...p, topicId: key, topicTitle: displayByKey.get(key) });
  }

  // Group extracted-name posts by key, keeping each post's cleaned name.
  const extractedByKey = new Map();
  for (const p of extractedPosts) {
    const name = cleanCompanyName(p.companyName);
    const key = companyKey(name);
    if (!key || !isCompanyName(name)) continue;
    if (!extractedByKey.has(key)) extractedByKey.set(key, []);
    extractedByKey.get(key).push({ post: p, name });
  }

  const extractedTagged = [];
  for (const [key, entries] of extractedByKey) {
    // A key is real only if a discovery source vouches for it: ValuePickr, or
    // Google News with enough distinct headlines. TradingQnA never qualifies a
    // key — it only rides along on keys the others already discovered.
    const distinctDiscovery = new Set(
      entries.filter((e) => DISCOVERY_SOURCES.has(e.post.source)).map((e) => e.post.id),
    ).size;
    const discovered = vpKeys.has(key) || distinctDiscovery >= MIN_NEWS_HEADLINES;
    if (!discovered) continue;

    if (!displayByKey.has(key)) {
      // No ValuePickr name — use the commonest name from the discovery posts
      // (news names are cleaner than TradingQnA's Q&A-title extractions).
      const named = entries.filter((e) => DISCOVERY_SOURCES.has(e.post.source));
      const freq = new Map();
      for (const e of named) freq.set(e.name, (freq.get(e.name) || 0) + 1);
      displayByKey.set(key, [...freq].sort((a, b) => b[1] - a[1])[0][0]);
    }
    for (const e of entries) {
      extractedTagged.push({ ...e.post, topicId: key, topicTitle: displayByKey.get(key) });
    }
  }

  return [...vpTagged, ...extractedTagged];
}
