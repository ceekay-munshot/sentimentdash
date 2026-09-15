/**
 * Rolling run history, committed to public/data/history.json.
 *
 * Each scrape appends one entry of per-ticker mention counts. This is what
 * makes mentionsPrev, changePct and the sparkline real numbers rather than
 * guesses — they are derived from previous runs.
 */
import { readJson } from './archive.mjs';

/** Rolling aggregate observations; post history is retained separately without this limit. */
export const MAX_RUNS = 24;

/** A missing initial history is empty; corrupt saved history must stop publication. */
export function loadHistory(path) {
  const parsed = readJson(path, { runs: [] });
  if (!Array.isArray(parsed?.runs)) throw new Error('Invalid aggregate run history');
  return parsed;
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
