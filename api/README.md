# SentimentDash API

A read-only JSON API over the SentimentDash dataset, for wiring the dashboard's
numbers into another app. Everything the dashboard renders is reachable here:
trending companies, market mood, per-company sentiment and source breakdowns,
the posts behind each company, and the run history behind the sparklines.

It reads the same files the dashboard reads — `public/data/*.json` served from
this repo via GitHub's raw CDN — so it always reflects the latest twice-daily
scrape, and it stays in lockstep with the site. **Nothing in the dashboard was
changed to add this**: the API is a separate entry point (`api/`) with its own
Wrangler config.

## Run it

```bash
node api/server.js                       # live data from the CDN, port 8787
DATA_DIR=public/data node api/server.js  # the checked-out data files instead
node api/selftest.mjs                    # 119 offline assertions
```

Or via npm: `npm run api:dev`, `npm run api:selftest`.

Requires Node 18+ (global `fetch`/`Request`/`Response`). No dependencies.

## Deploy it

The API is a Cloudflare Worker with its own config, deployed separately from the
dashboard Worker:

```bash
npx wrangler dev    -c wrangler.api.jsonc
npx wrangler deploy -c wrangler.api.jsonc   # -> sentimentdash-api.<subdomain>.workers.dev
```

It's a plain Fetch handler (`api/worker.js` → `createApp()`), so it runs equally
well on Node behind any process manager, or on any runtime with Web-standard
`Request`/`Response`.

### Configuration

| Env var             | Default                          | Meaning                                                        |
| ------------------- | -------------------------------- | -------------------------------------------------------------- |
| `DATA_BASE_URL`     | this repo's raw CDN path         | Where to read `trending.json`, `history.json`, `posts/*.json`.   |
| `CACHE_TTL_SECONDS` | `300`                            | How long upstream JSON is memoised in-process.                   |
| `ALLOWED_ORIGINS`   | unset (any origin)               | Comma-separated CORS allow-list.                                 |
| `DATA_DIR`          | unset                            | Node only — read local files instead of the CDN.                 |
| `PORT` / `HOST`     | `8787` / `0.0.0.0`               | Node only.                                                       |

## Conventions

- **Base path.** `/api` and `/v1` are both optional prefixes, so `/v1/stocks`,
  `/api/v1/stocks` and `/stocks` all work — mount it wherever suits you.
- **CORS.** Open by default (`*`), preflight handled. Set `ALLOWED_ORIGINS` to
  restrict it.
- **Caching.** Responses carry `ETag` + `Cache-Control` and honour
  `If-None-Match` (304). `X-Data-Generated-At` is the scrape timestamp.
- **`?pretty=1`** on any endpoint for indented output.
- **Errors** are `{"error":{"status":404,"code":"unknown_ticker","message":"…"}}`.
  Codes: `invalid_param`, `invalid_ticker`, `unknown_ticker`, `unknown_route`,
  `method_not_allowed`, `upstream_error`, `internal_error`.
- **`ticker`** is the routing key the dashboard uses — a forum topic slug such as
  `zomato` or `3b-blackbio-dx`, not an exchange symbol. `exchange` and `sector`
  are empty strings for forum-discovered companies.

## Endpoints

| Endpoint                     | What it gives you                                                     |
| ---------------------------- | --------------------------------------------------------------------- |
| `GET /v1`                    | Self-describing index of every endpoint.                              |
| `GET /v1/health`             | Liveness, upstream latency, data age.                                 |
| `GET /v1/meta`               | Sources, sentiments, sort keys, filter chips, display colours.        |
| `GET /v1/overview`           | The four stat cards + market mood.                                    |
| `GET /v1/dashboard`          | Overview **and** the full ranked list, in one request.                |
| `GET /v1/stocks`             | Trending companies — search, filter, sort, paginate.                  |
| `GET /v1/stocks/{ticker}`    | One company, with post tallies and optional embedded posts.           |
| `GET /v1/stocks/{ticker}/posts` | The conversation behind a company.                                 |
| `GET /v1/posts`              | Cross-company post feed.                                              |
| `GET /v1/history`            | Per-run post totals and market mood over time.                        |
| `GET /v1/history/{ticker}`   | The mention series behind one sparkline.                              |
| `GET /v1/openapi.json`       | OpenAPI 3.1 description for client generation.                        |

### `GET /v1/overview`

The header stats. `mostBullish` and `topMover` are chosen exactly as the
dashboard chooses them (highest sentiment score; highest `changePct`).

```jsonc
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
  "mostBullish": { "rank": 51, "ticker": "growth", "name": "Growth", "mentions": 3, "changePct": 50, "sentimentScore": 1, "sentimentLabel": "bullish" },
  "topMover":    { "rank": 18, "ticker": "guggenheim", "name": "Guggenheim", "mentions": 6, "changePct": 200, "sentimentScore": 0, "sentimentLabel": "neutral" },
  "sourceTotals": { "reddit": 0, "valuepickr": 316, "news": 266, "tradingqna": 21 }
}
```

### `GET /v1/stocks`

