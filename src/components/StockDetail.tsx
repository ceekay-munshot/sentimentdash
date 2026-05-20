import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, MessagesSquare, TrendingDown, TrendingUp } from 'lucide-react';
import type { Sentiment, SentimentBreakdown, Source, StockPosts, TrendingStock } from '../types';
import { fetchStockPosts } from '../lib/data';
import { SENTIMENT_META, SENTIMENT_ORDER, SOURCE_META, SOURCE_ORDER, moodLabel } from '../lib/meta';
import { cn, formatPct } from '../lib/format';
import Sparkline from './Sparkline';
import SentimentBar from './SentimentBar';
import PostCard from './PostCard';
import CountUp from './CountUp';
import { FeedSkeleton } from './Loading';

type SourceFilter = Source | 'all';
type SentimentFilter = Sentiment | 'all';

interface Props {
  ticker: string;
  stock?: TrendingStock;
  window: string;
  onBack: () => void;
}

export default function StockDetail({ ticker, stock, window, onBack }: Props) {
  const [data, setData] = useState<StockPosts | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [sentFilter, setSentFilter] = useState<SentimentFilter>('all');

  useEffect(() => {
    let active = true;
    setStatus('loading');
    setData(null);
    fetchStockPosts(ticker)
      .then((d) => {
        if (active) {
          setData(d);
          setStatus('ready');
        }
      })
      .catch(() => {
        if (active) setStatus('error');
      });
    return () => {
      active = false;
    };
  }, [ticker]);

  const posts = data?.posts ?? [];
  const filtered = useMemo(
    () =>
      posts.filter(
        (p) =>
          (sourceFilter === 'all' || p.source === sourceFilter) &&
          (sentFilter === 'all' || p.sentiment === sentFilter),
      ),
    [posts, sourceFilter, sentFilter],
  );

  const name = stock?.name ?? data?.name ?? ticker;
  const highlightTerms = [name];

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.3 }}
      className="py-6 sm:py-8"
    >
      <button
        onClick={onBack}
        className="mb-5 inline-flex items-center gap-1.5 text-sm font-medium text-slate-400 transition-colors hover:text-white"
      >
        <ArrowLeft className="h-4 w-4" />
        All stocks
      </button>

      <StockHeader name={name} stock={stock} data={data} window={window} />

      <div className="mt-7">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <MessagesSquare className="h-4 w-4 text-brand-300" />
            <h2 className="text-sm font-bold uppercase tracking-wider text-slate-300">
              The conversation
            </h2>
            {status === 'ready' && (
              <span className="text-xs text-slate-500">
                {filtered.length} of {posts.length}
              </span>
            )}
          </div>
          {status === 'ready' && (
            <div className="flex flex-wrap gap-2">
              <FilterGroup
                active={sourceFilter}
                onChange={(k) => setSourceFilter(k as SourceFilter)}
                options={[
                  { key: 'all', label: 'All' },
                  ...SOURCE_ORDER.map((s) => ({ key: s, label: SOURCE_META[s].label })),
                ]}
              />
              <FilterGroup
                active={sentFilter}
                onChange={(k) => setSentFilter(k as SentimentFilter)}
                options={[
                  { key: 'all', label: 'All' },
                  ...SENTIMENT_ORDER.map((s) => ({ key: s, label: SENTIMENT_META[s].label })),
                ]}
              />
            </div>
          )}
        </div>

        {status === 'loading' && <FeedSkeleton />}

        {status === 'error' && (
          <div className="card grid place-items-center py-14 text-center">
            <p className="text-sm text-slate-400">Couldn’t load posts for {name}.</p>
          </div>
        )}

        {status === 'ready' && filtered.length === 0 && (
          <div className="card grid place-items-center py-14 text-center">
            <p className="text-sm text-slate-400">No posts match these filters.</p>
          </div>
        )}

        {status === 'ready' && filtered.length > 0 && (
          <div className="space-y-3">
            <AnimatePresence mode="popLayout">
              {filtered.map((p, i) => (
                <PostCard key={p.id} post={p} highlightTerms={highlightTerms} index={i} />
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </motion.div>
  );
}

function StockHeader({
  name,
  stock,
  data,
  window,
}: {
  name: string;
  stock?: TrendingStock;
  data: StockPosts | null;
  window: string;
}) {
  const posts = data?.posts ?? [];

  const sentiment: SentimentBreakdown =
    stock?.sentiment ??
    (() => {
      const bullish = posts.filter((p) => p.sentiment === 'bullish').length;
      const bearish = posts.filter((p) => p.sentiment === 'bearish').length;
      const neutral = posts.filter((p) => p.sentiment === 'neutral').length;
      const score = (bullish - bearish) / (bullish + bearish + neutral || 1);
      return { bullish, bearish, neutral, score, label: moodLabel(score) };
    })();

  const sources: Record<Source, number> =
    stock?.sources ??
    SOURCE_ORDER.reduce(
      (acc, s) => {
        acc[s] = posts.filter((p) => p.source === s).length;
        return acc;
      },
      { reddit: 0, valuepickr: 0, substack: 0 } as Record<Source, number>,
    );

  const mentions = stock?.mentions ?? posts.length;
  const sentMeta = SENTIMENT_META[sentiment.label];
  const up = (stock?.changePct ?? 0) >= 0;
  const sourceTotal = SOURCE_ORDER.reduce((sum, s) => sum + (sources[s] ?? 0), 0) || 1;

  return (
    <div className="card overflow-hidden">
      <div className="grid gap-5 p-5 sm:p-6 lg:grid-cols-[1.05fr_1fr] lg:gap-7">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-2xl font-extrabold tracking-tight text-white sm:text-3xl">
              {name}
            </span>
            {stock && (
              <span className="rounded-md bg-brand/15 px-2 py-1 text-xs font-bold text-brand-300">
                #{stock.rank} trending
              </span>
            )}
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <Chip>ValuePickr</Chip>
          </div>

          <div className="mt-6 flex items-end gap-3">
            <div>
              <div className="font-mono text-4xl font-extrabold leading-none text-white">
                <CountUp value={mentions} />
              </div>
              <div className="mt-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                mentions · last {window}
              </div>
            </div>
            {stock && (
              <span
                className={cn(
                  'mb-0.5 inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sm font-bold',
                  up ? 'bg-bull/10 text-bull' : 'bg-bear/10 text-bear',
                )}
              >
                {up ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
                {formatPct(stock.changePct)}
              </span>
            )}
          </div>

          {stock && (
            <div className="mt-5">
              <Sparkline
                data={stock.sparkline}
                width={540}
                height={56}
                stroke={up ? '#34d399' : '#fb6f84'}
                className="h-14 w-full"
              />
            </div>
          )}
        </div>

        <div className="flex flex-col gap-4 rounded-xl border border-white/[0.05] bg-ink-850/70 p-4 sm:p-5">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Sentiment
              </span>
              <span className={cn('text-sm font-bold', sentMeta.text)}>{sentMeta.label}</span>
            </div>
            <SentimentBar
              animate
              className="mt-2.5 h-2"
              bullish={sentiment.bullish}
              bearish={sentiment.bearish}
              neutral={sentiment.neutral}
            />
            <div className="mt-2.5 flex items-center justify-between text-xs font-medium">
              <span className="text-bull">{sentiment.bullish} bullish</span>
              <span className="text-flat">{sentiment.neutral} neutral</span>
              <span className="text-bear">{sentiment.bearish} bearish</span>
            </div>
          </div>

          <div className="h-px bg-white/[0.05]" />

          <div>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Where it’s discussed
            </span>
            <div className="mt-3 space-y-2.5">
              {SOURCE_ORDER.map((s) => {
                const count = sources[s] ?? 0;
                const meta = SOURCE_META[s];
                return (
                  <div key={s} className="flex items-center gap-3">
                    <span className="flex w-[88px] shrink-0 items-center gap-1.5">
                      <span className={cn('h-2 w-2 rounded-full', meta.dot)} />
                      <span className="text-xs font-medium text-slate-400">{meta.label}</span>
                    </span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-700">
                      <motion.div
                        className={cn('h-full', meta.dot)}
                        initial={{ width: 0 }}
                        animate={{ width: `${(count / sourceTotal) * 100}%` }}
                        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
                      />
                    </div>
                    <span className="w-7 shrink-0 text-right font-mono text-xs font-semibold text-slate-300">
                      {count}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-md border border-white/[0.06] bg-white/[0.03] px-2 py-0.5 text-xs font-medium text-slate-400">
      {children}
    </span>
  );
}

function FilterGroup({
  options,
  active,
  onChange,
}: {
  options: { key: string; label: string }[];
  active: string;
  onChange: (key: string) => void;
}) {
  return (
    <div className="flex gap-1 rounded-lg border border-white/[0.06] bg-ink-800/50 p-1">
      {options.map((o) => (
        <button
          key={o.key}
          onClick={() => onChange(o.key)}
          className={cn(
            'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
            active === o.key ? 'bg-brand/20 text-brand-300' : 'text-slate-500 hover:text-slate-300',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
