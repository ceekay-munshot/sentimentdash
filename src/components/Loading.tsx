import { cn } from '../lib/format';

function Shimmer({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-overlay/[0.05]', className)} />;
}

export function DashboardSkeleton() {
  return (
    <div className="space-y-7 py-6 sm:py-8">
      <div className="space-y-2">
        <Shimmer className="h-8 w-72 max-w-full" />
        <Shimmer className="h-4 w-96 max-w-full" />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card p-5">
            <Shimmer className="h-4 w-24" />
            <Shimmer className="mt-4 h-7 w-20" />
          </div>
        ))}
      </div>
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="card flex items-center gap-4 p-4">
            <Shimmer className="h-8 w-8 rounded-lg" />
            <div className="flex-1 space-y-2">
              <Shimmer className="h-4 w-44" />
              <Shimmer className="h-3 w-28" />
            </div>
            <Shimmer className="hidden h-8 w-28 md:block" />
            <Shimmer className="h-9 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function FeedSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="card p-4 sm:p-5">
          <div className="flex items-center gap-3">
            <Shimmer className="h-10 w-10 rounded-full" />
            <div className="flex-1 space-y-2">
              <Shimmer className="h-3.5 w-40" />
              <Shimmer className="h-3 w-28" />
            </div>
          </div>
          <Shimmer className="mt-4 h-3.5 w-full" />
          <Shimmer className="mt-2 h-3.5 w-4/5" />
        </div>
      ))}
    </div>
  );
}
