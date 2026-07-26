export default function BudgetsLoading() {
  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-pulse">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="h-8 w-28 bg-[var(--surface)] rounded-lg" />
          <div className="h-4 w-56 bg-[var(--surface)] rounded mt-2" />
        </div>
        <div className="h-9 w-40 bg-[var(--surface)] rounded-lg" />
      </div>
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-[var(--surface-elevated)]" />
                <div className="h-4 w-24 bg-[var(--surface-elevated)] rounded" />
              </div>
              <div className="h-8 w-16 bg-[var(--surface-elevated)] rounded-lg" />
            </div>
            <div className="h-4 w-32 bg-[var(--surface-elevated)] rounded" />
            <div className="h-2 w-full bg-[var(--surface-elevated)] rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
