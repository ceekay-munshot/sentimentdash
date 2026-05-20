/**
 * Generates realistic SAMPLE data for the dashboard UI phase.
 *
 * Output (the contract the real scrapers must also produce):
 *   public/data/trending.json        — ranked list of trending stocks
 *   public/data/posts/<TICKER>.json  — the posts behind each stock
 *
 * This is placeholder data so the UI can be built and reviewed before the
 * Reddit / ValuePickr / Substack scrapers exist. Re-run with `npm run gen:data`.
 */
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = join(ROOT, 'public', 'data');
const POSTS_DIR = join(DATA_DIR, 'posts');

/* ----------------------------- seeded RNG ------------------------------ */
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260520);
const rnd = (min, max) => min + rand() * (max - min);
const rint = (min, max) => Math.floor(rnd(min, max + 1));
const pick = (a) => a[Math.floor(rand() * a.length)];
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round = (v, d = 1) => Number(v.toFixed(d));
const id36 = (n) => Math.floor(rand() * 36 ** n).toString(36).padStart(n, '0');

/* ------------------------------- stocks -------------------------------- */
const STOCKS = [
  { ticker: 'RELIANCE', name: 'Reliance Industries', exchange: 'NSE', sector: 'Energy', weight: 1.0 },
  { ticker: 'TATAMOTORS', name: 'Tata Motors', exchange: 'NSE', sector: 'Automobile', weight: 0.95 },
  { ticker: 'SUZLON', name: 'Suzlon Energy', exchange: 'NSE', sector: 'Renewables', weight: 0.92 },
  { ticker: 'HDFCBANK', name: 'HDFC Bank', exchange: 'NSE', sector: 'Banking', weight: 0.87 },
  { ticker: 'IRFC', name: 'Indian Railway Finance Corp', exchange: 'NSE', sector: 'PSU · Financials', weight: 0.84 },
  { ticker: 'ADANIENT', name: 'Adani Enterprises', exchange: 'NSE', sector: 'Conglomerate', weight: 0.8 },
  { ticker: 'INFY', name: 'Infosys', exchange: 'NSE', sector: 'IT Services', weight: 0.77 },
  { ticker: 'ZOMATO', name: 'Zomato', exchange: 'NSE', sector: 'Internet', weight: 0.73 },
  { ticker: 'YESBANK', name: 'Yes Bank', exchange: 'NSE', sector: 'Banking', weight: 0.7 },
  { ticker: 'TATAPOWER', name: 'Tata Power', exchange: 'NSE', sector: 'Power', weight: 0.66 },
  { ticker: 'ICICIBANK', name: 'ICICI Bank', exchange: 'NSE', sector: 'Banking', weight: 0.62 },
  { ticker: 'IRCTC', name: 'Indian Railway Catering & Tourism', exchange: 'NSE', sector: 'PSU · Travel', weight: 0.59 },
  { ticker: 'TCS', name: 'Tata Consultancy Services', exchange: 'NSE', sector: 'IT Services', weight: 0.55 },
  { ticker: 'HAL', name: 'Hindustan Aeronautics', exchange: 'NSE', sector: 'PSU · Defence', weight: 0.51 },
  { ticker: 'PAYTM', name: 'One97 Communications', exchange: 'NSE', sector: 'Fintech', weight: 0.47 },
  { ticker: 'SBIN', name: 'State Bank of India', exchange: 'NSE', sector: 'PSU · Banking', weight: 0.43 },
  { ticker: 'BHARTIARTL', name: 'Bharti Airtel', exchange: 'NSE', sector: 'Telecom', weight: 0.39 },
  { ticker: 'TATASTEEL', name: 'Tata Steel', exchange: 'NSE', sector: 'Metals', weight: 0.35 },
  { ticker: 'ITC', name: 'ITC', exchange: 'NSE', sector: 'FMCG', weight: 0.31 },
  { ticker: 'BAJFINANCE', name: 'Bajaj Finance', exchange: 'NSE', sector: 'NBFC', weight: 0.27 },
];

