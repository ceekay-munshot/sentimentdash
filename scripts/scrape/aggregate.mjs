/**
 * The pipeline core: turns raw scraped posts into the dashboard data contract.
 *
 *   public/data/trending.json       — ranked companies
 *   public/data/posts/<KEY>.json    — posts behind each company
 *
 * Companies are discovered bottom-up: posts are grouped by the forum topic
 * they belong to (a ValuePickr topic ≈ a company), and every topic with
 * recent posts becomes a trending entry. There is no fixed stock list.
 *
 * buildData is pure (no I/O) so it can be exercised by selftest.mjs offline.
 */
import { scorePost } from './sentiment.mjs';
import { prevCount, historySeries, appendRun } from './history.mjs';

const WINDOW_HOURS = 168;
const WINDOW_LABEL = WINDOW_HOURS % 24 === 0 ? `${WINDOW_HOURS / 24}d` : `${WINDOW_HOURS}h`;
const SPARK_POINTS = 12;
const HOUR_MS = 3600 * 1000;

const round = (v, digits = 2) => Number(v.toFixed(digits));

function moodLabel(score) {
  if (score > 0.12) return 'bullish';
  if (score < -0.12) return 'bearish';
  return 'neutral';
}

/** Sparkline seed for a company's first-ever run: a 12-bucket histogram of
 *  post ages across the window (oldest -> newest), used until history exists. */
function intraWindowSparkline(timestampsMs, nowMs) {
  const buckets = new Array(SPARK_POINTS).fill(0);
  const bucketHours = WINDOW_HOURS / SPARK_POINTS;
  for (const ts of timestampsMs) {
    const ageH = (nowMs - ts) / HOUR_MS;
    const idx = Math.min(SPARK_POINTS - 1, Math.max(0, Math.floor(ageH / bucketHours)));
    buckets[idx]++;
  }
  return buckets.reverse();
}

/**
 * @param {Array} rawPosts   normalized posts carrying topicId / topicTitle
 * @param {object} prevHistory  parsed history.json ({ runs: [...] })
 * @param {Date} now
 * @returns {{ trending: object, postsFiles: object[], history: object }}
 */
export function buildData(rawPosts, prevHistory = { runs: [] }, now = new Date()) {
  const nowMs = now.getTime();
  const iso = now.toISOString();
  const windowMs = WINDOW_HOURS * HOUR_MS;

  // Group posts by the forum topic (≈ company) they belong to.
  const byTopic = new Map();
  for (const raw of rawPosts) {
    if (!raw.topicId) continue;
    const tsMs = new Date(raw.timestamp).getTime();
    if (!Number.isFinite(tsMs)) continue;
    if (nowMs - tsMs > windowMs) continue; // outside the window
    if (tsMs > nowMs + HOUR_MS) continue; // future timestamp / clock skew

    const post = {
      id: `${raw.source}-${raw.id}`,
      source: raw.source,
      author: raw.author,
      handle: raw.handle,
      community: raw.community,
      timestamp: raw.timestamp,
      text: raw.text,
      url: raw.url,
      sentiment: scorePost(raw.text),
      likes: raw.likes ?? 0,
      comments: raw.comments ?? 0,
    };
    if (!byTopic.has(raw.topicId)) {
      byTopic.set(raw.topicId, { name: raw.topicTitle || raw.topicId, posts: [] });
    }
    byTopic.get(raw.topicId).posts.push(post);
  }

  const stocks = [];
  const postsFiles = [];
  const mood = { bullish: 0, bearish: 0, neutral: 0 };
  const counts = {};
  let totalPosts = 0;

  for (const [topicId, group] of byTopic) {
    const posts = group.posts;
    posts.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    const sentiment = { bullish: 0, bearish: 0, neutral: 0 };
    const sources = { reddit: 0, valuepickr: 0, substack: 0 };
    for (const p of posts) {
      sentiment[p.sentiment]++;
      if (sources[p.source] !== undefined) sources[p.source]++;
    }

    const mentions = posts.length;
    counts[topicId] = mentions;
    totalPosts += mentions;
    mood.bullish += sentiment.bullish;
    mood.bearish += sentiment.bearish;
    mood.neutral += sentiment.neutral;

    const score = round((sentiment.bullish - sentiment.bearish) / mentions, 2);
    const mentionsPrev = prevCount(prevHistory, topicId);
    const changePct =
      mentionsPrev > 0 ? round(((mentions - mentionsPrev) / mentionsPrev) * 100, 1) : 0;

    const series = [...historySeries(prevHistory, topicId), mentions];
    const sparkline =
      series.length >= 2
        ? series.slice(-SPARK_POINTS)
        : intraWindowSparkline(
            posts.map((p) => new Date(p.timestamp).getTime()),
            nowMs,
          );

    // `ticker` is the routing key (the forum topic id); the dashboard leads
    // with `name`. exchange/sector are unknown for forum-discovered companies.
    stocks.push({
      rank: 0,
      ticker: topicId,
      name: group.name,
      exchange: '',
      sector: '',
      mentions,
      mentionsPrev,
      changePct,
      sentiment: { score, label: moodLabel(score), ...sentiment },
      sources,
      sparkline,
    });

    postsFiles.push({
      ticker: topicId,
      name: group.name,
      exchange: '',
      sector: '',
      generatedAt: iso,
      posts,
    });
  }

  stocks.sort(
    (a, b) =>
      b.mentions - a.mentions ||
      b.sentiment.score - a.sentiment.score ||
      a.name.localeCompare(b.name),
  );
  stocks.forEach((s, i) => {
    s.rank = i + 1;
  });

  const moodSum = mood.bullish + mood.bearish + mood.neutral || 1;
  const moodScore = round((mood.bullish - mood.bearish) / moodSum, 2);

  const trending = {
    generatedAt: iso,
    window: WINDOW_LABEL,
    totalPosts,
    totalStocks: stocks.length,
    marketMood: { ...mood, score: moodScore },
    stocks,
  };

  const history = appendRun(prevHistory, {
    at: iso,
    totalPosts,
    counts,
    mood: { ...mood, score: moodScore },
  });

  return { trending, postsFiles, history };
}
