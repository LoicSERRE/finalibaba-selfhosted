import Link from "next/link";
import { formatCurrency } from "@/lib/utils/format";
import { InstitutionLogo } from "@/components/shared/institution-logo";
import { AddRealEstateDialog } from "@/components/accounts/add-real-estate-dialog";
import { UpdateRealEstateDialog } from "@/components/accounts/update-real-estate-dialog";
import type { RealEstateRow } from "@/lib/domain/accounts-page";
import type { getTranslations } from "next-intl/server";

type T = Awaited<ReturnType<typeof getTranslations>>;

// See app/accounts/page.tsx's own readOnly note: a granted portfolio is
// read-only, so the add/edit affordances are dropped rather than left to
// fail against the Server Action's own ownership guard.
export function RealEstateTab({
  t,
  institutions,
  rows,
  readOnly = false,
}: Readonly<{
  t: T;
  institutions: { id: string; name: string }[];
  rows: RealEstateRow[];
  /** True when a granted (read-only) portfolio is on screen. */
  readOnly?: boolean;
}>) {
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        {!readOnly && (
        <AddRealEstateDialog institutions={institutions} />
        )}
      </div>
      {rows.length === 0 ? (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-10 text-center text-sm text-[var(--muted)]">
          {t("noRealEstate")}
        </div>
      ) : (
        rows.map((p) => (
          <div
            key={p.id}
            className="relative bg-[var(--surface)] border border-[var(--border)] rounded-xl p-6 space-y-5 hover:border-[var(--accent)]/40 hover:bg-[var(--surface-elevated)] active:scale-[0.98] active:opacity-90 transition cursor-pointer"
          >
            <Link
              href={`/accounts/${p.id}`}
              aria-label={`Voir ${p.name}`}
              className="absolute inset-0 z-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-inset"
            />
            <div className="flex items-start justify-between">
              <div>
                {p.institutionName && (
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <InstitutionLogo name={p.institutionName} logoUrl={p.institutionLogoUrl} size={24} />
                    <p className="text-xs text-[var(--muted)]">{p.institutionName}</p>
                  </div>
                )}
                <p className="font-medium text-[var(--foreground)]">{p.name}</p>
              </div>
              <div className="relative z-10 flex items-center gap-2">
                {!readOnly && (
                <UpdateRealEstateDialog id={p.id} name={p.name} valueCents={p.valueCents} liabilityCents={p.liabilityCents} />
                )}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 sm:gap-4 text-sm">
              <div>
                <p className="text-[var(--muted)] text-xs mb-1">{t("realEstate.value")}</p>
                <p className="tabular-nums font-medium text-[var(--foreground)]">{formatCurrency(p.valueCents, 0)}</p>
              </div>
              <div>
                <p className="text-[var(--muted)] text-xs mb-1">{t("realEstate.remaining")}</p>
                <p className="tabular-nums font-medium text-[var(--negative)]">{formatCurrency(p.liabilityCents, 0)}</p>
              </div>
              <div>
                <p className="text-[var(--muted)] text-xs mb-1">{t("realEstate.equity")}</p>
                <p className="tabular-nums font-medium text-[var(--positive)]">{formatCurrency(p.equityCents, 0)}</p>
              </div>
            </div>

            {p.liabilityCents > BigInt(0) && (
              <div>
                <div className="flex justify-between text-xs text-[var(--muted)] mb-1.5">
                  <span>LTV</span>
                  <span>{p.ltv}%</span>
                </div>
                <div className="h-1.5 bg-[var(--surface-elevated)] rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      p.ltv > 80 ? "bg-[var(--negative)]" : p.ltv > 60 ? "bg-[var(--warning)]" : "bg-[var(--positive)]"
                    }`}
                    style={{ width: `${Math.min(p.ltv, 100)}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}
