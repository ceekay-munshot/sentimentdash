/**
 * Substack source — pulls recent posts from a curated set of India-markets
 * Substack newsletters via their public RSS feeds (<name>.substack.com/feed).
 *
 * No login and no API key. Substack sits behind Cloudflare, so requests send a
 * browser-like User-Agent; RSS feeds are meant to be syndicated and serve fine
 * from CI with that header (unlike Reddit, which blocks datacenter IPs).
 *
 * Substack articles are free-text with no per-company structure, so these
 * posts carry NO topicId/topicTitle. entities.mjs tags them against the
 * companies ValuePickr is discussing before they reach the aggregator.
 */

// A real browser UA — Substack's Cloudflare layer rejects non-browser agents.
const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/124.0.0.0 Safari/537.36';

// India equity / markets newsletters with meaningful reach and regular posts.
const DEFAULT_FEEDS = [
  'https://investkaroindia.substack.com/feed',
  'https://deepdivecaps.substack.com/feed',
  'https://aftermarketreport.substack.com/feed',
  'https://indexheads.substack.com/feed',
  'https://monsoonpabrai.substack.com/feed',
  'https://indianstockscommunity.substack.com/feed',
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
      .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

/** Parses one Substack RSS document into normalized posts within the window. */
function parseFeed(xml, windowMs, host) {
  const cutoff = Date.now() - windowMs;
  const head = xml.split(/<item[\s>]/i)[0];
  const channelTitle = stripHtml(tag(head, 'title')) || host;

  const posts = [];
  for (const item of xml.match(/<item\b[\s\S]*?<\/item>/gi) || []) {
    const pubDate = stripHtml(tag(item, 'pubDate'));
    const ts = new Date(pubDate).getTime();
    if (!Number.isFinite(ts) || ts < cutoff) continue;

    const title = stripHtml(tag(item, 'title'));
    const link = stripHtml(tag(item, 'link'));
    const author = stripHtml(tag(item, 'dc:creator')) || channelTitle;
    const bodyHtml = tag(item, 'content:encoded') || tag(item, 'description');
    const fullText = `${title}. ${stripHtml(bodyHtml)}`.trim();

    const slug = (link.match(/\/p\/([a-z0-9-]+)/i) || [])[1];
    const guid = stripHtml(tag(item, 'guid')).replace(/[^a-z0-9]/gi, '');
    const id = `${host}-${slug || guid.slice(-24) || ts}`;

    let text = fullText;
    if (text.length > 600) text = `${text.slice(0, 600).trimEnd()}…`;

    posts.push({
      source: 'substack',
      id,
      author,
      handle: `@${host}`,
      community: channelTitle,
      timestamp: new Date(ts).toISOString(),
      text: text || '(no preview)',
      // Full article text, scanned by entities.mjs for company mentions.
      matchText: fullText.slice(0, 8000),
      url: link,
      likes: 0,
      comments: 0,
    });
  }
  return { channelTitle, posts };
}

/**
 * Fetches recent posts across the configured Substack feeds.
 * A failing feed is logged and skipped rather than aborting the run.
 */
export async function fetchSubstackPosts({ feeds = DEFAULT_FEEDS, windowHours = 720 } = {}) {
  const windowMs = windowHours * 3600 * 1000;

  const all = [];
  for (const feed of feeds) {
    const host = (() => {
      try {
        return new URL(feed).hostname.split('.')[0];
      } catch {
        return 'substack';
      }
    })();
    try {
      const xml = await fetchText(feed);
      const { channelTitle, posts } = parseFeed(xml, windowMs, host);
      console.log(`[substack] ${channelTitle}: ${posts.length} posts`);
      all.push(...posts);
    } catch (err) {
      console.error(`[substack] ${feed} failed: ${err.message}`);
    }
    await sleep(1000);
  }

  const seen = new Set();
  return all.filter((p) => p.id && !seen.has(p.id) && seen.add(p.id));
}
