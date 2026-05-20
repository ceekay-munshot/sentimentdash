import type { StockPosts, TrendingData } from '../types';

const BASE = import.meta.env.BASE_URL;

async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Failed to load ${path} (${res.status})`);
  return (await res.json()) as T;
}

export function fetchTrending(): Promise<TrendingData> {
  return getJSON<TrendingData>('data/trending.json');
}

export function fetchStockPosts(ticker: string): Promise<StockPosts> {
  return getJSON<StockPosts>(`data/posts/${ticker}.json`);
}
