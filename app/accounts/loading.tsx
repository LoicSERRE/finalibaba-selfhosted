export default function AccountsLoading() {
  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="h-8 w-24 bg-[var(--surface)] rounded-lg" />
        <div className="h-9 w-32 bg-[var(--surface)] rounded-lg" />
      </div>
      <div className="grid grid-cols-4 bg-[var(--surface)] border border-[var(--border)] rounded-xl p-1 gap-1">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-12 bg-[var(--surface-elevated)] rounded-lg" />
        ))}
      </div>
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-16 bg-[var(--surface)] border border-[var(--border)] rounded-xl" />
        ))}
      </div>
    </div>
  );
}
