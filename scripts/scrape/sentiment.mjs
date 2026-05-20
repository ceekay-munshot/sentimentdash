/**
 * Lexicon sentiment scoring.
 *
 * Counts bullish vs bearish cue words/phrases in a post and returns the
 * dominant label. Deliberately simple and dependency-free — it is approximate
 * and can be swapped for a model-based scorer later without touching callers.
 */

const BULLISH = [
  'buy', 'buying', 'bought', 'long', 'longing', 'bullish', 'accumulate',
  'accumulating', 'accumulated', 'multibagger', 'multi-bagger', 'breakout',
  'undervalued', 'upside', 'huge upside', 'rally', 'rallying', 'conviction',
  'compounder', 'rerating', 're-rating', 'oversold', 'gem', 'hidden gem',
  'value buy', 'load up', 'loaded up', 'averaging down', 'all-time high',
  '52 week high', 'momentum', 'upgraded', 'outperform', 'strong buy',
  'buy the dip', 'add more', 'adding more', 'moon', 'mooning', 'diamond hands',
  'booked profit', 'booked profits',
];

const BEARISH = [
  'sell', 'selling', 'sold', 'short', 'shorting', 'shorted', 'bearish', 'dump',
  'dumping', 'dumped', 'crash', 'crashing', 'crashed', 'overvalued',
  'overpriced', 'overhyped', 'downside', 'falling', 'fell', 'weak', 'weakness',
  'avoid', 'stay away', 'exit', 'exited', 'value trap', 'trap', 'bagholder',
  'bag holder', 'bleeding', 'downgrade', 'downgraded', 'clear miss',
  'missed estimates', 'disappointing', 'disappoint', 'falling knife',
  'dead money', 'pledge', 'pledging', 'pledged', 'fraud', 'scam', 'headwinds',
  '52 week low', 'all-time low', 'breakdown', 'broke down', 'sell-off',
  'selloff', 'red flag', 'in the red', 'booked loss', 'booked losses',
  'capitulation',
];

const BULL_EMOJI = ['🚀', '💎', '📈'];
const BEAR_EMOJI = ['📉', '🔴', '💀'];

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function buildRegex(terms) {
  const alt = terms
    .slice()
    .sort((a, b) => b.length - a.length)
    .map(escapeRegex)
    .join('|');
  return new RegExp(`(?<![a-z0-9])(?:${alt})(?![a-z0-9])`, 'g');
}

const BULL_RE = buildRegex(BULLISH);
const BEAR_RE = buildRegex(BEARISH);

const countMatches = (low, re) => (low.match(re) || []).length;
const countEmoji = (text, set) => [...text].reduce((n, ch) => n + (set.includes(ch) ? 1 : 0), 0);

/**
 * Scores a post's text.
 * @returns {'bullish'|'bearish'|'neutral'}
 */
export function scorePost(text) {
  const str = String(text || '');
  const low = str.toLowerCase();
  const bull = countMatches(low, BULL_RE) + countEmoji(str, BULL_EMOJI);
  const bear = countMatches(low, BEAR_RE) + countEmoji(str, BEAR_EMOJI);
  if (bull > bear) return 'bullish';
  if (bear > bull) return 'bearish';
  return 'neutral';
}
