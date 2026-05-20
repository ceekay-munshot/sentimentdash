/**
 * Reddit source — fetches recent posts from Indian stock-market subreddits via
 * Reddit's public JSON endpoints (no API key required).
 *
 * Returns raw posts in the shared scraper shape; ticker matching and sentiment
 * scoring happen later in the pipeline (aggregate.mjs).
 */

const UA =
  'sentimentdash/0.1 (Indian stock sentiment dashboard; +https://github.com/ceekay-munshot/sentimentdash)';

const DEFAULT_SUBREDDITS = [
  'IndianStockMarket',
  'IndianStreetBets',
  'DalalStreetTalks',
  'IndiaInvestments',
  'StockMarketIndia',
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** GET JSON with retry + exponential backoff on rate-limit / transient errors. */
async function fetchJSON(url) {
  let lastErr;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
      });
      if (res.ok) return await res.json();
      // 403 from Reddit can be transient rate-limiting on datacenter IPs.
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

function normalize(child, subreddit) {
  const d = child.data;
  const author = d.author || '[deleted]';
  let text = String(d.title || '');
  if (d.selftext) text += ` — ${d.selftext}`;
  text = text.replace(/\s+/g, ' ').trim();
  if (text.length > 600) text = `${text.slice(0, 600).trimEnd()}…`;
  return {
    source: 'reddit',
    id: d.id,
    author,
    handle: `u/${author}`,
    community: `r/${subreddit}`,
    timestamp: new Date((d.created_utc || 0) * 1000).toISOString(),
    text,
    url: d.permalink ? `https://www.reddit.com${d.permalink}` : d.url || '',
    likes: typeof d.score === 'number' ? d.score : 0,
    comments: typeof d.num_comments === 'number' ? d.num_comments : 0,
  };
}

/** Pages through r/<subreddit>/new until older than the window or page cap. */
async function fetchSubreddit(subreddit, windowMs, maxPages) {
  const cutoff = Date.now() - windowMs;
  const posts = [];
  let after = null;

  for (let page = 0; page < maxPages; page++) {
    const url =
      `https://www.reddit.com/r/${subreddit}/new.json?limit=100&raw_json=1` +
      (after ? `&after=${after}` : '');
    const data = await fetchJSON(url);
    const children = (data?.data?.children || []).filter((c) => c.kind === 't3');
    if (children.length === 0) break;

    let reachedOlder = false;
    for (const c of children) {
      if (c.data?.stickied) continue;
      const createdMs = (c.data?.created_utc || 0) * 1000;
      if (createdMs < cutoff) {
        reachedOlder = true;
        continue;
      }
      posts.push(normalize(c, subreddit));
    }

    after = data?.data?.after;
    if (!after || reachedOlder) break;
    await sleep(1500);
  }
  return posts;
}

/**
 * Fetches recent posts across the configured subreddits.
 * A failing subreddit is logged and skipped rather than aborting the run.
 */
export async function fetchRedditPosts({
  subreddits = DEFAULT_SUBREDDITS,
  windowHours = 24,
  maxPagesPerSub = 4,
} = {}) {
  const windowMs = windowHours * 3600 * 1000;
  const all = [];

  for (const sub of subreddits) {
    try {
      const posts = await fetchSubreddit(sub, windowMs, maxPagesPerSub);
      console.log(`[reddit] r/${sub}: ${posts.length} posts`);
      all.push(...posts);
    } catch (err) {
      console.error(`[reddit] r/${sub} failed: ${err.message}`);
    }
    await sleep(1500);
  }

  // De-dupe by post id (crossposts can surface the same content twice).
  const seen = new Set();
  return all.filter((p) => p.id && !seen.has(p.id) && seen.add(p.id));
}
