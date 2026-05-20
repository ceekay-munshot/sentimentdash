/**
 * Offline pipeline self-test — no network.
 *
 *   node scripts/scrape/selftest.mjs
 *
 * Feeds a fixed set of fake forum posts through buildData and asserts the
 * output honours the dashboard data contract. Runs in CI before the live
 * scrape so a broken pipeline fails fast without touching real data.
 */
import { buildData } from './aggregate.mjs';
import { cleanCompanyName } from './sources/googlenews.mjs';

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

function vpPost(id, topicId, topicTitle, text, ageHours) {
  return {
    source: 'valuepickr',
    id,
    author: 'vptester',
    handle: '@vptester',
    community: topicTitle,
    timestamp: hoursAgo(ageHours),
    text,
    url: `https://forum.valuepickr.com/t/x/${topicId}/${id}`,
    likes: 4,
    comments: 1,
    topicId: String(topicId),
    topicTitle,
  };
}

const fixtures = [
  // Topic 501 — Caplin Point Laboratories: 3 posts (2 bullish, 1 bearish)
  vpPost('cp1', 501, 'Caplin Point Laboratories', 'Strong buy, margins expanding and a clear multibagger.', 3),
  vpPost('cp2', 501, 'Caplin Point Laboratories', 'Accumulating more, the breakout is confirmed.', 5),
  vpPost('cp3', 501, 'Caplin Point Laboratories', 'Receivables are a red flag for me, I exited.', 7),
  // Topic 502 — Suzlon Energy: 2 posts (1 bullish, 1 bearish)
  vpPost('sz1', 502, 'Suzlon Energy', 'Order book looks healthy, accumulating on dips.', 2),
  vpPost('sz2', 502, 'Suzlon Energy', 'Valuations stretched, would avoid at these levels.', 6),
  // Topic 503 — Reliance Industries: 1 neutral post
  vpPost('rl1', 503, 'Reliance Industries', 'Results were in line, nothing exciting either way.', 4),
  // Excluded — outside the window
  vpPost('ow1', 504, 'Old Co', 'Strong buy, great quarter.', 800),
];
// Excluded — a post with no topic id
fixtures.push({ ...vpPost('nt1', 0, 'No Topic', 'Strong buy.', 1), topicId: undefined });

console.log('Run 1 (no prior history)');
const run1 = buildData(fixtures, { runs: [] }, NOW);
const { trending, postsFiles, history } = run1;
const byId = new Map(trending.stocks.map((s) => [s.ticker, s]));

check('discovered exactly 3 companies', trending.stocks.length === 3);
check('excluded the out-of-window post (ow1)', !postsFiles.some((f) => f.posts.some((p) => p.id === 'valuepickr-ow1')));
check('excluded the topic-less post (nt1)', !postsFiles.some((f) => f.posts.some((p) => p.id === 'valuepickr-nt1')));
check('Caplin (501) has 3 mentions', byId.get('501')?.mentions === 3);
check('Suzlon (502) has 2 mentions', byId.get('502')?.mentions === 2);
check('Reliance (503) has 1 mention', byId.get('503')?.mentions === 1);
check('most-discussed topic ranks #1', byId.get('501')?.rank === 1);
check('ranks are contiguous 1..n', trending.stocks.every((s, i) => s.rank === i + 1));
check('company name comes from the topic title', byId.get('501')?.name === 'Caplin Point Laboratories');
check('routing key is the topic id', trending.stocks.every((s) => /^\d+$/.test(s.ticker)));
check('exchange/sector left blank for forum-discovered companies', trending.stocks.every((s) => s.exchange === '' && s.sector === ''));
check('Caplin scored bullish', byId.get('501')?.sentiment.label === 'bullish');
check('Suzlon scored neutral (1 bull / 1 bear)', byId.get('502')?.sentiment.label === 'neutral');