/* ------------------------------- pools --------------------------------- */
const REDDIT_USERS = [
  'DalalStreetDegen', 'ChaiAndCharts', 'NiftyNinja07', 'compounding_chaman',
  'MidCapMaximalist', 'SipAndChill', 'bears_of_dalal_st', 'OptionSeller_Raj',
  'value_vulture', 'DiamondHandsDesi', 'RetailRakesh', 'MultibaggerHunt',
  'ledger_lord', 'the_patient_bull', 'smallcap_sherlock', 'FIIflowtracker',
  'ZerodhaZen', 'bagholder_bro', 'EquityEnthu', 'monsoon_portfolio',
];
const VP_USERS = [
  'ValueSeeker', 'LongTermLad', 'MoatHunter', 'CompoundingCarl', 'ConcallNotes',
  'PortfolioPilgrim', 'SlowAndSteady', 'fundamentalsfirst', 'capital_allocator',
  'theAnnualReport', 'CashFlowConnoisseur', 'MrMarketWatcher', 'ScuttlebuttSingh',
];
const SUBSTACKS = [
  'The Tortoise Portfolio', 'MarketFox Weekly', 'Bahi Khata', 'The Compounding Letter',
  'Dalal Street Memo', 'Moat & Margin', 'The Contrarian Edge', 'IndiaEquity Notes',
  'The Quiet Compounder', 'Bull & Bear Briefing', 'Street Signal', 'Paisa Vasool Research',
];
const SUBREDDITS = [
  'r/IndianStreetBets', 'r/IndianStockMarket', 'r/DalalStreetTalks',
  'r/IndiaInvestments', 'r/StockMarketIndia',
];
const VP_THREADS = ['Investment Ideas', 'Q3 FY26 Results', 'Stock Story', 'Business Analysis', 'Untested Ideas'];

