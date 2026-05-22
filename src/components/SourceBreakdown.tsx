import type { Source } from '../types';
import { SOURCE_META, SOURCE_ORDER } from '../lib/meta';
import { cn } from '../lib/format';

interface Props {
  sources: Record<Source, number>;
  className?: string;
}

export default function SourceBreakdown({ sources, className }: Props) {
  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      {SOURCE_ORDER.map((src) => {
        const meta = SOURCE_META[src];
        return (
          <span
            key={src}
            title={`${meta.label}: ${sources[src] ?? 0} posts`}
            className="inline-flex items-center gap-1.5 rounded-md border border-edge bg-overlay/[0.02] px-2 py-1"
          >
            <span className={cn('h-1.5 w-1.5 rounded-full', meta.dot)} />
            <span className="font-mono text-xs font-semibold text-muted">{sources[src] ?? 0}</span>
          </span>
        );
      })}
    </div>
  );
}
