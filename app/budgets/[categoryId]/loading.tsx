export default function CategoryDetailLoading() {
  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-pulse">
      <div className="h-5 w-20 bg-[var(--surface)] rounded" />
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-4 h-4 rounded-full bg-[var(--surface)]" />
          <div className="h-8 w-32 bg-[var(--surface)] rounded-lg" />
        </div>
        <div className="h-5 w-20 bg-[var(--surface)] rounded" />
      </div>
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl divide-y divide-[var(--border)]">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="px-6 py-3 flex items-center justify-between">
            <div className="h-4 w-40 bg-[var(--surface-elevated)] rounded" />
            <div className="h-4 w-16 bg-[var(--surface-elevated)] rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}