/* ------------------------------ templates ------------------------------ */
const TEMPLATES = {
  reddit: {
    bullish: [
      'Loaded up more {ticker} today. The Q3 order book looks insane and FIIs are quietly accumulating. Multibagger in the making 🚀',
      '{name} finally broke out of its 6-month consolidation and volume confirms it. Holding long term, not selling a single share.',
      'Why is nobody talking about {ticker}?? Balance sheet is cleaner than ever, debt down 30% YoY. Easy hold for me.',
      'Averaged down on {ticker} and now sitting on solid green. Management walks the talk. Diamond hands 💎🙌',
      '{name} concall takeaway: margin expansion + capex mostly done. Re-rating incoming. NFA but I am bullish af.',
      'Booked partial profits in {ticker}, up 60% from my entry. Still my highest conviction bet for FY26.',
    ],
    bearish: [
      '{ticker} is the most overhyped stock on this sub. A P/E like that for this growth? Hard pass. Booked my losses.',
      'Exited {name} completely. Promoter pledging went up again and the latest results were a clear miss.',
      'Everyone shilling {ticker} here will be left holding the bag. Technicals broke down badly today.',
      '{name} down another 4% and the buy-the-dip crowd is awfully quiet now. This is a falling knife.',
      'Sold my entire {ticker} position. Valuations make zero sense and the sector headwinds are very real.',
      'Unpopular opinion: {ticker} is a value trap. Cheap for a reason — been dead money for two years.',
    ],
    neutral: [
      'Anyone tracking {ticker}? It has been ranging for weeks. Waiting for a decisive move before adding.',
      '{name} results out — revenue in line, margins flat. Nothing exciting either way. Holding for now.',
      'Genuine question: is {ticker} a buy at current levels or wait for results next week? DYOR ofc.',
      '{name} announced a board meeting for a possible bonus/split. Could go either way, watching closely.',
      'Charts for {ticker} look neutral — stuck between support and resistance. No trade for me yet.',
      'Rebalanced some allocation out of {ticker} into an index fund. Not bearish, just trimming.',
    ],
  },
  valuepickr: {
    bullish: [
      'Attended the {name} AGM. Management sounded confident on FY26 guidance — 18-20% topline growth with stable margins. The heavy capex cycle is largely behind them, so free cash flow should improve meaningfully. Adding on dips.',
      '{name} continues to be my largest holding. The moat is widening and ROCE has stayed north of 22% for five years straight. A classic compounder — patience will be rewarded here.',
      'Did a deep dive on {ticker} across its last ten annual reports. The consistency of cash flows is remarkable and the working capital cycle has improved every single year. Conviction buy.',
      'The {ticker} quarterly numbers were excellent — operating leverage is finally kicking in. At current valuations the risk-reward looks favourable for a 3-5 year horizon.',
      'Initiating a tracking position in {name}. New management has executed well on deleveraging and the order pipeline gives strong revenue visibility into FY27.',
    ],
    bearish: [
      'I have been steadily reducing my {ticker} position. Receivables have grown faster than revenue for three quarters running — a yellow flag I can no longer ignore.',
      'Concern on {name}: this year the auditor note mentions related-party transactions that were not there earlier. Until there is clarity, I would stay on the sidelines.',
      '{ticker} valuations have run well ahead of fundamentals. The market is pricing in flawless execution for a decade. I have trimmed and will revisit only on a sharp correction.',
      'Exited {name} after the latest results. Management commentary on margins kept shifting the goalposts. Trust, once broken, is hard to rebuild.',
      'The {ticker} thesis is weakening — competitive intensity in the sector is rising and pricing power is clearly eroding. Capital is better deployed elsewhere.',
    ],
    neutral: [
      'Tracking {name} but not yet invested. Business quality is good, however the current valuation offers no margin of safety. On the watchlist for a better entry.',
      'Mixed quarter for {ticker} — strong volume growth offset by raw-material inflation. Net-net the thesis is intact but no reason to add aggressively at these levels.',
      'Can someone who follows {name} closely share views on the new segment they are entering? Trying to gauge whether it actually moves the needle on earnings.',
      '{ticker} remains a hold for me — not adding, not selling. Waiting for two more quarters to confirm whether the turnaround is real.',
      'Have been studying {name}. Solid business, but the cyclical nature means timing matters a lot. Keeping it firmly on the radar.',
    ],
  },
  substack: {
    bullish: [
      'In this week’s letter we make the case for {name}: a structural growth story the street is still underestimating. Our three-year target implies meaningful upside from here.',
      '{ticker} screens as one of the most attractive names in our coverage. The earnings-revision cycle has clearly turned positive and we remain overweight.',
      'Why {name} sits in our model portfolio: durable demand, improving return ratios, and a management team that under-promises and over-delivers.',
      'Our channel checks on {ticker} point to a strong quarter ahead — demand commentary from distributors is the best we have heard in two years.',
    ],
    bearish: [
      'We are flagging {name} as a name to avoid this quarter. The valuation leaves no room for error and consensus estimates look far too optimistic.',
      '{ticker}: our contrarian take is that the market is mispricing the competitive risk. We would wait for a 15-20% de-rating before getting interested.',
      'This week we explain why we exited {name}. The growth narrative is intact, but the price you pay matters — and right now you are clearly overpaying.',
      'Our concern on {ticker} is simple: margins have peaked. The next twelve months are likely a story of multiple compression, not expansion.',
    ],
    neutral: [
      'A balanced look at {name} this week — the bull and bear cases both have merit. We stay on the sidelines until the upcoming results give a clearer read.',
      '{ticker} is a show-me story for us. The strategy is sound on paper; execution over the next two quarters will decide the rating.',
      'We dissect the {name} results: a steady, unspectacular quarter. Nothing here changes our neutral stance — fairly valued at best.',
      'Our note on {ticker} this week is deliberately non-committal. Too many moving parts — regulation, input costs — to take a strong view right now.',
    ],
  },
};

/* ------------------------------ generation ----------------------------- */
const NOW = Date.now();
const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

function pickSource() {
  const r = rand();
  if (r < 0.55) return 'reddit';
  if (r < 0.83) return 'valuepickr';
  return 'substack';
}

function pickSentiment(mood) {
  const pBull = clamp(0.4 + mood * 0.3, 0.14, 0.78);
  const pBear = clamp(0.32 - mood * 0.26, 0.1, 0.7);
  const r = rand();
  if (r < pBull) return 'bullish';
  if (r < pBull + pBear) return 'bearish';
  return 'neutral';
}

