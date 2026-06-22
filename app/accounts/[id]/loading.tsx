export default function AccountDetailLoading() {
  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-pulse">
      {/* Back nav */}
      <div className="h-4 w-20 bg-[var(--surface)] rounded" />

      {/* Account header */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-2">
            <div className="h-3 w-32 bg-[var(--surface-elevated)] rounded" />
            <div className="h-7 w-48 bg-[var(--surface-elevated)] rounded" />
          </div>
          <div className="h-9 w-28 bg-[var(--surface-elevated)] rounded" />
        </div>
      </div>

      {/* Chart */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-6">
        <div className="h-3 w-36 bg-[var(--surface-elevated)] rounded mb-4" />
        <div className="h-[200px] bg-[var(--surface-elevated)] rounded-lg" />
      </div>

      {/* Table */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-[var(--border)]">
          <div className="h-3 w-28 bg-[var(--surface-elevated)] rounded" />
        </div>
        <div className="divide-y divide-[var(--border)]">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="px-6 py-4 flex items-center justify-between">
              <div className="space-y-1.5">
                <div className="h-4 w-36 bg-[var(--surface-elevated)] rounded" />
                <div className="h-3 w-20 bg-[var(--surface-elevated)] rounded" />
              </div>
              <div className="h-5 w-24 bg-[var(--surface-elevated)] rounded" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
