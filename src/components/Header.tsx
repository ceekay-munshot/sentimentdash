import { Activity, Moon, Sun } from 'lucide-react';
import { relativeTime } from '../lib/format';
import { useTheme } from '../lib/theme';

interface Props {
  generatedAt?: string;
  window?: string;
  onHome: () => void;
}

export default function Header({ generatedAt, window: win, onHome }: Props) {
  const { theme, toggle } = useTheme();

  return (
    <header className="sticky top-0 z-40 border-b border-edge bg-base/80 backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3.5 sm:px-6">
        <button onClick={onHome} className="flex items-center gap-3" aria-label="SentimentDash home">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-brand-400 to-brand-600 shadow-glow">
            <Activity className="h-5 w-5 text-white" strokeWidth={2.6} />
          </span>
          <span className="flex flex-col leading-none">
            <span className="text-[15px] font-extrabold tracking-tight text-fg">
              Sentiment<span className="text-brand-300">Dash</span>
            </span>
            <span className="mt-1 text-[11px] font-medium text-faint">Trending Indian stocks</span>
          </span>
        </button>

        <div className="flex items-center gap-2">
          {win && (
            <span className="hidden items-center rounded-full border border-edge bg-overlay/[0.03] px-2.5 py-1 text-xs font-medium text-muted sm:inline-flex">
              Last {win}
            </span>
          )}
          {generatedAt && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-edge bg-overlay/[0.03] px-2.5 py-1 text-xs font-medium text-muted">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-bull opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-bull" />
              </span>
              Updated {relativeTime(generatedAt)}
            </span>
          )}
          <button
            onClick={toggle}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-edge bg-overlay/[0.03] text-muted transition-colors hover:text-fg"
          >
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </header>
  );
}
