/**
 * Google News source — pulls recent India-markets headlines from Google
 * News RSS search (news.google.com/rss/search).
 *
 * No login and no API key. Unlike Reddit and Substack — which block
 * datacenter IPs (GitHub Actions) behind bot-protection — Google News RSS is
 * built to be syndicated to feed readers and serves fine from CI.
 *
 * Headlines are free-text with no per-company structure, so these posts carry
 * NO topicId/topicTitle. entities.mjs tags them against the companies
 * ValuePickr is discussing before they reach the aggregator.
 */

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/124.0.0.0 Safari/537.36';

// Broad India-markets searches that surface company-named headlines. The
// entity tagger decides which ValuePickr companies each headline is about.
const DEFAULT_QUERIES = [
  'share price target',
  'stock to buy India',
  'Q4 results India',
  'stock surges OR stock jumps India',
  'stock falls OR stock slumps India',
  'brokerage rating India',
  'multibagger stock',
  'Sensex Nifty stocks',
];

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
      // Scanned by entities.mjs for company mentions (headline is the content).
      matchText: headline,
      url: link,
      likes: 0,
      comments: 0,
    });
  }
  return posts;
}

/**
 * Fetches recent India-markets headlines across the configured searches.
 * A failing query is logged and skipped rather than aborting the run.
 */
export async function fetchGoogleNewsPosts({ queries = DEFAULT_QUERIES, windowHours = 720 } = {}) {
  const windowMs = windowHours * 3600 * 1000;

  const all = [];
  for (const query of queries) {
    const url =
      'https://news.google.com/rss/search?q=' +
      encodeURIComponent(query) +
      '&hl=en-IN&gl=IN&ceid=IN:en';
    try {
      const xml = await fetchText(url);
      const posts = parseFeed(xml, windowMs);
      console.log(`[news] "${query}": ${posts.length} headlines`);
      all.push(...posts);
    } catch (err) {
      console.error(`[news] "${query}" failed: ${err.message}`);
    }
    await sleep(1000);
  }

  const seen = new Set();
  return all.filter((p) => p.id && !seen.has(p.id) && seen.add(p.id));
}
