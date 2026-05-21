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
 * than companies ("Data Center Value Chain in India"), and news-discovered
 * companies seen in only one headline (likely extraction noise).
 */

const MIN_NEWS_HEADLINES = 2;

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
 * Re-keys ValuePickr + Google News posts onto shared company keys.
 *
 * @param {object[]} vpPosts    ValuePickr posts (carry topicId/topicTitle)
 * @param {object[]} newsPosts  Google News posts (carry companyName)
 * @returns {object[]} every kept post, re-tagged with topicId (key) + topicTitle
 */
export function keyPosts(vpPosts, newsPosts) {
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

  // Group news posts by key, keeping each post's cleaned company name.
  const newsByKey = new Map();
  for (const p of newsPosts) {
    const name = cleanCompanyName(p.companyName);
    const key = companyKey(name);
    if (!key || !isCompanyName(name)) continue;
    if (!newsByKey.has(key)) newsByKey.set(key, []);
    newsByKey.get(key).push({ post: p, name });
  }

  const newsTagged = [];
  for (const [key, entries] of newsByKey) {
    const onValuePickr = vpKeys.has(key);
    const distinctHeadlines = new Set(entries.map((e) => e.post.id)).size;
    // A news-only company seen just once is almost always extraction noise.
    if (!onValuePickr && distinctHeadlines < MIN_NEWS_HEADLINES) continue;

    if (!displayByKey.has(key)) {
      // No ValuePickr name for this company — use the commonest extracted name.
      const freq = new Map();
      for (const e of entries) freq.set(e.name, (freq.get(e.name) || 0) + 1);
      displayByKey.set(key, [...freq].sort((a, b) => b[1] - a[1])[0][0]);
    }
    for (const e of entries) {
      newsTagged.push({ ...e.post, topicId: key, topicTitle: displayByKey.get(key) });
    }
  }

  return [...vpTagged, ...newsTagged];
}