| Param         | Values                                                                    | Default    |
| ------------- | ------------------------------------------------------------------------- | ---------- |
| `q`           | free text, matched against ticker and name (as the dashboard's search box) | —          |
| `source`      | `all`, `reddit`, `valuepickr`, `news`, `tradingqna`                        | `all`      |
| `sentiment`   | `all`, `bullish`, `bearish`, `neutral`                                     | `all`      |
| `minMentions` | integer                                                                    | `0`        |
| `sort`        | `trending`, `bullish`, `bearish`, `movers`, `mentions`, `change`, `name`   | `trending` |
| `order`       | `default` (each sort's natural direction), `asc`, `desc`                   | `default`  |
| `limit`       | 1–1000, or `all`                                                           | `100`      |
| `offset`      | integer                                                                    | `0`        |

Each row keeps every raw field and adds the bits the dashboard derives at render
time — `direction`, `sentiment.labelText`/`color`/`total`/`percent`,
`activeSources`, `sourceLabel`, and `links`:

```jsonc
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
  "links": { "self": "…/v1/stocks/fiis", "posts": "…/v1/stocks/fiis/posts", "history": "…/v1/history/fiis" }
}
```

### `GET /v1/stocks/{ticker}`

Adds `counts` (posts by source and sentiment) and `postsGeneratedAt`. If the
company has dropped out of `trending.json` but still has a posts file, its
figures are rebuilt from those posts and `derivedFromPosts` is `true` — the same
fallback the dashboard's detail view uses.

Add `?includePosts=1` to embed the feed; it takes `postLimit`, `postOffset`,
`postSort`, `postQuery`, `source` and `sentiment`.

### `GET /v1/stocks/{ticker}/posts`

| Param       | Values                                             | Default  |
| ----------- | -------------------------------------------------- | -------- |
| `source`    | `all` + the four sources                           | `all`    |
| `sentiment` | `all`, `bullish`, `bearish`, `neutral`             | `all`    |
| `q`         | full text, over body / author / community          | —        |
| `sort`      | `newest`, `oldest`, `likes`, `comments`            | `newest` |
| `limit`     | 1–1000                                             | `100`    |
| `offset`    | integer                                            | `0`      |

`counts.total` is the unfiltered count, `counts.filtered` the count after
filters — the "12 of 40" line on the detail page. Posts carry their raw fields
plus `sourceLabel`, `sourceColor`, `sentimentLabel`, `sentimentColor`.

### `GET /v1/posts`

Cross-company feed. Pass `tickers=a,b,c` (max 25), or omit it and the feed pulls
from the top `stocks` trending companies (default 10, max 25, ordered by
`stockSort`). Takes the same post filters as above; `limit` defaults to 50.

### `GET /v1/history` and `GET /v1/history/{ticker}`

`/history` returns per-run `totalPosts` and market mood, oldest → newest —
roughly 12 days of twice-daily runs. `?limit=n` for the last *n*,
`?includeCounts=1` to include per-ticker counts.

`/history/{ticker}` returns `points: [{ at, mentions }]` plus `latest`,
`previous`, `changePct` and the exact `sparkline` array the dashboard draws.

## Which endpoint gives me which part of the dashboard?

| On screen                                        | Endpoint                             |
| ------------------------------------------------ | ------------------------------------ |
| "Posts analysed" / "Market mood" / "Most bullish" / "Top mover" cards | `/v1/overview` |
| "Last 30d" and "Updated …" in the header         | `generatedAt` + `window` (any endpoint) |
| Trending table rows, rank badge, mention count, % change, sparkline, sentiment bar, source dots | `/v1/stocks` |
| Search box, Trending/Bullish/Bearish/Movers tabs, source chips | `/v1/stocks` query params; chip labels from `/v1/meta` |
| Detail header: mentions, % change, sentiment split, "Where it's discussed" | `/v1/stocks/{ticker}` |
| "The conversation" feed and its filters          | `/v1/stocks/{ticker}/posts`          |
| Source/sentiment labels and colours              | `/v1/meta`                           |
| Whole home screen in one request                 | `/v1/dashboard`                      |

## Consuming it

```ts
import type { DashboardResponse, StockPostsResponse } from './sentimentdash-api-types';

const API = 'https://sentimentdash-api.<subdomain>.workers.dev/v1';

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

const dashboard = await get<DashboardResponse>('/dashboard?limit=all');
const posts = await get<StockPostsResponse>('/stocks/zomato/posts?sentiment=bullish');
```

Response types live in [`api/types.d.ts`](./types.d.ts) — copy it into the
consuming repo, or generate a client from `/v1/openapi.json`.

## Layout

```
api/
  worker.js      Cloudflare Worker entry
  server.js      Node entry + node:http adapter
  selftest.mjs   offline assertions against the checked-in data
  types.d.ts     response types for consumers
  src/
    app.js       runtime-agnostic fetch handler
    routes.js    endpoint handlers + routing
    store.js     upstream reads, memoisation, ticker validation
    transform.js filtering, sorting, derived figures
    meta.js      labels/colours mirrored from the dashboard
    http.js      CORS, JSON, ETags, query parsing
    openapi.js   OpenAPI 3.1 description
wrangler.api.jsonc
```

`meta.js` mirrors the labels and colours in `src/lib/meta.ts`; if those ever
change on the dashboard, update it to match.
