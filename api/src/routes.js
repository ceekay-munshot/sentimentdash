/**
 * The endpoint surface. Everything the SentimentDash dashboard renders is
 * reachable here; nothing in the dashboard is changed to support it.
 */
import {
  MOOD_THRESHOLDS,
  SENTIMENT_META,
  SENTIMENT_ORDER,
  SORTS,
  SOURCE_FILTERS,
  SOURCE_META,
  SOURCE_ORDER,
  moodLabel,
} from './meta.js';
import {
  badRequest,
  boolParam,
  enumParam,
  intParam,
  notFound,
  stringParam,
} from './http.js';
import { openapiDocument } from './openapi.js';
import { assertTicker, mapLimit } from './store.js';
import {
  POST_SORT_KEYS,
  STOCK_SORT_KEYS,
  buildOverview,
  countPosts,
  enrichPost,
  enrichStock,
  filterPosts,
  filterStocks,
  paginate,
  stockFromPosts,
} from './transform.js';

export const API_VERSION = 'v1';

const SOURCE_KEYS = ['all', ...SOURCE_ORDER];
const SENTIMENT_KEYS = ['all', ...SENTIMENT_ORDER];

/** Shared query parsing for the stock list. */
function stockQuery(url, { defaultLimit = 100, maxLimit = 1000 } = {}) {
  return {
    q: stringParam(url, 'q'),
    source: enumParam(url, 'source', SOURCE_KEYS, 'all'),
    sentiment: enumParam(url, 'sentiment', SENTIMENT_KEYS, 'all'),
    minMentions: intParam(url, 'minMentions', 0, { min: 0, max: 100_000 }),
    sort: enumParam(url, 'sort', STOCK_SORT_KEYS, 'trending'),
    order: enumParam(url, 'order', ['default', 'asc', 'desc'], 'default'),
    limit: intParam(url, 'limit', defaultLimit, { min: 1, max: maxLimit }),
    offset: intParam(url, 'offset', 0, { min: 0, max: 1_000_000 }),
  };
}

function listStocks(trending, url, options) {
  const query = stockQuery(url, options);
  const filtered = filterStocks(trending.stocks ?? [], query);
  const { page, pagination } = paginate(filtered, query.limit, query.offset);
  return { query, page, pagination };
}

/* -------------------------------- handlers -------------------------------- */

