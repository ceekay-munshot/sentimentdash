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
import { cleanCompanyName, companyKey, isCompanyName, keyPosts } from './companies.mjs';
import { extractCompany } from './sources/googlenews.mjs';

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

console.log('\nName cleaning + keying');
check(
  'strips an editorial subtitle after a dash',
  cleanCompanyName('Afcom Holdings - Sky High Ambitions, Grounded in Reality?') === 'Afcom Holdings',
);
check(
  'strips a theme after a colon',
  cleanCompanyName('Data Center Value Chain in India: Investment Opportunities') ===
    'Data Center Value Chain in India',
);
check('leaves a clean company name untouched', cleanCompanyName('Suzlon Energy') === 'Suzlon Energy');
check(
  'strips a trailing Ltd from the display name',
  cleanCompanyName('Piccadily Agro Industries Ltd') === 'Piccadily Agro Industries',
);
check('keys drop the Ltd suffix', companyKey('Reliance Industries Ltd') === 'reliance-industries');
check('keys are slugs', companyKey('Suzlon Energy') === 'suzlon-energy');
check(
  'a name and its Ltd form share one key',
  companyKey('Caplin Point Laboratories') === companyKey('Caplin Point Laboratories Ltd'),
);
check('accepts a real company name', isCompanyName('Caplin Point Laboratories') === true);
check(
  'rejects a thematic thread title',
  isCompanyName('Data Center Value Chain in India') === false,
);

console.log('\nHeadline company extraction');
check(
  'extracts a company that leads the headline',
  extractCompany('Tata Motors shares jump 5% after Q4 results') === 'Tata Motors',
);
check(
  'extracts a company from mid-headline',
  extractCompany('Should you buy Suzlon Energy at these levels?') === 'Suzlon Energy',
);
check(
  'returns null for an index-only headline',
  extractCompany('Sensex, Nifty close higher; IT stocks lead') === null,
);
check(
  'skips the jargon word in "Multibagger stock: ..."',
  extractCompany('Multibagger stock: Tata Power doubles investor wealth') === 'Tata Power',
);
check(
  'does not treat a month as a company',
  extractCompany('Top 5 stocks to buy in May 2026') === null,
);
check(
  'skips the jargon word in "Breakout stock: ..."',
  extractCompany('Breakout stock: HDFC Bank tops resistance') === 'HDFC Bank',
);

console.log('\nDiscovery + cross-source merge');
const vpForKey = [
  vpPost('vp-s', 901, 'Suzlon Energy', 'Order book strong, accumulating.', 3),
  vpPost('vp-c', 902, 'Caplin Point Laboratories', 'Margins expanding, buy.', 4),
  vpPost('vp-p', 904, 'Piccadily Agro Industries Ltd', 'Bonus on the cards.', 2),
  // A ValuePickr thematic thread — must be dropped, it is not a company.
  vpPost('vp-t', 903, 'Data Center Value Chain in India: Investment Opportunities', 'Big theme.', 3),
];
const newsRaw = (id, companyName, ageHours) => ({
  source: 'news',
  id,
  author: 'Test Wire',
  handle: 'Test Wire',
  community: 'Google News',
  timestamp: hoursAgo(ageHours),
  text: `${companyName} in the news`,
  url: `https://news.google.com/x/${id}`,
  likes: 0,
  comments: 0,
  companyName,
});
const newsForKey = [
  newsRaw('gn-1', 'Suzlon Energy', 2), // merges onto the ValuePickr company
  newsRaw('gn-2', 'Suzlon Energy', 5),
  newsRaw('gn-3', 'Tata Motors', 2), //   news-only company, 2 headlines -> kept
  newsRaw('gn-4', 'Tata Motors', 6),
  newsRaw('gn-5', 'Tata Power', 3), //    news-only company, 1 headline  -> dropped
];
const keyed = keyPosts(vpForKey, newsForKey);
const merged = buildData(keyed, { runs: [] }, NOW);
const mById = new Map(merged.trending.stocks.map((s) => [s.ticker, s]));

check('ValuePickr + news merge into one company', mById.get('suzlon-energy')?.mentions === 3);
check(
  'merged company counts both sources',
  mById.get('suzlon-energy')?.sources.valuepickr === 1 &&
    mById.get('suzlon-energy')?.sources.news === 2,
);
check('news independently discovers a company ValuePickr lacks', mById.get('tata-motors')?.mentions === 2);
check('a news-only company seen once is dropped as noise', !mById.has('tata-power'));
check('a ValuePickr thematic thread is dropped', !mById.has('data-center-value-chain-in-india'));
check(
  'a trailing Ltd is dropped from the card name',
  mById.get('piccadily-agro-industries')?.name === 'Piccadily Agro Industries',
);
check(
  'sources sum to mentions across every company',
  merged.trending.stocks.every((s) => s.sources.valuepickr + s.sources.news === s.mentions),
);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll pipeline self-tests passed.');
