import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { cn } from '../lib/format';

interface Props {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  accent?: string;
  index?: number;
}

export default function StatCard({ icon, label, value, sub, accent = 'text-brand-300', index = 0 }: Props) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className="card p-4 sm:p-5"
    >
      <div className="flex items-center gap-2.5">
        <span className={cn('grid h-8 w-8 place-items-center rounded-lg bg-overlay/[0.04]', accent)}>
          {icon}
        </span>
        <span className="text-[11px] font-semibold uppercase tracking-wider text-faint">
          {label}
        </span>
      </div>
      <div className="mt-3 text-2xl font-bold text-fg sm:text-[1.7rem]">{value}</div>
      {sub && <div className="mt-1 text-sm text-muted">{sub}</div>}
    </motion.div>
  );
}
