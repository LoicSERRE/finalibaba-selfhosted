// Own skeleton, not inherited from the root app/loading.tsx (which renders
// DashboardLoading) - real gap found during the v1.15 UI/UX audit: every
// sibling route already has a tailored loading.tsx, but this one didn't,
// so a slow load here would flash a dashboard-shaped skeleton (net-worth
// cards, charts) before the real filter/table UI appeared. Mirrors the
// actual page shape: title+subtitle, the filter bar, a table card, and a
// pagination row.
export default function TransactionsLoading() {
  return (
    <div className="max-w-5xl mx-auto space-y-6 animate-pulse">
      <div>
        <div className="h-8 w-56 bg-[var(--surface)] rounded-lg" />
        <div className="h-4 w-72 bg-[var(--surface)] rounded mt-2" />
      </div>

      <div className="flex flex-wrap gap-3">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="h-10 w-32 bg-[var(--surface)] border border-[var(--border)] rounded-lg" />
        ))}
      </div>

      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
        <div className="h-10 bg-[var(--surface-elevated)]" />
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
          <div key={i} className="h-12 border-t border-[var(--border)]" />
        ))}
      </div>

      <div className="flex items-center justify-between">
        <div className="h-9 w-28 bg-[var(--surface)] rounded-lg" />
        <div className="h-4 w-20 bg-[var(--surface)] rounded" />
        <div className="h-9 w-20 bg-[var(--surface)] rounded-lg" />
      </div>
    </div>
  );
}