check('every company has a posts file', trending.stocks.every((s) => postsFiles.some((f) => f.ticker === s.ticker)));
check('every posts file is in trending', postsFiles.every((f) => byId.has(f.ticker)));
check(
  'sentiment counts sum to mentions',
  trending.stocks.every((s) => s.sentiment.bullish + s.sentiment.bearish + s.sentiment.neutral === s.mentions),
);
check('each posts file length equals mentions', postsFiles.every((f) => f.posts.length === byId.get(f.ticker).mentions));
check('all posts sourced from valuepickr', trending.stocks.every((s) => s.sources.valuepickr === s.mentions));
check('changePct values are all finite', trending.stocks.every((s) => Number.isFinite(s.changePct)));
check('first run has changePct 0 (no prior data)', trending.stocks.every((s) => s.changePct === 0));
check(
  'sparkline values are all finite numbers',
  trending.stocks.every((s) => Array.isArray(s.sparkline) && s.sparkline.every((n) => Number.isFinite(n))),
);
check('totalPosts equals sum of mentions', trending.totalPosts === trending.stocks.reduce((sum, s) => sum + s.mentions, 0));
check('totalStocks matches company count', trending.totalStocks === trending.stocks.length);
check(
  'marketMood sums to totalPosts',
  trending.marketMood.bullish + trending.marketMood.bearish + trending.marketMood.neutral === trending.totalPosts,
);
check('history recorded exactly one run', history.runs.length === 1);
check('history counts match trending mentions', trending.stocks.every((s) => history.runs[0].counts[s.ticker] === s.mentions));

console.log('\nRun 2 (with run 1 as history)');
const run2 = buildData(fixtures, history, new Date(NOW.getTime() + 12 * 3600 * 1000));
const r2 = new Map(run2.trending.stocks.map((s) => [s.ticker, s]));
check('history now has two runs', run2.history.runs.length === 2);
check('second-run sparkline uses history (>= 2 points)', run2.trending.stocks.every((s) => s.sparkline.length >= 2));
check('mentionsPrev now reflects run 1', r2.get('501')?.mentionsPrev === 3);
check('stable mentions => changePct 0 on run 2', r2.get('501')?.changePct === 0);

console.log('\nCompany-name cleaning + news merge');

check(
  'strips an editorial subtitle after a dash',
  cleanCompanyName('Afcom Holdings - Sky High Ambitions, Grounded in Reality?') === 'Afcom Holdings',
);
check(
  'strips a theme after a colon',
  cleanCompanyName('Data Center Value Chain in India: Investment Opportunities') ===
    'Data Center Value Chain in India',
);
check(
  'leaves a clean company name untouched',
  cleanCompanyName('Piccadily Agro Industries Ltd') === 'Piccadily Agro Industries Ltd',
);
check('trims a trailing question mark', cleanCompanyName('Suzlon Energy?') === 'Suzlon Energy');

// News posts arrive already tagged with a ValuePickr topicId; buildData must
// merge them onto that company and count them under sources.news.
const newsTagged = [
  {
    source: 'news',
    id: 'gn-n1',
    author: 'Test Wire',
    handle: 'Test Wire',
    community: 'Google News',
    timestamp: hoursAgo(2),
    text: 'Caplin Point Laboratories wins fresh US FDA approval',
    url: 'https://news.google.com/x/n1',
    likes: 0,
    comments: 0,
    topicId: '501',
    topicTitle: 'Caplin Point Laboratories',
  },
];
const merged = buildData([...fixtures, ...newsTagged], { runs: [] }, NOW);
const mById = new Map(merged.trending.stocks.map((s) => [s.ticker, s]));
check('news post merges onto the ValuePickr company', mById.get('501')?.mentions === 4);
check('news post counted under sources.news', mById.get('501')?.sources.news === 1);
check(
  'sources sum to mentions across every company',
  merged.trending.stocks.every((s) => s.sources.valuepickr + s.sources.news === s.mentions),
);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll pipeline self-tests passed.');
