import { motion } from 'framer-motion';
import { ChevronRight, TrendingDown, TrendingUp } from 'lucide-react';
import type { TrendingStock } from '../types';
import { SENTIMENT_META, SOURCE_META, SOURCE_ORDER } from '../lib/meta';
import { cn, compactNumber, formatPct } from '../lib/format';
import Sparkline from './Sparkline';
import SentimentBar from './SentimentBar';
import SourceBreakdown from './SourceBreakdown';

const RANK_STYLES: Record<number, string> = {
  1: 'bg-gradient-to-br from-amber-200 to-amber-500 text-ink-900',
  2: 'bg-gradient-to-br from-slate-200 to-slate-400 text-ink-900',
  3: 'bg-gradient-to-br from-orange-300 to-orange-500 text-ink-900',
};

interface Props {
  stock: TrendingStock;
  index: number;
  onSelect: (ticker: string) => void;
}

export default function StockRow({ stock, index, onSelect }: Props) {
  const sent = SENTIMENT_META[stock.sentiment.label];
  const up = stock.changePct >= 0;
  const sourceLabel =
    SOURCE_ORDER.filter((s) => (stock.sources[s] ?? 0) > 0)
      .map((s) => SOURCE_META[s].label)
      .join(' · ') || '—';

  return (
    <motion.button
      type="button"
      onClick={() => onSelect(stock.ticker)}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index, 20) * 0.03, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ y: -2 }}
      className="card group flex w-full items-center gap-3 p-3 text-left transition-colors hover:border-brand/30 hover:bg-ink-750/70 sm:gap-4 sm:p-4"
    >
      <span
        className={cn(
          'grid h-8 w-8 shrink-0 place-items-center rounded-lg font-mono text-sm font-bold',
          RANK_STYLES[stock.rank] ?? 'bg-white/[0.04] text-slate-400',
        )}
      >
        {stock.rank}
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm font-bold text-white">{stock.name}</span>
        <span className="truncate text-xs text-slate-500">{sourceLabel}</span>
      </div>

      <div className="hidden w-[150px] shrink-0 flex-col gap-1.5 md:flex">
        <span className={cn('text-xs font-semibold', sent.text)}>{sent.label}</span>
        <SentimentBar
          bullish={stock.sentiment.bullish}
          bearish={stock.sentiment.bearish}
          neutral={stock.sentiment.neutral}
        />
      </div>

      <div className="hidden shrink-0 lg:block">
        <SourceBreakdown sources={stock.sources} />
      </div>

      <div className="hidden shrink-0 sm:block">
        <Sparkline data={stock.sparkline} stroke={up ? '#34d399' : '#fb6f84'} />
      </div>

      <div className="flex w-[78px] shrink-0 flex-col items-end gap-0.5">
        <span className="font-mono text-lg font-bold leading-none text-white">
          {compactNumber(stock.mentions)}
        </span>
        <span
          className={cn(
            'inline-flex items-center gap-0.5 text-xs font-semibold',
            up ? 'text-bull' : 'text-bear',
          )}
        >
          {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
          {formatPct(stock.changePct)}
        </span>
      </div>

      <ChevronRight className="h-4 w-4 shrink-0 text-slate-600 transition-colors group-hover:text-brand-300" />
    </motion.button>
  );
}
