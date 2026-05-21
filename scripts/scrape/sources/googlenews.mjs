/**
 * Google News source — discovers which companies are most in the headlines.
 *
 * No login and no API key. Unlike Reddit and Substack — which block datacenter
 * IPs (GitHub Actions) behind bot-protection — Google News RSS is built to be
 * syndicated and serves fine from CI.
 *
 * This is a discovery source, a peer to ValuePickr (not a per-company lookup):
 * it runs broad India-markets searches, then extracts the company name from
 * each headline. Indian financial headlines almost always lead with the
 * company ("Tata Motors shares jump..."), so the leading proper-noun phrase is
 * the company. Posts carry that as `companyName`; companies.mjs keys them.
 */

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/124.0.0.0 Safari/537.36';

// Broad searches — the goal is volume of company-led headlines, not precision.
const DISCOVERY_QUERIES = [
  'stock',
  'shares',
  'share price target',
  'Q4 results',
  'stock surges OR stock jumps',
  'stock falls OR stock slumps',
  'multibagger stocks',
  'stocks to buy',
];

// Capitalised words that are not company names (headline/sentence words).
const CAPS_STOP = new Set(
  (
    'the a an this that these those why how what when where who whom should ' +
    'could would is are was were will shall can do does did has have had here ' +
    'there now new news top best worst big small after before as at in on for ' +
    'with and or but if to of from by up down over under amid vs buy sell hold ' +
    'results result earnings profit loss revenue update updates live target ' +
    'price stock stocks share shares my your you it its he she they we'
  ).split(' '),
);

// Index / macro / sector terms that look like names but are not companies.
const MACRO = new Set([
  'sensex', 'nifty', 'nifty 50', 'bank nifty', 'gift nifty', 'dalal street',
  'wall street', 'budget', 'union budget', 'rbi', 'sebi', 'nse', 'bse', 'gst',
  'sip', 'market', 'markets', 'stock market', 'share market', 'ipo', 'fii',
  'dii', 'fpi', 'gdp', 'it stocks', 'psu', 'psu banks', 'bank stocks',
  'auto stocks', 'pharma stocks', 'metal stocks', 'india', 'indian', 'gold',
  'silver', 'crude oil', 'rupee', 'dollar', 'asian markets', 'us markets',
]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Strips surrounding punctuation from a headline token. */
function cleanToken(w) {
  return w.replace(/^[^A-Za-z0-9]+/, '').replace(/[^A-Za-z0-9.&]+$/, '');
}

/** True when a token can be part of a company name (Title-case / acronym). */
function isNameToken(w) {
  if (!w) return false;
  if (/^(?:q[1-4]|fy\d*|h[12]|\d{4})$/i.test(w)) return false;
  if (CAPS_STOP.has(w.toLowerCase())) return false;
  return (
    /^[A-Z][A-Za-z.&'-]*$/.test(w) || // Title-case word
    /^[A-Z]{2,6}$/.test(w) || //         all-caps acronym (RIL, ITC, HDFC)
    /^[0-9]+[A-Z][A-Za-z]*$/.test(w) //  digit-led name (3M, 5Paisa)
  );
}

/**
 * Extracts the company name from a headline: the earliest run of consecutive
 * name-like tokens that is not an index/macro term. Returns null when none.
 */
export function extractCompany(headline) {
  const toks = String(headline || '')
    .split(/\s+/)
    .map(cleanToken);

  let i = 0;
  while (i < toks.length) {
    if (!isNameToken(toks[i])) {
      i++;
      continue;
    }
    let j = i;
    const run = [];
    while (j < toks.length && isNameToken(toks[j])) {
      run.push(toks[j]);
      j++;
    }
    const candidate = run.join(' ').trim();
    const isMacro =
      MACRO.has(candidate.toLowerCase()) ||
      run.every((w) => MACRO.has(w.toLowerCase()));
    if (run.length <= 5 && candidate.replace(/[^A-Za-z0-9]/g, '').length >= 3 && !isMacro) {
      return candidate;
    }
    i = j;
  }
  return null;
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

/** Parses a Google News RSS document into posts that name an extractable company. */
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
    const companyName = extractCompany(headline);
    if (!headline || !companyName) continue;

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
      companyName,
    });
  }
  return posts;
}

/**
 * Runs the broad discovery searches and returns headline posts, each carrying
 * the company name extracted from its headline. A failing search is logged
 * and skipped rather than aborting the run.
 */
export async function fetchGoogleNewsPosts({ queries = DISCOVERY_QUERIES, windowHours = 720 } = {}) {
  const windowMs = windowHours * 3600 * 1000;

  const all = [];
  const seen = new Set();
  for (const query of queries) {
    const url =
      'https://news.google.com/rss/search?q=' +
      encodeURIComponent(query) +
      '&hl=en-IN&gl=IN&ceid=IN:en';
    try {
      const posts = parseFeed(await fetchText(url), windowMs);
      let added = 0;
      for (const post of posts) {
        if (seen.has(post.id)) continue;
        seen.add(post.id);
        all.push(post);
        added++;
      }
      console.log(`[news] "${query}": ${posts.length} headlines with a company (${added} new)`);
    } catch (err) {
      console.error(`[news] "${query}" failed: ${err.message}`);
    }
    await sleep(800);
  }

  console.log(`[news] ${all.length} unique company headlines`);
  return all;
}
