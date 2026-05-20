/**
 * Scraper entry point — run twice a day by .github/workflows/scrape.yml.
 *
 *   node scripts/scrape/run.mjs
 *
 * Scrapes the investor forums, builds the dashboard data contract and writes
 * it to public/data. If scraping yields nothing it exits non-zero WITHOUT
 * writing, so a failed run never overwrites the last good data.
 *
 * ValuePickr discovers the companies (one forum topic ≈ one company). Google
 * News headlines are free-text, so entities.mjs tags them onto those companies
 * before aggregation. Reddit and Substack stay parked: both block datacenter
 * IPs (CI) behind bot-protection.
 */
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchValuePickrPosts } from './sources/valuepickr.mjs';
import { fetchGoogleNewsPosts } from './sources/googlenews.mjs';
import { buildCompanyIndex, tagByEntities } from './entities.mjs';
import { loadHistory } from './history.mjs';
import { buildData } from './aggregate.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DATA_DIR = join(ROOT, 'public', 'data');
const POSTS_DIR = join(DATA_DIR, 'posts');
const HISTORY_FILE = join(DATA_DIR, 'history.json');

const writeJSON = (path, obj) => writeFileSync(path, `${JSON.stringify(obj, null, 2)}\n`);

async function main() {
  const now = new Date();
  console.log(`[scrape] start ${now.toISOString()}`);

  const vpPosts = await fetchValuePickrPosts({ windowHours: 720 });

  // Google News enriches the ValuePickr-discovered companies; a news-only
  // failure must not abort the run, so it is caught and skipped.
  let newsPosts = [];
  try {
    const headlines = await fetchGoogleNewsPosts({ windowHours: 720 });
    const index = buildCompanyIndex(vpPosts);
    newsPosts = tagByEntities(headlines, index);
    console.log(
      `[scrape] news: ${headlines.length} headlines -> ` +
        `${newsPosts.length} company-tagged posts across ${index.length} companies`,
    );
  } catch (err) {
    console.error(`[scrape] news source failed, continuing: ${err.message}`);
  }

  const rawPosts = [...vpPosts, ...newsPosts];
  console.log(
    `[scrape] fetched ${rawPosts.length} posts total ` +
      `(valuepickr ${vpPosts.length}, news ${newsPosts.length})`,
  );

  if (rawPosts.length === 0) {
    console.error('[scrape] no posts fetched — keeping existing data, exiting non-zero.');
    process.exit(1);
  }

  const history = loadHistory(HISTORY_FILE);
  const { trending, postsFiles, history: nextHistory } = buildData(rawPosts, history, now);

  if (trending.stocks.length === 0) {
    console.error('[scrape] no companies discovered — keeping existing data, exiting non-zero.');
    process.exit(1);
  }

  rmSync(POSTS_DIR, { recursive: true, force: true });
  mkdirSync(POSTS_DIR, { recursive: true });
  for (const file of postsFiles) {
    writeJSON(join(POSTS_DIR, `${file.ticker}.json`), file);
  }
  writeJSON(join(DATA_DIR, 'trending.json'), trending);
  writeJSON(HISTORY_FILE, nextHistory);

  console.log(
    `[scrape] wrote ${postsFiles.length} companies, ${trending.totalPosts} posts, ` +
      `mood score ${trending.marketMood.score}`,
  );
  console.log(
    `[scrape] top: ${trending.stocks
      .slice(0, 5)
      .map((s) => `${s.name} (${s.mentions})`)
      .join(', ')}`,
  );
}

main().catch((err) => {
  console.error('[scrape] failed:', err);
  process.exit(1);
});
