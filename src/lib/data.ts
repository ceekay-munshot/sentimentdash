import type { StockPosts, TrendingData } from '../types';

// Scraped data is read live from the repo (GitHub's raw CDN) so the twice-daily
// refresh shows up on the dashboard without waiting for a site rebuild.
const DATA_BASE =
  'https://raw.githubusercontent.com/ceekay-munshot/sentimentdash/main/public/data/';

async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(`${DATA_BASE}${path}`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Failed to load ${path} (${res.status})`);
  return (await res.json()) as T;
}

export function fetchTrending(): Promise<TrendingData> {
  return getJSON<TrendingData>('trending.json');
}

export function fetchStockPosts(ticker: string): Promise<StockPosts> {
  return getJSON<StockPosts>(`posts/${ticker}.json`);
}