function makePost(stock, index, mood) {
  const source = pickSource();
  const sentiment = pickSentiment(mood);
  const ageHours = clamp(Math.pow(rand(), 1.5) * 23.8 + 0.08, 0.05, 23.95);
  const timestamp = new Date(NOW - ageHours * 3600_000).toISOString();
  const text = pick(TEMPLATES[source][sentiment])
    .split('{ticker}').join(stock.ticker)
    .split('{name}').join(stock.name);

  let author, handle, community, url, likes, comments;
  if (source === 'reddit') {
    author = pick(REDDIT_USERS);
    handle = `u/${author}`;
    community = pick(SUBREDDITS);
    url = `https://www.reddit.com/${community}/comments/${id36(6)}/`;
    likes = rint(3, 20) ** 2 % 900 + rint(2, 60);
    comments = rint(0, 90);
  } else if (source === 'valuepickr') {
    author = pick(VP_USERS);
    handle = `@${author}`;
    community = pick(VP_THREADS);
    url = `https://forum.valuepickr.com/t/${stock.ticker.toLowerCase()}/${rint(4000, 99000)}/${rint(1, 380)}`;
    likes = rint(2, 64);
    comments = rint(0, 22);
  } else {
    author = pick(SUBSTACKS);
    handle = `${slugify(author)}.substack.com`;
    community = 'Newsletter';
    url = `https://${slugify(author)}.substack.com/p/${stock.ticker.toLowerCase()}-${rint(100, 999)}`;
    likes = rint(8, 240);
    comments = rint(0, 38);
  }

  return {
    id: `${source}-${stock.ticker}-${index}`,
    source,
    author,
    handle,
    community,
    timestamp,
    text,
    url,
    sentiment,
    likes,
    comments,
  };
}

rmSync(POSTS_DIR, { recursive: true, force: true });
mkdirSync(POSTS_DIR, { recursive: true });

const trending = [];
let totalPosts = 0;
const moodTotals = { bullish: 0, bearish: 0, neutral: 0 };

for (const stock of STOCKS) {
  const mood = rnd(-0.62, 0.72);
  const count = Math.round(clamp(9 + stock.weight * 46 + rnd(-4, 4), 8, 60));
  const posts = Array.from({ length: count }, (_, i) => makePost(stock, i + 1, mood))
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  const sentiment = { bullish: 0, bearish: 0, neutral: 0 };
  const sources = { reddit: 0, valuepickr: 0, substack: 0 };
  const buckets = new Array(12).fill(0);
  for (const p of posts) {
    sentiment[p.sentiment]++;
    sources[p.source]++;
    const ageH = (NOW - new Date(p.timestamp).getTime()) / 3600_000;
    buckets[clamp(Math.floor(ageH / 2), 0, 11)]++;
  }
  moodTotals.bullish += sentiment.bullish;
  moodTotals.bearish += sentiment.bearish;
  moodTotals.neutral += sentiment.neutral;
  totalPosts += count;

  const score = round((sentiment.bullish - sentiment.bearish) / count, 2);
  const label = score > 0.12 ? 'bullish' : score < -0.12 ? 'bearish' : 'neutral';
  const mentionsPrev = Math.max(1, Math.round(count * rnd(0.5, 1.35)));

  writeFileSync(
    join(POSTS_DIR, `${stock.ticker}.json`),
    JSON.stringify(
      {
        ticker: stock.ticker,
        name: stock.name,
        exchange: stock.exchange,
        sector: stock.sector,
        generatedAt: new Date(NOW).toISOString(),
        posts,
      },
      null,
      2,
    ),
  );

  trending.push({
    rank: 0,
    ticker: stock.ticker,
    name: stock.name,
    exchange: stock.exchange,
    sector: stock.sector,
    mentions: count,
    mentionsPrev,
    changePct: round(((count - mentionsPrev) / mentionsPrev) * 100, 1),
    sentiment: { score, label, ...sentiment },
    sources,
    sparkline: buckets.reverse(),
  });
}

trending.sort((a, b) => b.mentions - a.mentions);
trending.forEach((s, i) => (s.rank = i + 1));

const moodSum = moodTotals.bullish + moodTotals.bearish + moodTotals.neutral;
writeFileSync(
  join(DATA_DIR, 'trending.json'),
  JSON.stringify(
    {
      generatedAt: new Date(NOW).toISOString(),
      window: '24h',
      totalPosts,
      totalStocks: STOCKS.length,
      marketMood: {
        ...moodTotals,
        score: round((moodTotals.bullish - moodTotals.bearish) / moodSum, 2),
      },
      stocks: trending,
    },
    null,
    2,
  ),
);

console.log(`Generated trending.json (${trending.length} stocks, ${totalPosts} posts)`);
console.log(`Top 5: ${trending.slice(0, 5).map((s) => `${s.ticker}(${s.mentions})`).join(', ')}`);
