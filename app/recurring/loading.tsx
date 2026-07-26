export default function RecurringLoading() {
  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-pulse">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="h-8 w-52 bg-[var(--surface)] rounded-lg" />
          <div className="h-4 w-64 bg-[var(--surface)] rounded mt-2" />
        </div>
        <div className="h-9 w-44 bg-[var(--surface)] rounded-lg" />
      </div>
      <div className="space-y-3">
        {[0, 1].map((i) => (
          <div key={i} className="h-16 bg-[var(--surface)] border border-[var(--border)] rounded-xl" />
        ))}
      </div>
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-4">
        <div className="h-4 w-32 bg-[var(--surface-elevated)] rounded" />
        <div className="h-[220px] w-full bg-[var(--surface-elevated)] rounded-lg" />
      </div>
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl divide-y divide-[var(--border)]">
        {[0, 1, 2].map((i) => (
          <div key={i} className="px-6 py-3 flex items-center justify-between">
            <div className="h-4 w-40 bg-[var(--surface-elevated)] rounded" />
            <div className="h-4 w-16 bg-[var(--surface-elevated)] rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}