const handlers = {
  /** Self-describing index, so a consumer can discover the surface. */
  index: async ({ link, store }) => ({
    name: 'sentimentdash-api',
    version: API_VERSION,
    description:
      'Read-only JSON API exposing everything the SentimentDash dashboard shows: ' +
      'trending companies, market mood, per-company sentiment, source breakdowns, ' +
      'the posts behind each company, and the run history behind the sparklines.',
    data: store.describe(),
    endpoints: [
      { method: 'GET', path: link('/health'), summary: 'Liveness plus upstream freshness.' },
      { method: 'GET', path: link('/meta'), summary: 'Sources, sentiments, sorts, filters, colours.' },
      { method: 'GET', path: link('/overview'), summary: 'The four stat cards and market mood.' },
      { method: 'GET', path: link('/dashboard'), summary: 'Overview + full stock list in one call.' },
      { method: 'GET', path: link('/stocks'), summary: 'Trending companies (search/filter/sort/paginate).' },
      { method: 'GET', path: link('/stocks/{ticker}'), summary: 'One company, with optional posts.' },
      { method: 'GET', path: link('/stocks/{ticker}/posts'), summary: 'The conversation behind a company.' },
      { method: 'GET', path: link('/posts'), summary: 'Cross-company post feed.' },
      { method: 'GET', path: link('/history'), summary: 'Per-run totals and market mood over time.' },
      { method: 'GET', path: link('/history/{ticker}'), summary: 'Mention series behind one sparkline.' },
      { method: 'GET', path: link('/openapi.json'), summary: 'OpenAPI 3.1 description.' },
    ],
  }),

  health: async ({ store }) => {
    const startedAt = Date.now();
    const trending = await store.trending();
    const generatedAt = trending.generatedAt ?? null;
    const ageSeconds = generatedAt
      ? Math.max(0, Math.round((Date.now() - new Date(generatedAt).getTime()) / 1000))
      : null;
    return {
      status: 'ok',
      version: API_VERSION,
      data: {
        ...store.describe(),
        generatedAt,
        ageSeconds,
        window: trending.window ?? null,
        totalPosts: trending.totalPosts ?? 0,
        totalStocks: trending.totalStocks ?? 0,
      },
      upstreamLatencyMs: Date.now() - startedAt,
    };
  },

  meta: async ({ store }) => {
    const trending = await store.trending();
    return {
      generatedAt: trending.generatedAt,
      window: trending.window,
      totalPosts: trending.totalPosts ?? 0,
      totalStocks: trending.totalStocks ?? 0,
      sources: SOURCE_ORDER.map((key) => ({ key, ...SOURCE_META[key] })),
      sentiments: SENTIMENT_ORDER.map((key) => ({ key, ...SENTIMENT_META[key] })),
      /** Score cut-offs used to turn a net sentiment score into a label. */
      moodThresholds: MOOD_THRESHOLDS,
      /** Sort + filter chips the dashboard itself offers. */
      sorts: SORTS,
      sourceFilters: SOURCE_FILTERS,
      /** Everything this API additionally accepts. */
      supported: {
        stockSorts: STOCK_SORT_KEYS,
        postSorts: POST_SORT_KEYS,
        sourceKeys: SOURCE_KEYS,
        sentimentKeys: SENTIMENT_KEYS,
      },
    };
  },

  overview: async ({ store }) => buildOverview(await store.trending()),

  /** One call for a full dashboard render. */
  dashboard: async ({ store, url, link }) => {
    const trending = await store.trending();
    const { query, page, pagination } = listStocks(trending, url, {
      defaultLimit: 500,
      maxLimit: 1000,
    });
    return {
      generatedAt: trending.generatedAt,
      window: trending.window,
      overview: buildOverview(trending),
      filters: query,
      pagination,
      stocks: page.map((s) => enrichStock(s, link)),
    };
  },

  stocks: async ({ store, url, link }) => {
    const trending = await store.trending();
    const { query, page, pagination } = listStocks(trending, url);
    return {
      generatedAt: trending.generatedAt,
      window: trending.window,
      filters: query,
      pagination,
      stocks: page.map((s) => enrichStock(s, link)),
    };
  },

  stock: async ({ store, url, link, params }) => {
    const ticker = assertTicker(params.ticker);
    const [trending, postsFile] = await Promise.all([
      store.trending(),
      store.posts(ticker).catch(() => null),
    ]);

    const listed = (trending.stocks ?? []).find((s) => s.ticker === ticker) ?? null;
    if (!listed && !postsFile) {
      throw notFound(`No company found for \`${ticker}\`.`, 'unknown_ticker');
    }

    // Mirrors StockDetail.tsx: fall back to numbers derived from the posts file
    // for a company that has dropped out of the trending list.
    const base = listed ?? stockFromPosts(postsFile);
    const posts = postsFile?.posts ?? [];

    const body = {
      generatedAt: trending.generatedAt,
      window: trending.window,
      inTrending: Boolean(listed),
      derivedFromPosts: !listed,
      stock: enrichStock(base, link),
      counts: countPosts(posts),
      postsGeneratedAt: postsFile?.generatedAt ?? null,
    };

    if (boolParam(url, 'includePosts')) {
      const query = {
        source: enumParam(url, 'source', SOURCE_KEYS, 'all'),
        sentiment: enumParam(url, 'sentiment', SENTIMENT_KEYS, 'all'),
        q: stringParam(url, 'postQuery'),
        sort: enumParam(url, 'postSort', POST_SORT_KEYS, 'newest'),
      };
      const filtered = filterPosts(posts, query);
      const { page, pagination } = paginate(
        filtered,
        intParam(url, 'postLimit', 100, { min: 1, max: 1000 }),
        intParam(url, 'postOffset', 0, { min: 0, max: 1_000_000 }),
      );
      body.postFilters = query;
      body.postPagination = pagination;
      body.posts = page.map((p) => enrichPost(p, ticker));
    }

    return body;
  },

  stockPosts: async ({ store, url, params }) => {
    const ticker = assertTicker(params.ticker);
    const file = await store.postsOrThrow(ticker);
    const all = file.posts ?? [];

    const query = {
      source: enumParam(url, 'source', SOURCE_KEYS, 'all'),
      sentiment: enumParam(url, 'sentiment', SENTIMENT_KEYS, 'all'),
      q: stringParam(url, 'q'),
      sort: enumParam(url, 'sort', POST_SORT_KEYS, 'newest'),
      limit: intParam(url, 'limit', 100, { min: 1, max: 1000 }),
      offset: intParam(url, 'offset', 0, { min: 0, max: 1_000_000 }),
    };

    const filtered = filterPosts(all, query);
    const { page, pagination } = paginate(filtered, query.limit, query.offset);

    return {
      ticker: file.ticker,
      name: file.name,
      exchange: file.exchange ?? '',
      sector: file.sector ?? '',
      generatedAt: file.generatedAt,
      counts: { ...countPosts(all), filtered: filtered.length },
      filters: query,
      pagination,
      posts: page.map((p) => enrichPost(p, file.ticker)),
    };
  },

  /**
   * Cross-company feed. Defaults to the top trending companies so a consumer
   * can render "latest chatter" without knowing any tickers up front.
   */
  posts: async ({ store, url }) => {
    const requested = stringParam(url, 'tickers');
    const fromTop = intParam(url, 'stocks', 10, { min: 1, max: 25 });

    let tickers;
    if (requested) {
      tickers = requested
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
        .map(assertTicker);
      if (tickers.length === 0) throw badRequest('`tickers` was empty.', 'invalid_param');
      if (tickers.length > 25) {
        throw badRequest('`tickers` accepts at most 25 tickers.', 'invalid_param');
      }
    } else {
      const trending = await store.trending();
      tickers = filterStocks(trending.stocks ?? [], {
        source: enumParam(url, 'source', SOURCE_KEYS, 'all'),
        sort: enumParam(url, 'stockSort', STOCK_SORT_KEYS, 'trending'),
      })
        .slice(0, fromTop)
        .map((s) => s.ticker);
    }

    const files = await mapLimit(tickers, 6, (ticker) =>
      store.posts(ticker).catch(() => null),
    );

    const query = {
      source: enumParam(url, 'source', SOURCE_KEYS, 'all'),
      sentiment: enumParam(url, 'sentiment', SENTIMENT_KEYS, 'all'),
      q: stringParam(url, 'q'),
      sort: enumParam(url, 'sort', POST_SORT_KEYS, 'newest'),
      limit: intParam(url, 'limit', 50, { min: 1, max: 500 }),
      offset: intParam(url, 'offset', 0, { min: 0, max: 100_000 }),
    };

    const merged = [];
    const missing = [];
    files.forEach((file, i) => {
      if (!file) {
        missing.push(tickers[i]);
        return;
      }
      for (const post of file.posts ?? []) merged.push(enrichPost(post, file.ticker));
    });

    const filtered = filterPosts(merged, query);
    const { page, pagination } = paginate(filtered, query.limit, query.offset);

    return {
      tickers,
      missing,
      filters: query,
      counts: { ...countPosts(merged), filtered: filtered.length },
      pagination,
      posts: page,
    };
  },

  history: async ({ store, url }) => {
    const history = await store.history();
    const runs = history.runs ?? [];
    const limit = intParam(url, 'limit', runs.length || 1, { min: 1, max: 500 });
    const includeCounts = boolParam(url, 'includeCounts');

    const selected = runs.slice(-limit).map((run) => {
      const mood = run.mood ?? null;
      return {
        at: run.at,
        totalPosts: run.totalPosts ?? 0,
        marketMood: mood
          ? {
              bullish: mood.bullish ?? 0,
              bearish: mood.bearish ?? 0,
              neutral: mood.neutral ?? 0,
              score: mood.score ?? 0,
              label: moodLabel(mood.score ?? 0),
            }
          : null,
        trackedStocks: Object.keys(run.counts ?? {}).length,
        ...(includeCounts ? { counts: run.counts ?? {} } : null),
      };
    });

    return {
      updatedAt: history.updatedAt ?? null,
      runs: selected,
      count: selected.length,
      totalRuns: runs.length,
    };
  },

  tickerHistory: async ({ store, params }) => {
    const ticker = assertTicker(params.ticker);
    const [history, trending] = await Promise.all([store.history(), store.trending()]);
    const runs = history.runs ?? [];
    const points = runs.map((run) => ({ at: run.at, mentions: run.counts?.[ticker] ?? 0 }));
    const seen = points.some((p) => p.mentions > 0);
    const listed = (trending.stocks ?? []).find((s) => s.ticker === ticker) ?? null;

    if (!seen && !listed) {
      throw notFound(`No history found for \`${ticker}\`.`, 'unknown_ticker');
    }

    const latest = listed?.mentions ?? points.at(-1)?.mentions ?? 0;
    const previous = listed?.mentionsPrev ?? points.at(-2)?.mentions ?? 0;

    return {
      ticker,
      name: listed?.name ?? ticker,
      updatedAt: history.updatedAt ?? null,
      latest,
      previous,
      changePct:
        listed?.changePct ??
        (previous > 0 ? Number((((latest - previous) / previous) * 100).toFixed(1)) : 0),
      /** The exact series the dashboard draws in the row/detail sparkline. */
      sparkline: listed?.sparkline ?? points.map((p) => p.mentions),
      points,
    };
  },

  openapi: async ({ link }) => openapiDocument(link('')),
};

