export type Source = 'reddit' | 'valuepickr' | 'news' | 'traderji';
export type Sentiment = 'bullish' | 'bearish' | 'neutral';

export interface SentimentBreakdown {
  /** Net sentiment, -1 (all bearish) .. 1 (all bullish). */
  score: number;
  label: Sentiment;
  bullish: number;
  bearish: number;
  neutral: number;
}

export interface TrendingStock {
  rank: number;
  ticker: string;
  name: string;
  exchange: string;
  sector: string;
  mentions: number;
  mentionsPrev: number;
  changePct: number;
  sentiment: SentimentBreakdown;
  sources: Record<Source, number>;
  /** Mention counts bucketed oldest -> newest across the window. */
  sparkline: number[];
}

export interface MarketMood {
  bullish: number;
  bearish: number;
  neutral: number;
  score: number;
}

export interface TrendingData {
  generatedAt: string;
  window: string;
  totalPosts: number;
  totalStocks: number;
  marketMood: MarketMood;
  stocks: TrendingStock[];
}

export interface Post {
  id: string;
  source: Source;
  author: string;
  handle: string;
  community: string;
  timestamp: string;
  text: string;
  url: string;
  sentiment: Sentiment;
  likes: number;
  comments: number;
}

export interface StockPosts {
  ticker: string;
  name: string;
  exchange: string;
  sector: string;
  generatedAt: string;
  posts: Post[];
}
