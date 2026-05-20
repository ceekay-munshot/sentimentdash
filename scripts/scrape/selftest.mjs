/**
 * Offline pipeline self-test — no network.
 *
 *   node scripts/scrape/selftest.mjs
 *
 * Feeds a fixed set of fake posts through buildData and asserts the output
 * honours the dashboard data contract. Runs in CI before the live scrape so a
 * broken pipeline fails fast without touching real data.
 */
import { buildData } from './aggregate.mjs';

let failures = 0;
function check(label, condition) {
  if (condition) {
    console.log(`  ok  - ${label}`);
  } else {
    console.error(`  FAIL - ${label}`);
    failures++;
  }
}

const NOW = new Date('2026-05-20T12:00:00.000Z');
const hoursAgo = (h) => new Date(NOW.getTime() - h * 3600 * 1000).toISOString();

function post(id, text, ageHours, extra = {}) {
  return {
    source: 'reddit',
    id,
    author: 'tester',
    handle: 'u/tester',
    community: 'r/IndianStockMarket',
    timestamp: hoursAgo(ageHours),
    text,
    url: `https://www.reddit.com/x/${id}`,
    likes: 10,
    comments: 2,
    ...extra,
  };
}

const fixtures = [
  post('a1', 'Loaded up more RELIANCE today, conviction multibagger buy 🚀', 1),
  post('a2', 'RELIANCE downside risk after the results. Avoid this one.', 3),
  post('b1', 'Sold my TATAMOTORS, JLR demand is weak and stock is overvalued. Clear miss.', 2),
  post('b2', 'TATAMOTORS rally continues, accumulating on dips. Strong buy.', 5),
  post('c1', 'Infosys results were in line, nothing exciting either way.', 4),
  post('d1', 'HDFC Bank vs ICICI Bank — both look like solid long term accumulate picks.', 6),
  post('e1', 'Zomato breakout confirmed, huge upside 📈', 2),
  post('f1', 'Suzlon is a value trap, exited fully. Falling knife.', 7),
  post('g1', 'IRCTC board meeting next week, could go either way.', 8),
  post('z1', 'Market looks toppy, booking some profits across the board.', 1), // no ticker
  post('z2', 'Old TCS news from yesterday, strong buy.', 30), // outside 24h window
  post('z3', 'Watchlist dump: RELIANCE INFY TCS ITC SBIN HAL ZOMATO all on radar', 1), // >5 tickers
];

console.log('Run 1 (no prior history)');
const run1 = buildData(fixtures, { runs: [] }, NOW);
const { trending, postsFiles, history } = run1;
const byTicker = new Map(trending.stocks.map((s) => [s.ticker, s]));

check('produced at least one stock', trending.stocks.length > 0);
check('excluded the no-ticker post (z1)', !postsFiles.some((f) => f.posts.some((p) => p.id === 'reddit-z1')));
check('excluded the out-of-window post (z2)', !postsFiles.some((f) => f.posts.some((p) => p.id === 'reddit-z2')));
check('excluded the >5-ticker watchlist post (z3)', !postsFiles.some((f) => f.posts.some((p) => p.id === 'reddit-z3')));
check('RELIANCE has 2 mentions', byTicker.get('RELIANCE')?.mentions === 2);
check('TATAMOTORS has 2 mentions', byTicker.get('TATAMOTORS')?.mentions === 2);
check('multi-ticker post counted for HDFCBANK', byTicker.get('HDFCBANK')?.mentions === 1);
check('multi-ticker post counted for ICICIBANK', byTicker.get('ICICIBANK')?.mentions === 1);
check('TCS absent (only mention was out-of-window)', !byTicker.has('TCS'));
check('Zomato scored bullish', byTicker.get('ZOMATO')?.sentiment.label === 'bullish');
check('Suzlon scored bearish', byTicker.get('SUZLON')?.sentiment.label === 'bearish');
check('Infosys scored neutral', byTicker.get('INFY')?.sentiment.label === 'neutral');

check(
  'ranks are contiguous 1..n',
  trending.stocks.every((s, i) => s.rank === i + 1),
);
check(
  'every trending stock has a posts file',
  trending.stocks.every((s) => postsFiles.some((f) => f.ticker === s.ticker)),
);
check(
  'every posts file is in trending',
  postsFiles.every((f) => byTicker.has(f.ticker)),
);
check(
  'sentiment counts sum to mentions',
  trending.stocks.every(
    (s) => s.sentiment.bullish + s.sentiment.bearish + s.sentiment.neutral === s.mentions,
  ),
);
check(
  'each posts file length equals mentions',
  postsFiles.every((f) => f.posts.length === byTicker.get(f.ticker).mentions),
);
check(
  'changePct values are all finite',
  trending.stocks.every((s) => Number.isFinite(s.changePct)),
);
check('first run has changePct 0 (no prior data)', trending.stocks.every((s) => s.changePct === 0));
check(
  'sparkline values are all finite numbers',
  trending.stocks.every(
    (s) => Array.isArray(s.sparkline) && s.sparkline.every((n) => Number.isFinite(n)),
  ),
);
check(
  'totalPosts equals sum of mentions',
  trending.totalPosts === trending.stocks.reduce((sum, s) => sum + s.mentions, 0),
);
check('totalStocks matches stock count', trending.totalStocks === trending.stocks.length);
check(
  'marketMood sums to totalPosts',
  trending.marketMood.bullish + trending.marketMood.bearish + trending.marketMood.neutral ===
    trending.totalPosts,
);
check('history recorded exactly one run', history.runs.length === 1);
check(
  'history counts match trending mentions',
  trending.stocks.every((s) => history.runs[0].counts[s.ticker] === s.mentions),
);

console.log('\nRun 2 (with run 1 as history)');
const run2 = buildData(fixtures, history, new Date(NOW.getTime() + 12 * 3600 * 1000));
const r2 = new Map(run2.trending.stocks.map((s) => [s.ticker, s]));
check('history now has two runs', run2.history.runs.length === 2);
check(
  'second-run sparkline uses history (>= 2 points)',
  run2.trending.stocks.every((s) => s.sparkline.length >= 2),
);
check(
  'mentionsPrev now reflects run 1',
  r2.get('RELIANCE')?.mentionsPrev === byTicker.get('RELIANCE')?.mentions,
);
check('stable mentions => changePct 0 on run 2', r2.get('RELIANCE')?.changePct === 0);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll pipeline self-tests passed.');
