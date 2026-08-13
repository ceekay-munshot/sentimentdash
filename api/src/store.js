/**
 * Data access for the API.
 *
 * The dashboard reads its JSON straight from the repo on GitHub's raw CDN so
 * the twice-daily scrape shows up without a rebuild; the API reads the exact
 * same files, which keeps the two in lockstep and means the API can be
 * deployed anywhere without a copy of the data.
 *
 * Results are memoised for a short TTL, and concurrent misses share a single
 * upstream request.
 */
import { HttpError, notFound } from './http.js';

export const DEFAULT_DATA_BASE =
  'https://raw.githubusercontent.com/ceekay-munshot/sentimentdash/main/public/data/';

/** Tickers are forum topic slugs; anything else is rejected before it reaches a URL. */
const TICKER_RE = /^[a-z0-9][a-z0-9._-]{0,160}$/i;

/** @param {string} ticker */
export function assertTicker(ticker) {
  if (!TICKER_RE.test(ticker)) {
    throw new HttpError(400, 'invalid_ticker', `\`${ticker}\` is not a valid ticker.`);
  }
  return ticker;
}

/**
 * @param {object} options
 * @param {string} [options.baseUrl]  upstream JSON base (must end with `/`)
 * @param {number} [options.ttlMs]    memoisation window
 * @param {(path: string) => Promise<string|null>} [options.readLocal]
 *        optional local-file reader (Node), used instead of `baseUrl` when set;
 *        returns `null` when the file does not exist.
 */
export function createStore({ baseUrl = DEFAULT_DATA_BASE, ttlMs = 300_000, readLocal = null } = {}) {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  /** @type {Map<string, { expiresAt: number, value: unknown }>} */
  const cache = new Map();
  /** @type {Map<string, Promise<unknown>>} */
  const inflight = new Map();

  async function load(path) {
    if (readLocal) {
      const text = await readLocal(path);
      if (text === null) return null;
      return JSON.parse(text);
    }
    const res = await fetch(`${base}${path}`, {
      headers: { accept: 'application/json' },
      cf: { cacheTtl: Math.round(ttlMs / 1000), cacheEverything: true },
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new HttpError(502, 'upstream_error', `Upstream returned ${res.status} for ${path}.`);
    }
    return res.json();
  }

  /** @param {string} path @returns {Promise<any|null>} */
  function get(path) {
    const now = Date.now();
    const hit = cache.get(path);
    if (hit && hit.expiresAt > now) return Promise.resolve(hit.value);

    const pending = inflight.get(path);
    if (pending) return pending;

    const promise = load(path)
      .then((value) => {
        cache.set(path, { value, expiresAt: Date.now() + ttlMs });
        return value;
      })
      .finally(() => inflight.delete(path));

    inflight.set(path, promise);
    return promise;
  }

  return {
    /** Ranked companies + market mood — the whole home screen. */
    async trending() {
      const data = await get('trending.json');
      if (!data) throw new HttpError(502, 'upstream_error', 'trending.json is unavailable.');
      return data;
    },

    /** Rolling per-run mention counts behind changePct and the sparklines. */
    async history() {
      const data = await get('history.json');
      return data ?? { updatedAt: null, runs: [] };
    },

    /** Posts behind one company; `null` when that company has no posts file. */
    async posts(ticker) {
      assertTicker(ticker);
      return get(`posts/${encodeURIComponent(ticker)}.json`);
    },

    /** Same as `posts` but 404s instead of returning null. */
    async postsOrThrow(ticker) {
      const data = await this.posts(ticker);
      if (!data) throw notFound(`No posts found for \`${ticker}\`.`, 'unknown_ticker');
      return data;
    },

    /** For diagnostics. */
    describe() {
      return { source: readLocal ? 'local' : base, ttlSeconds: Math.round(ttlMs / 1000) };
    },

    clear() {
      cache.clear();
    },
  };
}

/**
 * Runs `worker` over `items` with bounded concurrency — the cross-stock feed
 * fans out over several post files and shouldn't open them all at once.
 *
 * @template T, R
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T) => Promise<R>} worker
 * @returns {Promise<R[]>}
 */
export async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return results;
}
