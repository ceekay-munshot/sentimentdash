/** Hand-maintained OpenAPI 3.1 description, so consumers can generate clients. */
import { SENTIMENT_ORDER, SOURCE_ORDER } from './meta.js';
import { POST_SORT_KEYS, STOCK_SORT_KEYS } from './transform.js';

const sourceKeys = ['all', ...SOURCE_ORDER];
const sentimentKeys = ['all', ...SENTIMENT_ORDER];

const param = (name, schema, description, location = 'query') => ({
  name,
  in: location,
  required: location === 'path',
  description,
  schema,
});

const stockListParams = [
  param('q', { type: 'string' }, 'Case-insensitive match against ticker or company name.'),
  param('source', { type: 'string', enum: sourceKeys, default: 'all' }, 'Keep companies with at least one post from this source.'),
  param('sentiment', { type: 'string', enum: sentimentKeys, default: 'all' }, 'Keep companies with this sentiment label.'),
  param('minMentions', { type: 'integer', minimum: 0 }, 'Minimum mention count.'),
  param('sort', { type: 'string', enum: STOCK_SORT_KEYS, default: 'trending' }, 'Sort order.'),
  param('order', { type: 'string', enum: ['default', 'asc', 'desc'], default: 'default' }, 'Flip the sort direction.'),
  param('limit', { type: 'integer', minimum: 1, maximum: 1000 }, 'Page size (`all` for the maximum).'),
  param('offset', { type: 'integer', minimum: 0 }, 'Page offset.'),
];

const postListParams = [
  param('source', { type: 'string', enum: sourceKeys, default: 'all' }, 'Filter by source.'),
  param('sentiment', { type: 'string', enum: sentimentKeys, default: 'all' }, 'Filter by sentiment.'),
  param('q', { type: 'string' }, 'Full-text match against post body, author and community.'),
  param('sort', { type: 'string', enum: POST_SORT_KEYS, default: 'newest' }, 'Sort order.'),
  param('limit', { type: 'integer', minimum: 1, maximum: 1000 }, 'Page size.'),
  param('offset', { type: 'integer', minimum: 0 }, 'Page offset.'),
];

const jsonResponse = (description) => ({
  description,
  content: { 'application/json': { schema: { type: 'object' } } },
});

const errorResponses = {
  400: jsonResponse('Invalid query parameter.'),
  404: jsonResponse('Unknown ticker.'),
  502: jsonResponse('Upstream data unavailable.'),
};

/**
 * @param {string} serverUrl absolute base URL the request came in on
 */
export function openapiDocument(serverUrl) {
  const tickerParam = param('ticker', { type: 'string' }, 'Company key (the forum topic slug used as the routing id).', 'path');

  return {
    openapi: '3.1.0',
    info: {
      title: 'SentimentDash API',
      version: '1.0.0',
      description:
        'Read-only JSON API over the SentimentDash dataset: companies trending across the ' +
        'ValuePickr and TradingQnA forums and Google News, ranked by buzz and scored by sentiment. ' +
        'Every figure the dashboard renders is available here.',
    },
    servers: [{ url: serverUrl }],
    paths: {
      '/health': {
        get: { summary: 'Liveness and data freshness.', responses: { 200: jsonResponse('Service status.') } },
      },
      '/meta': {
        get: {
          summary: 'Sources, sentiments, sort keys, filters and display colours.',
          responses: { 200: jsonResponse('Presentation metadata.'), ...errorResponses },
        },
      },
      '/overview': {
        get: {
          summary: 'Stat cards: posts analysed, market mood, most bullish, top mover.',
          responses: { 200: jsonResponse('Dashboard overview.'), ...errorResponses },
        },
      },
      '/dashboard': {
        get: {
          summary: 'Overview plus the full ranked stock list in a single call.',
          parameters: stockListParams,
          responses: { 200: jsonResponse('Everything the home screen shows.'), ...errorResponses },
        },
      },
      '/stocks': {
        get: {
          summary: 'Trending companies.',
          parameters: stockListParams,
          responses: { 200: jsonResponse('Paginated stock list.'), ...errorResponses },
        },
      },
      '/stocks/{ticker}': {
        get: {
          summary: 'A single company, with post tallies and optional posts.',
          parameters: [
            tickerParam,
            param('includePosts', { type: 'boolean', default: false }, 'Embed the posts for this company.'),
            param('postLimit', { type: 'integer', minimum: 1, maximum: 1000 }, 'Embedded post page size.'),
            param('postOffset', { type: 'integer', minimum: 0 }, 'Embedded post page offset.'),
            param('postSort', { type: 'string', enum: POST_SORT_KEYS, default: 'newest' }, 'Embedded post sort.'),
            param('postQuery', { type: 'string' }, 'Full-text filter for embedded posts.'),
            param('source', { type: 'string', enum: sourceKeys, default: 'all' }, 'Embedded post source filter.'),
            param('sentiment', { type: 'string', enum: sentimentKeys, default: 'all' }, 'Embedded post sentiment filter.'),
          ],
          responses: { 200: jsonResponse('Company detail.'), ...errorResponses },
        },
      },
      '/stocks/{ticker}/posts': {
        get: {
          summary: 'The conversation behind one company.',
          parameters: [tickerParam, ...postListParams],
          responses: { 200: jsonResponse('Paginated posts.'), ...errorResponses },
        },
      },
      '/posts': {
        get: {
          summary: 'Cross-company post feed (defaults to the top trending companies).',
          parameters: [
            param('tickers', { type: 'string' }, 'Comma-separated tickers (max 25). Omit to use the top trending companies.'),
            param('stocks', { type: 'integer', minimum: 1, maximum: 25, default: 10 }, 'How many trending companies to pull from when `tickers` is omitted.'),
            param('stockSort', { type: 'string', enum: STOCK_SORT_KEYS, default: 'trending' }, 'How to pick those companies.'),
            ...postListParams,
          ],
          responses: { 200: jsonResponse('Merged post feed.'), ...errorResponses },
        },
      },
      '/history': {
        get: {
          summary: 'Per-run totals and market mood over time.',
          parameters: [
            param('limit', { type: 'integer', minimum: 1, maximum: 500 }, 'Most recent N runs.'),
            param('includeCounts', { type: 'boolean', default: false }, 'Include per-ticker mention counts for each run.'),
          ],
          responses: { 200: jsonResponse('Run history.'), ...errorResponses },
        },
      },
      '/history/{ticker}': {
        get: {
          summary: 'Mention series behind one sparkline.',
          parameters: [tickerParam],
          responses: { 200: jsonResponse('Per-run mention counts.'), ...errorResponses },
        },
      },
    },
  };
}
