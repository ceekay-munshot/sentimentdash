import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Flame, MessagesSquare, Search, TrendingUp, Trophy } from 'lucide-react';
import type { TrendingData, TrendingStock } from '../types';
import { SENTIMENT_META, moodLabel } from '../lib/meta';
import { cn, formatPct } from '../lib/format';
import StatCard from './StatCard';
import StockRow from './StockRow';
import SentimentBar from './SentimentBar';
import CountUp from './CountUp';

type SortKey = 'trending' | 'bullish' | 'bearish' | 'movers';

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'trending', label: 'Trending' },
  { key: 'bullish', label: 'Bullish' },
  { key: 'bearish', label: 'Bearish' },
  { key: 'movers', label: 'Movers' },
];

interface Props {
  data: TrendingData;
  onSelect: (ticker: string) => void;
}

export default function Dashboard({ data, onSelect }: Props) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('trending');

  const topMover = useMemo(
    () => [...data.stocks].sort((a, b) => b.changePct - a.changePct)[0],
    [data.stocks],
  );
  const mostBullish = useMemo(
    () => [...data.stocks].sort((a, b) => b.sentiment.score - a.sentiment.score)[0],
    [data.stocks],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = data.stocks.filter(
      (s) => !q || s.ticker.toLowerCase().includes(q) || s.name.toLowerCase().includes(q),
    );
    const sorters: Record<SortKey, (a: TrendingStock, b: TrendingStock) => number> = {
      trending: (a, b) => a.rank - b.rank,
      bullish: (a, b) => b.sentiment.score - a.sentiment.score,
      bearish: (a, b) => a.sentiment.score - b.sentiment.score,
      movers: (a, b) => b.changePct - a.changePct,
    };
    return [...list].sort(sorters[sort]);
  }, [data.stocks, query, sort]);

  const mood = moodLabel(data.marketMood.score);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.3 }}
      className="py-6 sm:py-8"
    >
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold tracking-tight text-white sm:text-3xl">
          What India is <span className="text-gradient">talking about</span>
        </h1>
        <p className="mt-1.5 max-w-xl text-sm text-slate-400">
          The companies ValuePickr is talking about right now — ranked by buzz, scored by
          sentiment.
        </p>
      </div>

      <div className="mb-7 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          index={0}
          icon={<MessagesSquare className="h-4 w-4" />}
          label="Posts analysed"
          value={<CountUp value={data.totalPosts} />}
          sub={`Across ${data.totalStocks} companies · last ${data.window}`}
        />
        <StatCard
          index={1}
          icon={<Flame className="h-4 w-4" />}
          label="Market mood"
          accent={SENTIMENT_META[mood].text}
          value={<span className={SENTIMENT_META[mood].text}>{SENTIMENT_META[mood].label}</span>}
          sub={
            <SentimentBar
              className="mt-2"
              bullish={data.marketMood.bullish}
              bearish={data.marketMood.bearish}
              neutral={data.marketMood.neutral}
            />
          }
        />
        <StatCard
          index={2}
          icon={<Trophy className="h-4 w-4" />}
          label="Most bullish"
          accent="text-bull"
          value={<span className="block truncate text-lg sm:text-xl">{mostBullish?.name ?? '—'}</span>}
          sub={mostBullish ? `Sentiment score ${mostBullish.sentiment.score.toFixed(2)}` : undefined}
        />
        <StatCard
          index={3}
          icon={<TrendingUp className="h-4 w-4" />}
          label="Top mover"
          accent="text-brand-300"
          value={<span className="block truncate text-lg sm:text-xl">{topMover?.name ?? '—'}</span>}
          sub={topMover ? `${formatPct(topMover.changePct)} vs previous ${data.window}` : undefined}
        />
      </div>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Flame className="h-4 w-4 text-brand-300" />
          <h2 className="text-sm font-bold uppercase tracking-wider text-slate-300">
            Trending now
          </h2>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search stock…"
              className="h-9 w-full rounded-lg border border-white/[0.07] bg-ink-800/70 pl-9 pr-3 text-sm text-slate-200 outline-none transition-colors placeholder:text-slate-600 focus:border-brand/40 sm:w-44"
            />
          </div>
          <div className="flex gap-1 rounded-lg border border-white/[0.06] bg-ink-800/50 p-1">
            {SORTS.map((s) => (
              <button
                key={s.key}
                onClick={() => setSort(s.key)}
                className={cn(
                  'flex-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors sm:flex-none',
                  sort === s.key
                    ? 'bg-brand/20 text-brand-300'
                    : 'text-slate-500 hover:text-slate-300',
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="card grid place-items-center gap-3 py-16 text-center">
          <Search className="h-7 w-7 text-slate-600" />
          <p className="text-sm text-slate-400">No stocks match “{query}”.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map((stock, i) => (
            <StockRow key={stock.ticker} stock={stock} index={i} onSelect={onSelect} />
          ))}
        </div>
      )}
    </motion.div>
  );
}
