/**
 * Shaping helpers: turn the raw scrape files into the numbers the dashboard
 * actually renders (labels, percentages, derived stat cards), and apply the
 * same search / filter / sort rules the UI applies client-side.
 */
import {
  SENTIMENT_META,
  SENTIMENT_ORDER,
  SOURCE_META,
  SOURCE_ORDER,
  ZERO_SOURCES,
  moodLabel,
} from './meta.js';
import { badRequest } from './http.js';

const round = (v, digits = 2) => Number(v.toFixed(digits));

/** Share of each bucket, as the sentiment bar draws it. */
function percentages(counts) {
  const total = SENTIMENT_ORDER.reduce((sum, k) => sum + (counts[k] ?? 0), 0);
  const denominator = total || 1;
  return {
    bullish: round(((counts.bullish ?? 0) / denominator) * 100, 1),
    bearish: round(((counts.bearish ?? 0) / denominator) * 100, 1),
    neutral: round(((counts.neutral ?? 0) / denominator) * 100, 1),
  };
}

/** @param {number} changePct */
function direction(changePct) {
  if (changePct > 0) return 'up';
  if (changePct < 0) return 'down';
  return 'flat';
}

/**
 * One row of the trending table, with the derived bits the dashboard computes
 * at render time folded in. Every raw field is preserved as-is.
 *
 * @param {any} stock
 * @param {(path: string) => string} [link]
 */
export function enrichStock(stock, link) {
  const sentiment = stock.sentiment ?? {};
  const counts = {
    bullish: sentiment.bullish ?? 0,
    bearish: sentiment.bearish ?? 0,
    neutral: sentiment.neutral ?? 0,
  };
  const total = counts.bullish + counts.bearish + counts.neutral;
  const score = sentiment.score ?? 0;
  const sources = { ...ZERO_SOURCES, ...(stock.sources ?? {}) };
  const activeSources = SOURCE_ORDER.filter((s) => (sources[s] ?? 0) > 0);
  const changePct = stock.changePct ?? 0;

  const enriched = {
    rank: stock.rank,
    ticker: stock.ticker,
    name: stock.name,
    exchange: stock.exchange ?? '',
    sector: stock.sector ?? '',
    mentions: stock.mentions ?? 0,
    mentionsPrev: stock.mentionsPrev ?? 0,
    changePct,
    direction: direction(changePct),
    sentiment: {
      score,
      label: sentiment.label ?? moodLabel(score),
      labelText: SENTIMENT_META[sentiment.label ?? moodLabel(score)].label,
      color: SENTIMENT_META[sentiment.label ?? moodLabel(score)].color,
      ...counts,
      total,
      percent: percentages(counts),
    },
    sources,
    activeSources,
    /** The "ValuePickr · Google News" line under the company name. */
    sourceLabel: activeSources.map((s) => SOURCE_META[s].label).join(' · ') || '—',
    sparkline: stock.sparkline ?? [],
  };

  if (link) {
    enriched.links = {
      self: link(`/stocks/${encodeURIComponent(stock.ticker)}`),
      posts: link(`/stocks/${encodeURIComponent(stock.ticker)}/posts`),
      history: link(`/history/${encodeURIComponent(stock.ticker)}`),
    };
  }
  return enriched;
}

/** A trimmed stock, for the "most bullish" / "top mover" stat cards. */
export function compactStock(stock) {
  if (!stock) return null;
  return {
    rank: stock.rank,
    ticker: stock.ticker,
    name: stock.name,
    mentions: stock.mentions,
    changePct: stock.changePct,
    sentimentScore: stock.sentiment?.score ?? 0,
    sentimentLabel: stock.sentiment?.label ?? moodLabel(stock.sentiment?.score ?? 0),
  };
}

/**
 * The four stat cards at the top of the dashboard plus the mood breakdown.
 * `mostBullish` / `topMover` are picked exactly as `Dashboard.tsx` picks them.
 */
export function buildOverview(trending) {
  const stocks = trending.stocks ?? [];
  const mood = trending.marketMood ?? { bullish: 0, bearish: 0, neutral: 0, score: 0 };
  const moodCounts = {
    bullish: mood.bullish ?? 0,
    bearish: mood.bearish ?? 0,
    neutral: mood.neutral ?? 0,
  };

  const topMover = [...stocks].sort((a, b) => b.changePct - a.changePct)[0] ?? null;
  const mostBullish =
    [...stocks].sort((a, b) => b.sentiment.score - a.sentiment.score)[0] ?? null;

  const sourceTotals = { ...ZERO_SOURCES };
  for (const stock of stocks) {
    for (const source of SOURCE_ORDER) sourceTotals[source] += stock.sources?.[source] ?? 0;
  }

  return {
    generatedAt: trending.generatedAt,
    window: trending.window,
    totalPosts: trending.totalPosts ?? 0,
    totalStocks: trending.totalStocks ?? stocks.length,
    marketMood: {
      ...moodCounts,
      total: moodCounts.bullish + moodCounts.bearish + moodCounts.neutral,
      score: mood.score ?? 0,
      label: moodLabel(mood.score ?? 0),
      labelText: SENTIMENT_META[moodLabel(mood.score ?? 0)].label,
      percent: percentages(moodCounts),
    },
    mostBullish: compactStock(mostBullish),
    topMover: compactStock(topMover),
    sourceTotals,
  };
}

/* ----------------------------- list operations ---------------------------- */

