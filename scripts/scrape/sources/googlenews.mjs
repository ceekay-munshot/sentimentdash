/**
 * Google News source — pulls recent headlines for the companies ValuePickr
 * is discussing, via Google News RSS search (news.google.com/rss/search).
 *
 * No login and no API key. Unlike Reddit and Substack — which block
 * datacenter IPs (GitHub Actions) behind bot-protection — Google News RSS is
 * built to be syndicated to feed readers and serves fine from CI.
 *
 * One search is issued per ValuePickr-discovered company, so every headline
 * is already about a known company: results are tagged with that company's
 * topicId directly, no fuzzy entity matching required.
 */

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/124.0.0.0 Safari/537.36';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Reduces a ValuePickr topic title to the company name: forum titles often
 * carry an editorial subtitle ("Afcom Holdings - Sky High Ambitions...",
 * "X: the theme") — only the head, before the first separator, is the name.
 */
export function cleanCompanyName(title) {
  let s = String(title || '').trim();
  const cut = s.search(/\s[-–—]\s|:\s|\s\|\s|\s\(/);
  if (cut > 0) s = s.slice(0, cut);
  return s.replace(/[?.,!]+$/, '').trim();
}

/** Derives the search term: the cleaned name minus a trailing Ltd/Limited.
 *  Returns null when the result is too short or too long to be a company. */
function queryName(title) {
  const cleaned = cleanCompanyName(title)
    .replace(/\b(?:ltd\.?|limited)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  const words = cleaned.split(' ').filter(Boolean);
  if (cleaned.length < 4 || words.length > 5) return null;
  return cleaned;
}

/** GET text with retry + exponential backoff on rate-limit / transient errors. */
async function fetchText(url) {
  let lastErr;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': UA,
          Accept: 'application/rss+xml, application/xml, text/xml, */*',
        },
      });
      if (res.ok) return await res.text();
      if (res.status === 429 || res.status === 403 || res.status >= 500) {
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

/** Decodes the XML/HTML entities and CDATA wrappers found in RSS feeds. */
function decodeEntities(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#0*39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&hellip;/g, '…')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&'); // last, so a literal &amp; round-trips correctly
}

/** Returns the inner text of the first <name>...</name> element in `block`. */
function tag(block, name) {
  const m = block.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? m[1] : '';
}

/** Reduces an HTML fragment to collapsed plain text. */
function stripHtml(html) {
  return decodeEntities(
    String(html || '')
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

/** Parses one Google News RSS document into normalized posts within the window. */
function parseFeed(xml, windowMs) {
  const cutoff = Date.now() - windowMs;
  const posts = [];

  for (const item of xml.match(/<item\b[\s\S]*?<\/item>/gi) || []) {
    const pubDate = stripHtml(tag(item, 'pubDate'));
    const ts = new Date(pubDate).getTime();
    if (!Number.isFinite(ts) || ts < cutoff) continue;

    const publisher = stripHtml(tag(item, 'source')) || 'Google News';
    const link = stripHtml(tag(item, 'link'));

    // Google News titles read "Headline - Publisher"; drop the publisher tail.
    let headline = stripHtml(tag(item, 'title'));
    if (publisher && headline.endsWith(` - ${publisher}`)) {
      headline = headline.slice(0, -(publisher.length + 3)).trim();
    }
    if (!headline) continue;

    const guid = stripHtml(tag(item, 'guid')).replace(/[^a-z0-9]/gi, '');
    const id = `gn-${guid.slice(-32) || ts}`;

    posts.push({
      source: 'news',
      id,
      author: publisher,
      handle: publisher,
      community: 'Google News',
      timestamp: new Date(ts).toISOString(),
      text: headline,
      url: link,
      likes: 0,
      comments: 0,
    });
  }
  return posts;
}

/**
 * Fetches recent headlines for each ValuePickr-discovered company.
 *
 * @param {{topicId: string, topicTitle: string}[]} companies
 * Returns posts already tagged with topicId/topicTitle, ready for aggregation.
 * A failing search is logged and skipped rather than aborting the run.
 */
export async function fetchGoogleNewsPosts({ companies = [], windowHours = 720, maxCompanies = 250 } = {}) {
  const windowMs = windowHours * 3600 * 1000;

  const all = [];
  const seen = new Set();
  let queried = 0;
  let skipped = 0;

  for (const { topicId, topicTitle } of companies.slice(0, maxCompanies)) {
    const query = queryName(topicTitle);
    if (!query) {
      skipped++;
      continue;
    }
    queried++;

    const url =
      'https://news.google.com/rss/search?q=' +
      encodeURIComponent(`"${query}"`) +
      '&hl=en-IN&gl=IN&ceid=IN:en';
    try {
      const xml = await fetchText(url);
      for (const post of parseFeed(xml, windowMs)) {
        const key = `${post.id}::${topicId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        all.push({ ...post, topicId, topicTitle });
      }
    } catch (err) {
      console.error(`[news] "${query}" failed: ${err.message}`);
    }
    await sleep(800);
  }

  console.log(
    `[news] searched ${queried} companies (${skipped} skipped), ${all.length} tagged headlines`,
  );
  return all;
}
