import { motion } from 'framer-motion';
import { cn } from '../lib/format';

interface Props {
  bullish: number;
  bearish: number;
  neutral: number;
  className?: string;
  animate?: boolean;
}

export default function SentimentBar({ bullish, bearish, neutral, className, animate = false }: Props) {
  const total = bullish + bearish + neutral || 1;
  const segments = [
    { key: 'bull', value: bullish, color: 'bg-bull' },
    { key: 'flat', value: neutral, color: 'bg-flat/55' },
    { key: 'bear', value: bearish, color: 'bg-bear' },
  ];

  return (
    <div className={cn('flex h-1.5 w-full overflow-hidden rounded-full bg-ink-700', className)}>
      {segments.map((s) => {
        const width = `${(s.value / total) * 100}%`;
        return animate ? (
          <motion.div
            key={s.key}
            className={s.color}
            initial={{ width: 0 }}
            animate={{ width }}
            transition={{ duration: 0.75, ease: [0.22, 1, 0.36, 1] }}
          />
        ) : (
          <div key={s.key} className={s.color} style={{ width }} />
        );
      })}
    </div>
  );
}
