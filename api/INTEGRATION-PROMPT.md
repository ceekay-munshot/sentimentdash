# SentimentDash API — integration prompt

Paste the block below into a session working on the consuming dashboard. Fill in
`<API_BASE_URL>` first (see "Before you paste").

## Before you paste

Set `<API_BASE_URL>` to wherever the API is running:

- Deployed Worker: `https://sentimentdash-api.<your-subdomain>.workers.dev/v1`
  (`npx wrangler deploy -c wrangler.api.jsonc` from the `sentimentdash` repo)
- Local: `http://localhost:8787/v1` (`npm run api:dev`)

Trim the sections the other project doesn't need — the endpoint reference and
the caveats are the parts that matter most.

---

# SentimentDash API — integration spec

I want to wire an existing external API into this dashboard. It is a read-only,
public, CORS-enabled JSON API. No auth, no keys, no rate limits. Everything
below is the complete contract — don't guess at fields.

**Base URL:** `<API_BASE_URL>` (ends in `/v1`)

## What the data is

Companies and topics trending across two Indian retail-investor forums
(ValuePickr, TradingQnA) and Google News, ranked by how often they're mentioned
and scored by sentiment. Source data is re-scraped twice daily (01:30 and 13:30
UTC); `generatedAt` on every response is the scrape timestamp. Polling more than
hourly is pointless.

The measurement window is 30 days (`window: "30d"`). Current scale: ~600 posts
across ~220 entries per run.

## Read these caveats before designing anything

1. **`changePct` is a change in *mention count*, not price.** It compares this
   scrape's mentions against the previous scrape's. There is no price, market
   cap, or return data anywhere in this API. Don't render it as a price move,
   don't colour it like a P&L, don't put a ₹/$ next to it.
2. **`ticker` is not an exchange symbol.** It's a forum-topic slug used as the
   routing key — `zomato`, `fiis`, `3b-blackbio-dx`. `exchange` and `sector` are
   present in the schema but are empty strings for essentially every entry.
3. **Not every entry is a company.** Entries are discovered bottom-up from forum
   topics, so the list also contains brokers (`guggenheim`, `td-cowen`,
   `mizuho`), themes (`nuclear-energy`, `defence`, `small-cap`) and generic
   words (`value`, `growth`, `income`). In a recent run the "top mover" was a
   broker and the "most bullish" was the word "Growth". If that's noise for this
   dashboard, filter it — `minMentions` helps, and an explicit allow/deny list on
   our side helps more. Decide deliberately; don't assume every row is a stock.
4. **Sentiment skews neutral.** A typical run is ~80% neutral, ~14% bullish,
   ~6% bearish. Designs that assume a balanced bull/bear split will look broken.
   Sentiment is keyword-scored, not model-scored — treat it as a coarse signal.
5. **Reddit is a valid source key but is currently 0 everywhere.** Keep it in
   types; don't build UI that assumes it has data.
6. **`sparkline` is a per-run mention series** (oldest → newest, up to 12
   points), not a time-regular series. Points are scrape runs, not days.

## Conventions

- `GET` only. `POST`/`PUT`/etc return 405.
- Optional path prefixes: `/v1/stocks`, `/api/v1/stocks` and `/stocks` all work.
- CORS is open (`*`), preflight handled — call it straight from the browser.
- `ETag` + `Cache-Control` on every response; `If-None-Match` returns 304.
  `X-Data-Generated-At` carries the scrape timestamp.
- `?pretty=1` on any endpoint for indented output.
- Errors: `{"error":{"status":404,"code":"unknown_ticker","message":"…"}}`.
  Codes: `invalid_param`, `invalid_ticker`, `unknown_ticker`, `unknown_route`,
  `method_not_allowed`, `upstream_error`, `internal_error`.
- Out-of-range or unknown query params are rejected with 400 rather than
  silently clamped — validate before sending, or handle the 400.

## Endpoints

