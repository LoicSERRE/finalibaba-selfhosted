export default function DashboardLoading() {
  return (
    <div className="max-w-5xl mx-auto space-y-8 animate-pulse">
      <div>
        <div className="h-7 w-28 bg-[var(--surface)] rounded-lg" />
        <div className="h-4 w-48 bg-[var(--surface)] rounded mt-2" />
      </div>

      {/* Hero KPI */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 sm:p-8 space-y-4">
        <div className="h-3 w-28 bg-[var(--surface-elevated)] rounded" />
        <div className="h-12 w-56 bg-[var(--surface-elevated)] rounded-lg" />
        <div className="h-4 w-40 bg-[var(--surface-elevated)] rounded" />
        <div className="pt-5 border-t border-[var(--border)] grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <div className="h-3 w-12 bg-[var(--surface-elevated)] rounded" />
            <div className="h-5 w-32 bg-[var(--surface-elevated)] rounded" />
          </div>
          <div className="space-y-2">
            <div className="h-3 w-12 bg-[var(--surface-elevated)] rounded" />
            <div className="h-5 w-32 bg-[var(--surface-elevated)] rounded" />
          </div>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <div className="md:col-span-3 bg-[var(--surface)] border border-[var(--border)] rounded-xl p-6">
          <div className="h-3 w-36 bg-[var(--surface-elevated)] rounded mb-4" />
          <div className="h-[260px] bg-[var(--surface-elevated)] rounded-lg" />
        </div>
        <div className="md:col-span-2 bg-[var(--surface)] border border-[var(--border)] rounded-xl p-6">
          <div className="h-3 w-32 bg-[var(--surface-elevated)] rounded mb-4" />
          <div className="h-[190px] bg-[var(--surface-elevated)] rounded-full mx-auto w-[190px]" />
          <div className="grid grid-cols-2 gap-2 mt-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-3 bg-[var(--surface-elevated)] rounded" />
            ))}
          </div>
        </div>
      </div>

      {/* Account list */}
      <div className="space-y-3">
        <div className="h-3 w-20 bg-[var(--surface)] rounded" />
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl divide-y divide-[var(--border)]">
          {[0, 1, 2].map((i) => (
            <div key={i} className="px-6 py-4 space-y-3">
              <div className="flex justify-between">
                <div className="h-4 w-24 bg-[var(--surface-elevated)] rounded" />
                <div className="h-4 w-20 bg-[var(--surface-elevated)] rounded" />
              </div>
              <div className="space-y-2">
                {[0, 1].map((j) => (
                  <div key={j} className="flex justify-between">
                    <div className="h-3 w-32 bg-[var(--surface-elevated)] rounded" />
                    <div className="h-3 w-16 bg-[var(--surface-elevated)] rounded" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
