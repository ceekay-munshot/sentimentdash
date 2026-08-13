/** Request/response plumbing: CORS, JSON encoding, ETags, typed errors. */

export class HttpError extends Error {
  /**
   * @param {number} status
   * @param {string} code   stable machine-readable code
   * @param {string} message
   */
  constructor(status, code, message) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

export const badRequest = (message, code = 'bad_request') => new HttpError(400, code, message);
export const notFound = (message, code = 'not_found') => new HttpError(404, code, message);

/**
 * Resolves the CORS origin to echo back. `ALLOWED_ORIGINS` is a comma-separated
 * allow-list; unset means "any origin" (this data is public and read-only).
 */
export function resolveOrigin(request, allowedOrigins) {
  const requestOrigin = request.headers.get('Origin');
  if (!allowedOrigins) return '*';
  const allowed = allowedOrigins
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  if (allowed.length === 0 || allowed.includes('*')) return '*';
  if (requestOrigin && allowed.includes(requestOrigin)) return requestOrigin;
  return allowed[0];
}

export function corsHeaders(request, allowedOrigins) {
  const origin = resolveOrigin(request, allowedOrigins);
  const headers = {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, HEAD, OPTIONS',
    'access-control-allow-headers': 'Content-Type, If-None-Match',
    'access-control-max-age': '86400',
    'access-control-expose-headers': 'ETag, X-Data-Generated-At',
  };
  if (origin !== '*') headers.vary = 'Origin';
  return headers;
}

/** FNV-1a — small, dependency-free, and plenty for an ETag. */
function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * @param {unknown} data
 * @param {object} options
 * @param {Request} options.request
 * @param {string} [options.allowedOrigins]
 * @param {number} [options.status]
 * @param {number} [options.cacheSeconds]
 * @param {string} [options.generatedAt]
 * @param {boolean} [options.pretty]
 */
export function json(data, options) {
  const {
    request,
    allowedOrigins,
    status = 200,
    cacheSeconds = 60,
    generatedAt,
    pretty = false,
  } = options;

  const body = pretty ? `${JSON.stringify(data, null, 2)}\n` : JSON.stringify(data);
  const etag = `W/"${hash(body)}"`;
  const headers = {
    ...corsHeaders(request, allowedOrigins),
    'content-type': 'application/json; charset=utf-8',
    'cache-control':
      status === 200 && cacheSeconds > 0
        ? `public, max-age=${cacheSeconds}, stale-while-revalidate=${cacheSeconds * 5}`
        : 'no-store',
    etag,
  };
  if (generatedAt) headers['x-data-generated-at'] = generatedAt;

  if (status === 200 && request.headers.get('If-None-Match') === etag) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(request.method === 'HEAD' ? null : body, { status, headers });
}

/**
 * @param {unknown} err
 * @param {{ request: Request, allowedOrigins?: string, pretty?: boolean }} options
 */
export function errorResponse(err, options) {
  const isHttp = err instanceof HttpError;
  const status = isHttp ? err.status : 500;
  const code = isHttp ? err.code : 'internal_error';
  const message = isHttp ? err.message : 'Unexpected error handling the request.';
  if (!isHttp) console.error('[api] unhandled error:', err);
  return json({ error: { status, code, message } }, { ...options, status, cacheSeconds: 0 });
}

/* ------------------------------ query parsing ----------------------------- */

/**
 * @param {URL} url
 * @param {string} name
 * @param {number} fallback
 * @param {{ min?: number, max?: number }} [bounds]
 */
export function intParam(url, name, fallback, bounds = {}) {
  const raw = url.searchParams.get(name);
  if (raw === null || raw === '') return fallback;
  const { min = 0, max = Number.MAX_SAFE_INTEGER } = bounds;
  if (raw === 'all' && name === 'limit') return max;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) throw badRequest(`\`${name}\` must be an integer.`, 'invalid_param');
  if (value < min || value > max) {
    throw badRequest(`\`${name}\` must be between ${min} and ${max}.`, 'invalid_param');
  }
  return value;
}

/**
 * @param {URL} url
 * @param {string} name
 * @param {string[]} allowed
 * @param {string} fallback
 */
export function enumParam(url, name, allowed, fallback) {
  const raw = url.searchParams.get(name);
  if (raw === null || raw === '') return fallback;
  const value = raw.toLowerCase();
  if (!allowed.includes(value)) {
    throw badRequest(
      `\`${name}\` must be one of: ${allowed.join(', ')}.`,
      'invalid_param',
    );
  }
  return value;
}

/** @param {URL} url @param {string} name */
export function boolParam(url, name, fallback = false) {
  const raw = url.searchParams.get(name);
  if (raw === null) return fallback;
  if (raw === '') return true;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

/** @param {URL} url @param {string} name */
export function stringParam(url, name) {
  const raw = url.searchParams.get(name);
  const value = raw?.trim();
  return value ? value : null;
}
