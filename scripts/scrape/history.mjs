/**
 * Rolling run history, committed to public/data/history.json.
 *
 * Each scrape appends one entry of per-ticker mention counts. This is what
 * makes mentionsPrev, changePct and the sparkline real numbers rather than
 * guesses — they are derived from previous runs.
 */
import { readFileSync } from 'node:fs';

/** How many runs to retain (~12 days at twice-daily). */
export const MAX_RUNS = 24;

/** Loads history.json, tolerating a missing or malformed file. */
export function loadHistory(path) {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return Array.isArray(parsed?.runs) ? parsed : { runs: [] };
  } catch {
    return { runs: [] };
  }
}

/** Mention count for `ticker` in the most recent prior run (0 if none). */
export function prevCount(history, ticker) {
  const last = history.runs.at(-1);
  return last?.counts?.[ticker] ?? 0;
}

/** Mention counts for `ticker` across every prior run, oldest -> newest. */
export function historySeries(history, ticker) {
  return history.runs.map((r) => r.counts?.[ticker] ?? 0);
}

/** Returns a new history object with `run` appended and trimmed to MAX_RUNS. */
export function appendRun(history, run, maxRuns = MAX_RUNS) {
  return {
    updatedAt: run.at,
    runs: [...history.runs, run].slice(-maxRuns),
  };
}
