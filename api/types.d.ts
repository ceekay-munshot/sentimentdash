/**
 * Response types for the SentimentDash API.
 *
 * Copy this file into the consuming project (or import it from a git
 * dependency) to get typed responses without hand-writing the shapes.
 */

export type Source = 'reddit' | 'valuepickr' | 'news' | 'tradingqna';
export type Sentiment = 'bullish' | 'bearish' | 'neutral';
export type SourceFilter = Source | 'all';
export type SentimentFilter = Sentiment | 'all';
export type StockSort = 'trending' | 'bullish' | 'bearish' | 'movers' | 'mentions' | 'change' | 'name';
export type PostSort = 'newest' | 'oldest' | 'likes' | 'comments';
export type Direction = 'up' | 'down' | 'flat';

export type SourceCounts = Record<Source, number>;
export type SentimentCounts = Record<Sentiment, number>;

export interface Pagination {
  total: number;
  count: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface StockSentiment extends SentimentCounts {
  /** Net sentiment, -1 (all bearish) .. 1 (all bullish). */
  score: number;
  label: Sentiment;
  /** Display label, e.g. "Bullish". */
  labelText: string;
  /** Hex colour the dashboard uses for this label. */
  color: string;
  total: number;
  /** Share of each bucket, 0..100 — the sentiment bar's segment widths. */
  percent: SentimentCounts;
}

export interface Stock {
  /** 1-based rank by mentions. `null` for a company derived from its posts file. */
  rank: number | null;
  /** Routing key (the forum topic slug). */
  ticker: string;
  name: string;
  exchange: string;
  sector: string;
  mentions: number;
  mentionsPrev: number;
  /** Percentage change in mentions vs the previous run. */
  changePct: number;
  direction: Direction;
  sentiment: StockSentiment;
  sources: SourceCounts;
  /** Sources with at least one post, in dashboard order. */
  activeSources: Source[];
  /** Pre-joined source line, e.g. "ValuePickr · Google News". */
  sourceLabel: string;
  /** Mention counts bucketed oldest -> newest across the window. */
  sparkline: number[];
  links?: { self: string; posts: string; history: string };
}

export interface CompactStock {
  rank: number | null;
  ticker: string;
  name: string;
  mentions: number;
  changePct: number;
  sentimentScore: number;
  sentimentLabel: Sentiment;
}

export interface MarketMood extends SentimentCounts {
  total: number;
  score: number;
  label: Sentiment;
  labelText: string;
  percent: SentimentCounts;
}

export interface Post {
  id: string;
  source: Source;
  author: string;
  handle: string;
  community: string;
  /** ISO 8601. */
  timestamp: string;
  text: string;
  url: string;
  sentiment: Sentiment;
  likes: number;
  comments: number;
  /** Present on cross-company feeds and embedded post lists. */
  ticker?: string;
  sourceLabel: string;
  sourceColor: string | null;
  sentimentLabel: string;
  sentimentColor: string | null;
}

export interface PostCounts {
  total: number;
  bySource: SourceCounts;
  bySentiment: SentimentCounts;
  /** Only on endpoints that apply filters. */
  filtered?: number;
}

/* ------------------------------- responses -------------------------------- */

export interface HealthResponse {
  status: 'ok';
  version: string;
  data: {
    source: string;
    ttlSeconds: number;
    generatedAt: string | null;
    ageSeconds: number | null;
    window: string | null;
    totalPosts: number;
    totalStocks: number;
  };
  upstreamLatencyMs: number;
}

export interface MetaResponse {
  generatedAt: string;
  window: string;
  totalPosts: number;
  totalStocks: number;
  sources: Array<{ key: Source; label: string; color: string }>;
  sentiments: Array<{ key: Sentiment; label: string; color: string }>;
  moodThresholds: { bullish: number; bearish: number };
  sorts: Array<{ key: StockSort; label: string }>;
  sourceFilters: Array<{ key: SourceFilter; label: string }>;
  supported: {
    stockSorts: StockSort[];
    postSorts: PostSort[];
    sourceKeys: SourceFilter[];
    sentimentKeys: SentimentFilter[];
  };
}

export interface OverviewResponse {
  generatedAt: string;
  window: string;
  totalPosts: number;
  totalStocks: number;
  marketMood: MarketMood;
  mostBullish: CompactStock | null;
  topMover: CompactStock | null;
  /** Posts per source, summed across every company. */
  sourceTotals: SourceCounts;
}

export interface StockFilters {
  q: string | null;
  source: SourceFilter;
  sentiment: SentimentFilter;
  minMentions: number;
  sort: StockSort;
  order: 'default' | 'asc' | 'desc';
  limit: number;
  offset: number;
}

export interface StocksResponse {
  generatedAt: string;
  window: string;
  filters: StockFilters;
  pagination: Pagination;
  stocks: Stock[];
}

export interface DashboardResponse extends StocksResponse {
  overview: OverviewResponse;
}

export interface StockResponse {
  generatedAt: string;
  window: string;
  /** False when the company has dropped out of trending.json. */
  inTrending: boolean;
  /** True when the figures were rebuilt from the posts file. */
  derivedFromPosts: boolean;
  stock: Stock;
  counts: PostCounts;
  postsGeneratedAt: string | null;
  /** Present with `?includePosts=1`. */
  postFilters?: { source: SourceFilter; sentiment: SentimentFilter; q: string | null; sort: PostSort };
  postPagination?: Pagination;
  posts?: Post[];
}

export interface StockPostsResponse {
  ticker: string;
  name: string;
  exchange: string;
  sector: string;
  generatedAt: string;
  counts: PostCounts;
  filters: {
    source: SourceFilter;
    sentiment: SentimentFilter;
    q: string | null;
    sort: PostSort;
    limit: number;
    offset: number;
  };
  pagination: Pagination;
  posts: Post[];
}

export interface FeedResponse {
  tickers: string[];
  /** Requested tickers with no posts file. */
  missing: string[];
  filters: StockPostsResponse['filters'];
  counts: PostCounts;
  pagination: Pagination;
  posts: Post[];
}

export interface HistoryRun {
  at: string;
  totalPosts: number;
  marketMood: (SentimentCounts & { score: number; label: Sentiment }) | null;
  trackedStocks: number;
  /** Present with `?includeCounts=1`. */
  counts?: Record<string, number>;
}

export interface HistoryResponse {
  updatedAt: string | null;
  runs: HistoryRun[];
  count: number;
  totalRuns: number;
}

export interface TickerHistoryResponse {
  ticker: string;
  name: string;
  updatedAt: string | null;
  latest: number;
  previous: number;
  changePct: number;
  sparkline: number[];
  points: Array<{ at: string; mentions: number }>;
}

export interface ApiError {
  error: { status: number; code: string; message: string };
}
