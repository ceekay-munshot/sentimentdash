import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import type { TrendingData } from './types';
import { fetchTrending } from './lib/data';
import { navigate, useHashRoute } from './lib/router';
import Header from './components/Header';
import Dashboard from './components/Dashboard';
import StockDetail from './components/StockDetail';
import { DashboardSkeleton } from './components/Loading';

export default function App() {
  const [data, setData] = useState<TrendingData | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const route = useHashRoute();

  const load = useCallback(() => {
    setStatus('loading');
    fetchTrending()
      .then((d) => {
        setData(d);
        setStatus('ready');
      })
      .catch(() => setStatus('error'));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const selectedTicker = route.view === 'stock' ? route.ticker : null;

  return (
    <div className="flex min-h-full flex-col">
      <Header
        generatedAt={data?.generatedAt}
        window={data?.window}
        onHome={() => navigate('')}
      />

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 sm:px-6">
        {status === 'loading' && <DashboardSkeleton />}

        {status === 'error' && (
          <div className="grid place-items-center py-24 text-center">
            <AlertTriangle className="h-9 w-9 text-bear" />
            <p className="mt-4 text-sm text-slate-300">Couldn’t load dashboard data.</p>
            <button
              onClick={load}
              className="mt-4 inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-medium text-slate-200 transition-colors hover:bg-white/[0.08]"
            >
              <RefreshCw className="h-4 w-4" />
              Retry
            </button>
          </div>
        )}

        {status === 'ready' && data && (
          <AnimatePresence mode="wait">
            {selectedTicker ? (
              <StockDetail
                key={selectedTicker}
                ticker={selectedTicker}
                stock={data.stocks.find((s) => s.ticker === selectedTicker)}
                window={data.window}
                onBack={() => navigate('')}
              />
            ) : (
              <Dashboard key="home" data={data} onSelect={(t) => navigate(`/stock/${t}`)} />
            )}
          </AnimatePresence>
        )}
      </main>

      <footer className="border-t border-white/[0.05] py-6">
        <div className="mx-auto w-full max-w-6xl px-4 text-center text-xs text-slate-600 sm:px-6">
          SentimentDash · Live sentiment from the ValuePickr investor forum.
        </div>
      </footer>
    </div>
  );
}
