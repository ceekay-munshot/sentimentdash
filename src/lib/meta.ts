import type { Sentiment, Source } from '../types';

export const SOURCE_ORDER: Source[] = ['reddit', 'valuepickr', 'news'];

export const SOURCE_META: Record<
  Source,
  { label: string; color: string; dot: string; soft: string; hex: string }
> = {
  reddit: { label: 'Reddit', color: 'text-reddit', dot: 'bg-reddit', soft: 'bg-reddit/15', hex: '#ff5414' },
  valuepickr: { label: 'ValuePickr', color: 'text-valuepickr', dot: 'bg-valuepickr', soft: 'bg-valuepickr/15', hex: '#27b3a8' },
  news: { label: 'Google News', color: 'text-news', dot: 'bg-news', soft: 'bg-news/15', hex: '#ff8a3d' },
};

export const SENTIMENT_ORDER: Sentiment[] = ['bullish', 'bearish', 'neutral'];

export const SENTIMENT_META: Record<
  Sentiment,
  { label: string; text: string; soft: string; bar: string; border: string; hex: string }
> = {
  bullish: { label: 'Bullish', text: 'text-bull', soft: 'bg-bull/10', bar: 'bg-bull', border: 'border-bull/25', hex: '#34d399' },
  bearish: { label: 'Bearish', text: 'text-bear', soft: 'bg-bear/10', bar: 'bg-bear', border: 'border-bear/25', hex: '#fb6f84' },
  neutral: { label: 'Neutral', text: 'text-flat', soft: 'bg-flat/10', bar: 'bg-flat', border: 'border-flat/25', hex: '#8b91ab' },
};

export function moodLabel(score: number): Sentiment {
  if (score > 0.12) return 'bullish';
  if (score < -0.12) return 'bearish';
  return 'neutral';
}