/** Per-handler `Cache-Control: max-age`. Health should never be cached. */
handlers.health.cacheSeconds = 0;
handlers.index.cacheSeconds = 300;
handlers.meta.cacheSeconds = 300;
handlers.openapi.cacheSeconds = 3600;

/* --------------------------------- routing -------------------------------- */

/** `decodeURIComponent` that tolerates a malformed escape rather than throwing. */
function safeDecode(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * Resolves a request path to a handler. The `/api` and `/v1` prefixes are both
 * optional, so the same worker serves `/v1/stocks`, `/api/v1/stocks` and
 * `/stocks` — whichever base path the consumer mounts it under.
 *
 * @param {string} pathname
 * @returns {{ handler: Function, params: Record<string, string>, prefix: string } | null}
 */
export function resolve(pathname) {
  const raw = pathname.replace(/^\/+|\/+$/g, '');
  const segments = raw ? raw.split('/') : [];
  const prefixParts = [];
  if (segments[0] === 'api') prefixParts.push(segments.shift());
  if (segments[0] === API_VERSION) prefixParts.push(segments.shift());
  const prefix = prefixParts.length ? `/${prefixParts.join('/')}` : '';
  const match = (handler, params = {}) => ({ handler, params, prefix });

  if (segments.length === 0) return match(handlers.index);

  const [head, ...rest] = segments;

  switch (head) {
    case 'health':
      if (rest.length === 0) return match(handlers.health);
      break;
    case 'meta':
      if (rest.length === 0) return match(handlers.meta);
      break;
    case 'overview':
    case 'summary':
      if (rest.length === 0) return match(handlers.overview);
      break;
    case 'dashboard':
      if (rest.length === 0) return match(handlers.dashboard);
      break;
    case 'stocks':
      if (rest.length === 0) return match(handlers.stocks);
      if (rest.length === 1) return match(handlers.stock, { ticker: safeDecode(rest[0]) });
      if (rest.length === 2 && rest[1] === 'posts') {
        return match(handlers.stockPosts, { ticker: safeDecode(rest[0]) });
      }
      break;
    case 'posts':
      if (rest.length === 0) return match(handlers.posts);
      break;
    case 'openapi.json':
      if (rest.length === 0) return match(handlers.openapi);
      break;
    case 'history':
      if (rest.length === 0) return match(handlers.history);
      if (rest.length === 1) {
        return match(handlers.tickerHistory, { ticker: safeDecode(rest[0]) });
      }
      break;
    default:
      break;
  }
  return null;
}
