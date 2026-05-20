import { Activity } from 'lucide-react';
import { relativeTime } from '../lib/format';

interface Props {
  generatedAt?: string;
  window?: string;
  onHome: () => void;
}

export default function Header({ generatedAt, window: win, onHome }: Props) {
  return (
    <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-ink-900/80 backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3.5 sm:px-6">
        <button onClick={onHome} className="flex items-center gap-3" aria-label="SentimentDash home">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-brand-400 to-brand-600 shadow-glow">
            <Activity className="h-5 w-5 text-white" strokeWidth={2.6} />
          </span>
          <span className="flex flex-col leading-none">
            <span className="text-[15px] font-extrabold tracking-tight text-white">
              Sentiment<span className="text-brand-300">Dash</span>
            </span>
            <span className="mt-1 text-[11px] font-medium text-slate-500">Trending Indian stocks</span>
          </span>
        </button>

        <div className="flex items-center gap-2">
          {win && (
            <span className="hidden items-center rounded-full border border-white/[0.07] bg-white/[0.03] px-2.5 py-1 text-xs font-medium text-slate-300 sm:inline-flex">
              Last {win}
            </span>
          )}
          {generatedAt && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.07] bg-white/[0.03] px-2.5 py-1 text-xs font-medium text-slate-400">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-bull opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-bull" />
              </span>
              Updated {relativeTime(generatedAt)}
            </span>
          )}
        </div>
      </div>
    </header>
  );
}
