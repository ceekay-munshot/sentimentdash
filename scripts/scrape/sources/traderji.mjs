/**
 * Traderji source — discovers companies from the Traderji investor forum
 * (traderji.com, a XenForo forum) via its RSS feed of latest threads.
 *
 * No login and no API key. Whether a XenForo forum serves RSS to a datacenter
 * IP (GitHub Actions) is not guaranteed — a failing fetch is caught upstream
 * so the run continues on the other sources.
 *
 * Thread titles on a trading forum usually name the stock ("Suzlon Energy",
 * "Tata Motors long term"), so the company is extracted from the title with
 * the same heuristic Google News headlines use. Posts carry that as
 * `companyName`; companies.mjs keys them.
 */
import { extractCompany } from './googlenews.mjs';

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/124.0.0.0 Safari/537.36';

const FEED_URL = 'https://www.traderji.com/forums/-/index.rss';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

/** Parses the Traderji RSS document into posts that name an extractable company. */
function parseFeed(xml, windowMs) {
  const cutoff = Date.now() - windowMs;
  const posts = [];

  for (const item of xml.match(/<item\b[\s\S]*?<\/item>/gi) || []) {
    const pubDate = stripHtml(tag(item, 'pubDate'));
    const ts = new Date(pubDate).getTime();
    if (!Number.isFinite(ts) || ts < cutoff) continue;

    const title = stripHtml(tag(item, 'title'));
    const companyName = extractCompany(title);
    if (!title || !companyName) continue;

    const link = stripHtml(tag(item, 'link'));
    const author = stripHtml(tag(item, 'dc:creator')) || stripHtml(tag(item, 'author')) || 'Traderji';
    const body = stripHtml(tag(item, 'content:encoded') || tag(item, 'description'));

    let text = body ? `${title} — ${body}` : title;
    if (text.length > 600) text = `${text.slice(0, 600).trimEnd()}…`;

    const id = `tj-${(link.match(/\.(\d+)\/?$/) || [])[1] || ts}`;

    posts.push({
      source: 'traderji',
      id,
      author,
      handle: author,
      community: 'Traderji',
      timestamp: new Date(ts).toISOString(),
      text,
      url: link,
      likes: 0,
      comments: 0,
      companyName,
    });
  }
  return posts;
}

/**
 * Fetches recent Traderji threads, each carrying the company name extracted
 * from its title. Returns [] on failure rather than throwing.
 */
export async function fetchTraderjiPosts({ windowHours = 720 } = {}) {
  const windowMs = windowHours * 3600 * 1000;

  const xml = await fetchText(FEED_URL);
  const posts = parseFeed(xml, windowMs);

  const seen = new Set();
  const deduped = posts.filter((p) => p.id && !seen.has(p.id) && seen.add(p.id));
  console.log(`[traderji] ${deduped.length} threads with a company`);
  return deduped;
}
