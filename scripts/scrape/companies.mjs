/**
 * Company identity — collapses the two sources' raw company labels onto one
 * canonical key per company, so a company discovered by both ValuePickr and
 * Google News becomes a single dashboard card with combined buzz.
 *
 * ValuePickr gives a forum topic title (often with an editorial subtitle);
 * Google News gives a name extracted from a headline. Both are reduced to a
 * slug key; every post is then re-tagged with that key as its topicId so the
 * aggregator groups them together. A news-discovered company seen in only one
 * headline is dropped as likely extraction noise.
 */

const MIN_NEWS_HEADLINES = 2;

/** Reduces a ValuePickr topic title to the company name (drops "X - subtitle"). */
export function cleanCompanyName(title) {
  let s = String(title || '').trim();
  const cut = s.search(/\s[-–—]\s|:\s|\s\|\s|\s\(/);
  if (cut > 0) s = s.slice(0, cut);
  return s.replace(/[?.,!]+$/, '').trim();
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
    if (!key) continue;
    vpKeys.add(key);
    if (!displayByKey.has(key)) displayByKey.set(key, name);
    vpTagged.push({ ...p, topicId: key, topicTitle: displayByKey.get(key) });
  }

  // Group news posts by key.
  const newsByKey = new Map();
  for (const p of newsPosts) {
    const key = companyKey(p.companyName);
    if (!key) continue;
    if (!newsByKey.has(key)) newsByKey.set(key, []);
    newsByKey.get(key).push(p);
  }

  const newsTagged = [];
  for (const [key, posts] of newsByKey) {
    const onValuePickr = vpKeys.has(key);
    const distinctHeadlines = new Set(posts.map((p) => p.id)).size;
    // A news-only company seen just once is almost always extraction noise.
    if (!onValuePickr && distinctHeadlines < MIN_NEWS_HEADLINES) continue;

    if (!displayByKey.has(key)) {
      // No ValuePickr name for this company — use the commonest extracted name.
      const freq = new Map();
      for (const p of posts) freq.set(p.companyName, (freq.get(p.companyName) || 0) + 1);
      displayByKey.set(key, [...freq].sort((a, b) => b[1] - a[1])[0][0]);
    }
    for (const p of posts) {
      newsTagged.push({ ...p, topicId: key, topicTitle: displayByKey.get(key) });
    }
  }

  return [...vpTagged, ...newsTagged];
}
