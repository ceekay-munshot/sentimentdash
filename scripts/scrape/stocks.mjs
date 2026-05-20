/**
 * The stock universe the scrapers track, plus the alias matcher that decides
 * which stock(s) a piece of text is about.
 *
 * Aliases are kept deliberately specific (full company phrases, distinctive
 * tickers/nicknames) to avoid false positives — e.g. bare "adani" or "bajaj"
 * are omitted because they match several listed group companies.
 */

export const STOCKS = [
  { ticker: 'RELIANCE', name: 'Reliance Industries', exchange: 'NSE', sector: 'Energy', aliases: ['reliance', 'reliance industries', 'ril'] },
  { ticker: 'TATAMOTORS', name: 'Tata Motors', exchange: 'NSE', sector: 'Automobile', aliases: ['tata motors', 'tatamotors', 'tamo'] },
  { ticker: 'SUZLON', name: 'Suzlon Energy', exchange: 'NSE', sector: 'Renewables', aliases: ['suzlon', 'suzlon energy'] },
  { ticker: 'HDFCBANK', name: 'HDFC Bank', exchange: 'NSE', sector: 'Banking', aliases: ['hdfc bank', 'hdfcbank', 'hdfcb'] },
  { ticker: 'IRFC', name: 'Indian Railway Finance Corp', exchange: 'NSE', sector: 'PSU · Financials', aliases: ['irfc', 'indian railway finance'] },
  { ticker: 'ADANIENT', name: 'Adani Enterprises', exchange: 'NSE', sector: 'Conglomerate', aliases: ['adani enterprises', 'adanient', 'adani ent'] },
  { ticker: 'INFY', name: 'Infosys', exchange: 'NSE', sector: 'IT Services', aliases: ['infosys', 'infy'] },
  { ticker: 'ZOMATO', name: 'Zomato', exchange: 'NSE', sector: 'Internet', aliases: ['zomato'] },
  { ticker: 'YESBANK', name: 'Yes Bank', exchange: 'NSE', sector: 'Banking', aliases: ['yes bank', 'yesbank'] },
  { ticker: 'TATAPOWER', name: 'Tata Power', exchange: 'NSE', sector: 'Power', aliases: ['tata power', 'tatapower'] },
  { ticker: 'ICICIBANK', name: 'ICICI Bank', exchange: 'NSE', sector: 'Banking', aliases: ['icici bank', 'icicibank', 'icici'] },
  { ticker: 'IRCTC', name: 'Indian Railway Catering & Tourism', exchange: 'NSE', sector: 'PSU · Travel', aliases: ['irctc'] },
  { ticker: 'TCS', name: 'Tata Consultancy Services', exchange: 'NSE', sector: 'IT Services', aliases: ['tcs', 'tata consultancy'] },
  { ticker: 'HAL', name: 'Hindustan Aeronautics', exchange: 'NSE', sector: 'PSU · Defence', aliases: ['hal', 'hindustan aeronautics'] },
  { ticker: 'PAYTM', name: 'One97 Communications', exchange: 'NSE', sector: 'Fintech', aliases: ['paytm', 'one97'] },
  { ticker: 'SBIN', name: 'State Bank of India', exchange: 'NSE', sector: 'PSU · Banking', aliases: ['sbin', 'sbi', 'state bank of india', 'state bank'] },
  { ticker: 'BHARTIARTL', name: 'Bharti Airtel', exchange: 'NSE', sector: 'Telecom', aliases: ['bharti airtel', 'airtel', 'bhartiartl', 'bharti'] },
  { ticker: 'TATASTEEL', name: 'Tata Steel', exchange: 'NSE', sector: 'Metals', aliases: ['tata steel', 'tatasteel'] },
  { ticker: 'ITC', name: 'ITC', exchange: 'NSE', sector: 'FMCG', aliases: ['itc'] },
  { ticker: 'BAJFINANCE', name: 'Bajaj Finance', exchange: 'NSE', sector: 'NBFC', aliases: ['bajaj finance', 'bajfinance', 'bajfin'] },
];

export const STOCK_BY_TICKER = new Map(STOCKS.map((s) => [s.ticker, s]));

/** Most stock-mention posts realistically name a handful of names; anything
 *  beyond this is a watchlist dump with no per-stock signal, so it is dropped. */
export const MAX_TICKERS_PER_POST = 5;

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// One word-boundary regex per stock. Boundaries exclude letters/digits so
// "$RELIANCE" and "RELIANCE." match but "reliances" / "halt" do not.
const MATCHERS = STOCKS.map((s) => {
  const terms = [...new Set([s.ticker, ...s.aliases].map((t) => t.toLowerCase()))]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegex);
  return { ticker: s.ticker, re: new RegExp(`(?<![a-z0-9])(?:${terms.join('|')})(?![a-z0-9])`) };
});

/** Returns the tickers mentioned in `text` (case-insensitive), de-duplicated. */
export function matchTickers(text) {
  const low = String(text || '').toLowerCase();
  const hits = [];
  for (const m of MATCHERS) {
    if (m.re.test(low)) hits.push(m.ticker);
  }
  return hits;
}
