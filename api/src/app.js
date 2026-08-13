/**
 * Runtime-agnostic application factory.
 *
 * `createApp` returns something with a `fetch(request) => Promise<Response>`
 * signature, which is exactly a Cloudflare Worker handler and — via the small
 * adapter in `api/server.js` — a Node server too.
 */
import { HttpError, boolParam, corsHeaders, errorResponse, json } from './http.js';
import { DEFAULT_DATA_BASE, createStore } from './store.js';
import { resolve } from './routes.js';

/**
 * @param {object} options
 * @param {Record<string, string|undefined>} [options.env]
 *   `DATA_BASE_URL`, `CACHE_TTL_SECONDS`, `ALLOWED_ORIGINS`.
 * @param {(path: string) => Promise<string|null>} [options.readLocal]
 *   Optional local-file reader (Node only) used instead of the CDN.
 */
export function createApp({ env = {}, readLocal = null } = {}) {
  const allowedOrigins = env.ALLOWED_ORIGINS;
  const ttlSeconds = Number.parseInt(env.CACHE_TTL_SECONDS ?? '', 10);
  const store = createStore({
    baseUrl: env.DATA_BASE_URL || DEFAULT_DATA_BASE,
    ttlMs: Number.isFinite(ttlSeconds) ? Math.max(0, ttlSeconds) * 1000 : 300_000,
    readLocal,
  });

  /** @param {Request} request */
  async function fetchHandler(request) {
    const url = new URL(request.url);
    const pretty = boolParam(url, 'pretty');
    const responseOptions = { request, allowedOrigins, pretty };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request, allowedOrigins) });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return errorResponse(
        new HttpError(405, 'method_not_allowed', 'This API is read-only; use GET.'),
        responseOptions,
      );
    }

    const route = resolve(url.pathname);
    if (!route) {
      return errorResponse(
        new HttpError(
          404,
          'unknown_route',
          `No route for ${url.pathname}. See ${url.origin}/v1 for the endpoint list.`,
        ),
        responseOptions,
      );
    }

    const link = (path) => `${url.origin}${route.prefix}${path}`;

    try {
      const body = await route.handler({ store, url, link, params: route.params, request });
      return json(body, {
        ...responseOptions,
        cacheSeconds: route.handler.cacheSeconds ?? 60,
        generatedAt: body?.generatedAt ?? body?.data?.generatedAt ?? undefined,
      });
    } catch (err) {
      return errorResponse(err, responseOptions);
    }
  }

  return { fetch: fetchHandler, store };
}
