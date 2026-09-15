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

import { readSource } from './transport.mjs';

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

// Capitalised words that are not company names (headline/sentence words,
// months, weekdays, and finance jargon that recurs in headlines).
const CAPS_STOP = new Set(
  (
    'the a an this that these those why how what when where who whom should ' +
    'could would is are was were will shall can do does did has have had here ' +
    'there now new news top best worst big small after before as at in on for ' +
    'with and or but if to of from by up down over under amid vs buy sell hold ' +
    'results result earnings profit loss revenue update updates live target ' +
    'price stock stocks share shares my your you it its he she they we ' +
    'january february march april may june july august september october ' +
    'november december jan feb mar apr jun jul aug sep sept oct nov dec ' +
    'monday tuesday wednesday thursday friday saturday sunday ' +
    'multibagger multibaggers penny smallcap midcap largecap bluechip ' +
    'bonus dividend watch watchlist focus gainers losers gainer loser ' +
    'breakout potential rally surge target alert pick picks momentum ' +
    'outperformer outperformers ' +
    'zerodha kite console coin varsity smallcase sensibull streak demat ' +
    'kyc pan itr stt ltcg stcg otp nfo etf amc sip nri'
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
function parseFeed(xml, windowMs, nowMs = Date.now()) {
  if (!/<rss[\s>]/i.test(xml) || !/<channel[\s>]/i.test(xml)) throw new Error('News search returned invalid RSS');
  const cutoff = nowMs - windowMs;
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
export async function collectGoogleNews({ queries = DISCOVERY_QUERIES, windowHours = 720, previous = {}, now = new Date(), read = readSource, pause = sleep } = {}) {
  if (Date.parse(previous.retryAt || '') > now.getTime()) return { posts: [], state: { ...previous, state: 'cooldown' } };
  const all = new Map(), checks = [];
  let retryAt = null;
  for (const query of queries) {
    try {
      const url = 'https://news.google.com/rss/search?q=' + encodeURIComponent(query) + '&hl=en-IN&gl=IN&ceid=IN:en';
      const posts = parseFeed(await read(url, { type: 'text' }), windowHours * 3600000, now.getTime());
      for (const post of posts) all.set(post.id, post);
      checks.push({ query, ok: true, posts: posts.length });
    } catch (error) {
      checks.push({ query, ok: false, error: error.message });
      if (error.retryAt) { retryAt = error.retryAt; break; }
    }
    await pause(800);
  }
  const complete = checks.length === queries.length && checks.every(check => check.ok);
  return { posts: [...all.values()], state: { state: complete ? 'ok' : 'partial',
    lastAttemptAt: now.toISOString(), lastSuccessAt: complete ? now.toISOString() : previous.lastSuccessAt || null,
    retryAt, queries: checks, queriesExpected: queries.length, discoveryOnly: true,
    error: complete ? null : 'Some news searches were not checked',
    limitation: 'Broad RSS discovery searches are bounded by the provider; they do not verify every company or every headline.' } };
}
export async function fetchGoogleNewsPosts(options = {}) { return (await collectGoogleNews(options)).posts; }
