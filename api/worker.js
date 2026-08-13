/**
 * Cloudflare Worker entry point.
 *
 *   npx wrangler dev    -c wrangler.api.jsonc
 *   npx wrangler deploy -c wrangler.api.jsonc
 *
 * Deploys as its own Worker; the dashboard's own `wrangler.jsonc` is untouched.
 */
import { createApp } from './src/app.js';

/** @type {ReturnType<typeof createApp> | null} */
let app = null;
let appEnv = null;

export default {
  /**
   * @param {Request} request
   * @param {Record<string, string|undefined>} env
   */
  fetch(request, env) {
    // Rebuild only when the bindings change, so the data cache survives between
    // requests on a warm isolate.
    if (!app || appEnv !== env) {
      app = createApp({ env: env ?? {} });
      appEnv = env;
    }
    return app.fetch(request);
  },
};