const STOCK_SORTS = {
  trending: (a, b) => a.rank - b.rank,
  bullish: (a, b) => b.sentiment.score - a.sentiment.score,
  bearish: (a, b) => a.sentiment.score - b.sentiment.score,
  movers: (a, b) => b.changePct - a.changePct,
  mentions: (a, b) => b.mentions - a.mentions,
  change: (a, b) => b.changePct - a.changePct,
  name: (a, b) => String(a.name).localeCompare(String(b.name)),
};

export const STOCK_SORT_KEYS = Object.keys(STOCK_SORTS);

/**
 * Search + filter + sort, matching the dashboard's client-side behaviour:
 * `q` matches ticker or name, `source` keeps companies with at least one post
 * from that source.
 *
 * @param {any[]} stocks
 * @param {{ q?: string|null, source?: string, sentiment?: string, minMentions?: number,
 *           sort?: string, order?: string }} options
 */
export function filterStocks(stocks, options = {}) {
  const {
    q = null,
    source = 'all',
    sentiment = 'all',
    minMentions = 0,
    sort = 'trending',
    order = 'default',
  } = options;

  const needle = q ? q.trim().toLowerCase() : '';
  const filtered = stocks.filter((s) => {
    if (needle) {
      const haystack = `${s.ticker ?? ''} ${s.name ?? ''}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    if (source !== 'all' && (s.sources?.[source] ?? 0) <= 0) return false;
    if (sentiment !== 'all' && (s.sentiment?.label ?? moodLabel(s.sentiment?.score ?? 0)) !== sentiment) {
      return false;
    }
    if (minMentions > 0 && (s.mentions ?? 0) < minMentions) return false;
    return true;
  });

  const comparator = STOCK_SORTS[sort];
  if (!comparator) throw badRequest(`Unknown sort \`${sort}\`.`, 'invalid_param');
  const sorted = [...filtered].sort(comparator);
  if (order === 'asc' || order === 'desc') {
    // `default` keeps each sort's natural direction (as the dashboard does);
    // asc/desc let a consumer flip it.
    const naturallyAscending = sort === 'trending' || sort === 'bearish' || sort === 'name';
    const wantAscending = order === 'asc';
    if (naturallyAscending !== wantAscending) sorted.reverse();
  }
  return sorted;
}

const POST_SORTS = {
  newest: (a, b) => String(b.timestamp).localeCompare(String(a.timestamp)),
  oldest: (a, b) => String(a.timestamp).localeCompare(String(b.timestamp)),
  likes: (a, b) => (b.likes ?? 0) - (a.likes ?? 0),
  comments: (a, b) => (b.comments ?? 0) - (a.comments ?? 0),
};

export const POST_SORT_KEYS = Object.keys(POST_SORTS);

/**
 * @param {any[]} posts
 * @param {{ source?: string, sentiment?: string, q?: string|null, sort?: string }} options
 */
export function filterPosts(posts, options = {}) {
  const { source = 'all', sentiment = 'all', q = null, sort = 'newest' } = options;
  const needle = q ? q.trim().toLowerCase() : '';

  const filtered = posts.filter((p) => {
    if (source !== 'all' && p.source !== source) return false;
    if (sentiment !== 'all' && p.sentiment !== sentiment) return false;
    if (needle) {
      const haystack = `${p.text ?? ''} ${p.author ?? ''} ${p.community ?? ''}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });

  const comparator = POST_SORTS[sort];
  if (!comparator) throw badRequest(`Unknown sort \`${sort}\`.`, 'invalid_param');
  return [...filtered].sort(comparator);
}

/** Adds the source/sentiment display labels the post card shows. */
export function enrichPost(post, ticker) {
  const source = SOURCE_META[post.source];
  const sentiment = SENTIMENT_META[post.sentiment];
  return {
    ...post,
    ...(ticker ? { ticker } : null),
    sourceLabel: source?.label ?? post.source,
    sourceColor: source?.color ?? null,
    sentimentLabel: sentiment?.label ?? post.sentiment,
    sentimentColor: sentiment?.color ?? null,
  };
}

/** Tallies used by the detail header and the post filter chips. */
export function countPosts(posts) {
  const bySource = { ...ZERO_SOURCES };
  const bySentiment = { bullish: 0, bearish: 0, neutral: 0 };
  for (const post of posts) {
    if (bySource[post.source] !== undefined) bySource[post.source]++;
    if (bySentiment[post.sentiment] !== undefined) bySentiment[post.sentiment]++;
  }
  return { total: posts.length, bySource, bySentiment };
}

/**
 * The fallback `StockDetail.tsx` uses when a company isn't in trending.json:
 * rebuild mentions / sentiment / sources from its posts file.
 */
export function stockFromPosts(file) {
  const posts = file.posts ?? [];
  const { bySource, bySentiment } = countPosts(posts);
  const score = round(
    (bySentiment.bullish - bySentiment.bearish) /
      (bySentiment.bullish + bySentiment.bearish + bySentiment.neutral || 1),
    2,
  );
  return {
    rank: null,
    ticker: file.ticker,
    name: file.name ?? file.ticker,
    exchange: file.exchange ?? '',
    sector: file.sector ?? '',
    mentions: posts.length,
    mentionsPrev: 0,
    changePct: 0,
    sentiment: { score, label: moodLabel(score), ...bySentiment },
    sources: bySource,
    sparkline: [],
  };
}

/**
 * @param {any[]} items
 * @param {number} limit
 * @param {number} offset
 */
export function paginate(items, limit, offset) {
  const page = items.slice(offset, offset + limit);
  return {
    page,
    pagination: {
      total: items.length,
      count: page.length,
      limit,
      offset,
      hasMore: offset + page.length < items.length,
    },
  };
}