| Endpoint | Returns |
|---|---|
| `GET /dashboard` | Overview **+** the full ranked list in one request. Start here. |
| `GET /overview` | Headline stats: totals, market mood, most bullish, top mover. |
| `GET /stocks` | The ranked list. Search / filter / sort / paginate. |
| `GET /stocks/{ticker}` | One entry: tallies, source breakdown, optional posts. |
| `GET /stocks/{ticker}/posts` | The posts behind one entry. |
| `GET /posts` | Cross-entry post feed. |
| `GET /history` | Per-run post totals and market mood over time (~12 days). |
| `GET /history/{ticker}` | Mention series behind one sparkline. |
| `GET /meta` | Source/sentiment labels, hex colours, sort + filter options. |
| `GET /health` | Status, data age in seconds, upstream latency. |
| `GET /openapi.json` | OpenAPI 3.1 — generate a client from this if you prefer. |

### `GET /stocks` (and `/dashboard`) query params

| Param | Values | Default |
|---|---|---|
| `q` | free text, matched against ticker and name | — |
| `source` | `all` \| `reddit` \| `valuepickr` \| `news` \| `tradingqna` | `all` |
| `sentiment` | `all` \| `bullish` \| `bearish` \| `neutral` | `all` |
| `minMentions` | integer | `0` |
| `sort` | `trending` \| `bullish` \| `bearish` \| `movers` \| `mentions` \| `change` \| `name` | `trending` |
| `order` | `default` (each sort's natural direction) \| `asc` \| `desc` | `default` |
| `limit` | 1–1000, or the literal `all` | `100` (`/dashboard`: `500`) |
| `offset` | integer | `0` |

### `GET /stocks/{ticker}/posts` query params

| Param | Values | Default |
|---|---|---|
| `source` | `all` + the four source keys | `all` |
| `sentiment` | `all` \| `bullish` \| `bearish` \| `neutral` | `all` |
| `q` | full text over post body, author, community | — |
| `sort` | `newest` \| `oldest` \| `likes` \| `comments` | `newest` |
| `limit` | 1–1000 | `100` |
| `offset` | integer | `0` |

`counts.total` is the unfiltered count and `counts.filtered` the post-filter
count — that's the "12 of 40" pattern.

### `GET /stocks/{ticker}` extras

`?includePosts=1` embeds the feed, with `postLimit`, `postOffset`, `postSort`,
`postQuery`, `source`, `sentiment`. Response also carries `inTrending` and
`derivedFromPosts` — when an entry has dropped out of the ranked list, its
figures are rebuilt from its posts file and `rank` is `null`. Handle `rank:
null`.

### `GET /posts` extras

Pass `tickers=a,b,c` (max 25), or omit it and the feed pulls from the top
`stocks` entries (default 10, max 25) ordered by `stockSort`. Same post filters
as above; `limit` defaults to 50, max 500. Response includes `missing[]` for
requested tickers with no posts file.

### `GET /history` extras

`?limit=n` for the last *n* runs, `?includeCounts=1` to include per-ticker
mention counts per run (large — omit unless you need it).

## Real responses

`GET /overview`:

```json
{
  "generatedAt": "2026-08-13T14:35:02.862Z",
  "window": "30d",
  "totalPosts": 603,
  "totalStocks": 219,
  "marketMood": {
    "bullish": 86, "bearish": 34, "neutral": 483, "total": 603,
    "score": 0.09, "label": "neutral", "labelText": "Neutral",
    "percent": { "bullish": 14.3, "bearish": 5.6, "neutral": 80.1 }
  },
  "mostBullish": {
    "rank": 51, "ticker": "growth", "name": "Growth", "mentions": 3,
    "changePct": 50, "sentimentScore": 1, "sentimentLabel": "bullish"
  },
  "topMover": {
    "rank": 18, "ticker": "guggenheim", "name": "Guggenheim", "mentions": 6,
    "changePct": 200, "sentimentScore": 0, "sentimentLabel": "neutral"
  },
  "sourceTotals": { "reddit": 0, "valuepickr": 316, "news": 266, "tradingqna": 21 }
}
```

`GET /stocks?limit=1` — one element of `stocks[]`:

```json
{
  "rank": 1, "ticker": "fiis", "name": "FIIs", "exchange": "", "sector": "",
  "mentions": 22, "mentionsPrev": 21, "changePct": 4.8, "direction": "up",
  "sentiment": {
    "score": 0.09, "label": "neutral", "labelText": "Neutral", "color": "#8b91ab",
    "bullish": 2, "bearish": 0, "neutral": 20, "total": 22,
    "percent": { "bullish": 9.1, "bearish": 0, "neutral": 90.9 }
  },
  "sources": { "reddit": 0, "valuepickr": 0, "news": 3, "tradingqna": 19 },
  "activeSources": ["news", "tradingqna"],
  "sourceLabel": "Google News · TradingQnA",
  "sparkline": [0, 0, 0, 0, 0, 21, 23, 23, 24, 22, 21, 22],
  "links": {
    "self": "…/v1/stocks/fiis",
    "posts": "…/v1/stocks/fiis/posts",
    "history": "…/v1/history/fiis"
  }
}
```

The wrapper around `stocks[]` is `{ generatedAt, window, filters, pagination,
stocks }` where `pagination` is `{ total, count, limit, offset, hasMore }`.
`/dashboard` adds an `overview` key holding the object above.

One element of `posts[]`:

```json
{
  "id": "tradingqna-tqna-536244",
  "source": "tradingqna",
  "author": "Jayakumar",
  "handle": "@Jayakumar",
  "community": "TradingQnA",
  "timestamp": "2026-08-13T13:34:10.480Z",
  "text": "FIIs in Index futures and options — image 1228×355 80 KB",
  "url": "https://tradingqna.com/t/…",
  "sentiment": "neutral",
  "likes": 0,
  "comments": 0,
  "ticker": "fiis",
  "sourceLabel": "TradingQnA",
  "sourceColor": "#4ea3e0",
  "sentimentLabel": "Neutral",
  "sentimentColor": "#8b91ab"
}
```

`GET /history/{ticker}`:

```json
{
  "ticker": "fiis", "name": "FIIs", "updatedAt": "2026-08-13T14:35:02.862Z",
  "latest": 22, "previous": 21, "changePct": 4.8,
  "sparkline": [0, 0, 0, 0, 0, 21, 23, 23, 24, 22, 21, 22],
  "points": [{ "at": "2026-08-02T04:51:34.502Z", "mentions": 0 }]
}
```

## Types

```ts
export type Source = 'reddit' | 'valuepickr' | 'news' | 'tradingqna';
export type Sentiment = 'bullish' | 'bearish' | 'neutral';
export type Direction = 'up' | 'down' | 'flat';
export type SourceCounts = Record<Source, number>;
export type SentimentCounts = Record<Sentiment, number>;

export interface Pagination {
  total: number; count: number; limit: number; offset: number; hasMore: boolean;
}

export interface Stock {
  rank: number | null;            // null when rebuilt from posts
  ticker: string;                 // forum-topic slug, NOT an exchange symbol
  name: string;
  exchange: string;               // effectively always ""
  sector: string;                 // effectively always ""
  mentions: number;
  mentionsPrev: number;
  changePct: number;              // change in MENTIONS, not price
  direction: Direction;
  sentiment: SentimentCounts & {
    score: number;                // -1 (all bearish) .. 1 (all bullish)
    label: Sentiment;
    labelText: string;            // "Bullish"
    color: string;                // hex
    total: number;
    percent: SentimentCounts;     // 0..100, sums to ~100
  };
  sources: SourceCounts;
  activeSources: Source[];        // sources with at least one post
  sourceLabel: string;            // "Google News · TradingQnA"
  sparkline: number[];            // per-run mentions, oldest -> newest
  links: { self: string; posts: string; history: string };
}

export interface CompactStock {
  rank: number | null; ticker: string; name: string; mentions: number;
  changePct: number; sentimentScore: number; sentimentLabel: Sentiment;
}

export interface OverviewResponse {
  generatedAt: string; window: string; totalPosts: number; totalStocks: number;
  marketMood: SentimentCounts & {
    total: number; score: number; label: Sentiment; labelText: string;
    percent: SentimentCounts;
  };
  mostBullish: CompactStock | null;
  topMover: CompactStock | null;
  sourceTotals: SourceCounts;
}

export interface StocksResponse {
  generatedAt: string; window: string;
  filters: {
    q: string | null; source: Source | 'all'; sentiment: Sentiment | 'all';
    minMentions: number; sort: string; order: 'default' | 'asc' | 'desc';
    limit: number; offset: number;
  };
  pagination: Pagination;
  stocks: Stock[];
}

export interface DashboardResponse extends StocksResponse {
  overview: OverviewResponse;
}

export interface Post {
  id: string; source: Source; author: string; handle: string; community: string;
  timestamp: string;            // ISO 8601
  text: string; url: string; sentiment: Sentiment; likes: number; comments: number;
  ticker?: string;
  sourceLabel: string; sourceColor: string | null;
  sentimentLabel: string; sentimentColor: string | null;
}

export interface PostCounts {
  total: number; bySource: SourceCounts; bySentiment: SentimentCounts;
  filtered?: number;
}

export interface StockResponse {
  generatedAt: string; window: string;
  inTrending: boolean; derivedFromPosts: boolean;
  stock: Stock; counts: PostCounts; postsGeneratedAt: string | null;
  posts?: Post[];               // with ?includePosts=1
  postPagination?: Pagination;
}

export interface StockPostsResponse {
  ticker: string; name: string; exchange: string; sector: string;
  generatedAt: string; counts: PostCounts; pagination: Pagination; posts: Post[];
}

export interface TickerHistoryResponse {
  ticker: string; name: string; updatedAt: string | null;
  latest: number; previous: number; changePct: number;
  sparkline: number[]; points: Array<{ at: string; mentions: number }>;
}

export interface ApiError {
  error: { status: number; code: string; message: string };
}
```

## Client sketch

```ts
const API = '<API_BASE_URL>';

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, init);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiError | null;
    throw new Error(body?.error?.message ?? `${path} failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

const dashboard = await api<DashboardResponse>('/dashboard?limit=all');
const bullish = await api<StocksResponse>('/stocks?sort=bullish&minMentions=3&limit=20');
const posts = await api<StockPostsResponse>('/stocks/zomato/posts?sentiment=bullish');
```

## Sanity checks before you build

Run these and read the output — the shapes above are exact, but the *content*
moves with each scrape:

```bash
curl -s '<API_BASE_URL>/health?pretty=1'
curl -s '<API_BASE_URL>/overview?pretty=1'
curl -s '<API_BASE_URL>/stocks?limit=3&pretty=1'
```

If `/health` fails, the API isn't deployed or running — stop and tell me rather
than mocking the data.

## Your task

Wire this API into this dashboard. Specifically:

1. Add a typed client for the endpoints we actually use (the types above are
   authoritative — copy them in rather than re-deriving).
2. Match this project's existing data-fetching conventions — look at how other
   remote data is loaded here and follow that, don't introduce a new pattern.
3. Handle the states that matter: loading, request failure, 304/cached, empty
   result after filtering, and `rank: null`.
4. Surface `generatedAt` so the user can see how stale the data is. `/health`
   gives `ageSeconds` directly.
5. Respect the caveats above — especially that `changePct` is mention volume,
   not price, and that not every entry is a tradeable company.

Ask me before designing new UI surfaces. Start by proposing where this data
should live in the existing information architecture.
