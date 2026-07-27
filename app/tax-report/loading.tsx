export default function TaxReportLoading() {
  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-pulse">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="h-8 w-52 bg-[var(--surface)] rounded-lg" />
          <div className="h-4 w-64 bg-[var(--surface)] rounded mt-2" />
        </div>
        <div className="h-9 w-32 bg-[var(--surface)] rounded-lg" />
      </div>
      <div className="h-24 bg-[var(--surface)] border border-[var(--border)] rounded-xl" />
      <div className="h-40 bg-[var(--surface)] border border-[var(--border)] rounded-xl" />
    </div>
  );
}
