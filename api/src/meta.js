/**
 * Presentation metadata, mirrored from the dashboard (`src/lib/meta.ts`) so API
 * consumers can render the same labels and colours without re-deriving them.
 *
 * Keep in sync with the dashboard if those labels/colours ever change.
 */

/** @typedef {'reddit'|'valuepickr'|'news'|'tradingqna'} Source */
/** @typedef {'bullish'|'bearish'|'neutral'} Sentiment */

/** @type {Source[]} */
export const SOURCE_ORDER = ['reddit', 'valuepickr', 'news', 'tradingqna'];

export const SOURCE_META = {
  reddit: { label: 'Reddit', color: '#ff5414' },
  valuepickr: { label: 'ValuePickr', color: '#27b3a8' },
  news: { label: 'Google News', color: '#ff8a3d' },
  tradingqna: { label: 'TradingQnA', color: '#4ea3e0' },
};

/** @type {Sentiment[]} */
export const SENTIMENT_ORDER = ['bullish', 'bearish', 'neutral'];

export const SENTIMENT_META = {
  bullish: { label: 'Bullish', color: '#34d399' },
  bearish: { label: 'Bearish', color: '#fb6f84' },
  neutral: { label: 'Neutral', color: '#8b91ab' },
};

/** Net-sentiment cut-offs the dashboard uses to turn a score into a label. */
export const MOOD_THRESHOLDS = { bullish: 0.12, bearish: -0.12 };

/** Sort orders offered by the dashboard's "Trending now" toolbar. */
export const SORTS = [
  { key: 'trending', label: 'Trending' },
  { key: 'bullish', label: 'Bullish' },
  { key: 'bearish', label: 'Bearish' },
  { key: 'movers', label: 'Movers' },
];

/** Source filters offered by the dashboard (note: no Reddit chip today). */
export const SOURCE_FILTERS = [
  { key: 'all', label: 'All sources' },
  { key: 'valuepickr', label: 'ValuePickr' },
  { key: 'news', label: 'Google News' },
  { key: 'tradingqna', label: 'TradingQnA' },
];

export const ZERO_SOURCES = Object.freeze({
  reddit: 0,
  valuepickr: 0,
  news: 0,
  tradingqna: 0,
});

/**
 * @param {number} score net sentiment, -1..1
 * @returns {Sentiment}
 */
export function moodLabel(score) {
  if (score > MOOD_THRESHOLDS.bullish) return 'bullish';
  if (score < MOOD_THRESHOLDS.bearish) return 'bearish';
  return 'neutral';
}
