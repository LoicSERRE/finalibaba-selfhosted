export default function SettingsLoading() {
  return (
    <div className="max-w-2xl mx-auto space-y-8 animate-pulse">
      <div>
        <div className="h-7 w-32 bg-[var(--surface)] rounded-lg" />
        <div className="h-4 w-52 bg-[var(--surface)] rounded mt-2" />
      </div>

      {/* Institutions */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="h-5 w-24 bg-[var(--surface)] rounded" />
          <div className="h-9 w-36 bg-[var(--surface)] rounded-lg" />
        </div>
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl divide-y divide-[var(--border)]">
          {[0, 1, 2].map((i) => (
            <div key={i} className="px-5 py-3.5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-[var(--surface-elevated)]" />
                <div className="space-y-1.5">
                  <div className="h-3.5 w-28 bg-[var(--surface-elevated)] rounded" />
                  <div className="h-3 w-16 bg-[var(--surface-elevated)] rounded" />
                </div>
              </div>
              <div className="h-8 w-20 bg-[var(--surface-elevated)] rounded-lg" />
            </div>
          ))}
        </div>
      </div>

      {/* Profil financier */}
      <div className="space-y-4">
        <div className="h-5 w-36 bg-[var(--surface)] rounded" />
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="space-y-1.5">
                <div className="h-3 w-32 bg-[var(--surface-elevated)] rounded" />
                <div className="h-9 w-full bg-[var(--surface-elevated)] rounded-lg" />
              </div>
            ))}
          </div>
          <div className="flex justify-end">
            <div className="h-9 w-24 bg-[var(--surface-elevated)] rounded-lg" />
          </div>
        </div>
      </div>
    </div>
  );
}
