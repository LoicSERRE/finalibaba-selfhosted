export default function AnalyticsLoading() {
  return (
    <div className="max-w-5xl mx-auto space-y-8 animate-pulse">
      <div>
        <div className="h-7 w-28 bg-[var(--surface)] rounded-lg" />
        <div className="h-4 w-56 bg-[var(--surface)] rounded mt-2" />
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 space-y-2">
            <div className="h-3 w-24 bg-[var(--surface-elevated)] rounded" />
            <div className="h-7 w-28 bg-[var(--surface-elevated)] rounded" />
          </div>
        ))}
      </div>

      {/* Chart + allocation */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <div className="md:col-span-3 bg-[var(--surface)] border border-[var(--border)] rounded-xl p-6">
          <div className="h-3 w-36 bg-[var(--surface-elevated)] rounded mb-4" />
          <div className="h-[240px] bg-[var(--surface-elevated)] rounded-lg" />
        </div>
        <div className="md:col-span-2 bg-[var(--surface)] border border-[var(--border)] rounded-xl p-6">
          <div className="h-3 w-32 bg-[var(--surface-elevated)] rounded mb-4" />
          <div className="h-[180px] bg-[var(--surface-elevated)] rounded-full mx-auto w-[180px]" />
          <div className="grid grid-cols-2 gap-2 mt-4">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-3 bg-[var(--surface-elevated)] rounded" />
            ))}
          </div>
        </div>
      </div>

      {/* Sections */}
      {[0, 1, 2].map((i) => (
        <div key={i} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-6 space-y-4">
          <div className="h-3 w-32 bg-[var(--surface-elevated)] rounded" />
          <div className="space-y-3">
            {[0, 1, 2].map((j) => (
              <div key={j} className="flex justify-between">
                <div className="h-4 w-40 bg-[var(--surface-elevated)] rounded" />
                <div className="h-4 w-20 bg-[var(--surface-elevated)] rounded" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
