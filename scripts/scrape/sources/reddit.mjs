/**
 * Reddit source — fetches recent posts from Indian stock-market subreddits.
 *
 * Reddit blocks anonymous JSON requests from datacenter IP ranges (such as
 * GitHub Actions runners), so this prefers Reddit's OAuth API: when
 * REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET are set it requests an app-only
 * token (client_credentials grant) and reads from oauth.reddit.com. With no
 * credentials it falls back to the public *.json endpoints — fine for local
 * runs, but expect HTTP 403 from CI.
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

/**
 * Requests an app-only OAuth token (client_credentials grant).
 * Returns null when no credentials are configured; throws if a configured
 * credential pair fails, so misconfiguration surfaces loudly.
 */
async function getAccessToken() {
  const id = process.env.REDDIT_CLIENT_ID;
  const secret = process.env.REDDIT_CLIENT_SECRET;
  if (!id || !secret) return null;

  const basic = Buffer.from(`${id}:${secret}`).toString('base64');
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch('https://www.reddit.com/api/v1/access_token', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basic}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': UA,
        },
        body: 'grant_type=client_credentials',
      });
      if (res.ok) {
        const data = await res.json();
        if (data.access_token) return data.access_token;
        throw new Error('response had no access_token');
      }
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastErr = err;
    }
    if (attempt < 3) await sleep(2 ** attempt * 1000);
  }
  throw new Error(`Reddit OAuth token request failed: ${lastErr?.message}`);
}

/** GET JSON with retry + exponential backoff on rate-limit / transient errors. */
async function fetchJSON(url, headers) {
  let lastErr;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, { headers });
      if (res.ok) return await res.json();
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
async function fetchSubreddit(client, subreddit, windowMs, maxPages) {
  const cutoff = Date.now() - windowMs;
  const posts = [];
  let after = null;

  for (let page = 0; page < maxPages; page++) {
    const url =
      `${client.base}/r/${subreddit}/new${client.suffix}?limit=100&raw_json=1` +
      (after ? `&after=${after}` : '');
    const data = await fetchJSON(url, client.headers);
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

  const token = await getAccessToken();
  const client = token
    ? {
        base: 'https://oauth.reddit.com',
        suffix: '',
        headers: { Authorization: `Bearer ${token}`, 'User-Agent': UA, Accept: 'application/json' },
      }
    : {
        base: 'https://www.reddit.com',
        suffix: '.json',
        headers: { 'User-Agent': UA, Accept: 'application/json' },
      };
  console.log(`[reddit] mode: ${token ? 'OAuth (app-only)' : 'anonymous JSON endpoints'}`);

  const all = [];
  for (const sub of subreddits) {
    try {
      const posts = await fetchSubreddit(client, sub, windowMs, maxPagesPerSub);
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
