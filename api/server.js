#!/usr/bin/env node
/**
 * Node entry point — the same app the Worker serves, behind `node:http`.
 *
 *   node api/server.js                       # reads the live data from GitHub
 *   DATA_DIR=public/data node api/server.js  # reads the checked-out data files
 *
 * Env: PORT, HOST, DATA_DIR, DATA_BASE_URL, ALLOWED_ORIGINS, CACHE_TTL_SECONDS.
 * Requires Node 18+ (global fetch / Request / Response).
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { isAbsolute, join, normalize, resolve as resolvePath } from 'node:path';
import { createApp } from './src/app.js';

/**
 * Reads `public/data/<path>` from disk. Returns `null` for a missing file so
 * the store can turn that into a 404 rather than a 500.
 *
 * @param {string} dir
 */
export function localReader(dir) {
  const root = isAbsolute(dir) ? normalize(dir) : resolvePath(process.cwd(), dir);
  return async (path) => {
    const target = normalize(join(root, path));
    // The store validates tickers before we get here; belt and braces.
    if (target !== root && !target.startsWith(`${root}/`)) return null;
    try {
      return await readFile(target, 'utf8');
    } catch (err) {
      if (err?.code === 'ENOENT' || err?.code === 'ENOTDIR') return null;
      throw err;
    }
  };
}

/** @param {Record<string, string|undefined>} [env] */
export function createNodeApp(env = process.env) {
  return createApp({
    env,
    readLocal: env.DATA_DIR ? localReader(env.DATA_DIR) : null,
  });
}

/**
 * Bridges a `node:http` request/response pair onto the Fetch-style handler.
 *
 * @param {ReturnType<typeof createApp>} app
 */
export function nodeListener(app) {
  return async (req, res) => {
    const host = req.headers.host ?? 'localhost';
    const protocol = req.headers['x-forwarded-proto'] ?? 'http';
    const request = new Request(new URL(req.url ?? '/', `${protocol}://${host}`), {
      method: req.method,
      headers: /** @type {any} */ (req.headers),
    });

    try {
      const response = await app.fetch(request);
      const headers = Object.fromEntries(response.headers.entries());
      res.writeHead(response.status, headers);
      if (req.method === 'HEAD' || response.status === 304 || !response.body) {
        res.end();
        return;
      }
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (err) {
      console.error('[api] request failed:', err);
      res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: { status: 500, code: 'internal_error', message: 'Request failed.' } }));
    }
  };
}

/** @param {Record<string, string|undefined>} [env] */
export function startServer(env = process.env) {
  const app = createNodeApp(env);
  const server = createServer(nodeListener(app));
  const port = Number.parseInt(env.PORT ?? '8787', 10);
  const host = env.HOST ?? '0.0.0.0';
  return new Promise((done) => {
    server.listen(port, host, () => {
      const { source } = app.store.describe();
      console.log(`sentimentdash-api listening on http://${host}:${port}/v1 (data: ${source})`);
      done(server);
    });
  });
}

// Only start when executed directly, so tests can import the pieces above.
if (process.argv[1] && import.meta.url === `file://${resolvePath(process.argv[1])}`) {
  startServer();
}
