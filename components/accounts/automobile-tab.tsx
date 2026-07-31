import Link from "next/link";
import { formatCurrency } from "@/lib/utils/format";
import { InstitutionLogo } from "@/components/shared/institution-logo";
import { AddAutomobileDialog } from "@/components/accounts/add-automobile-dialog";
import { UpdateAutomobileDialog } from "@/components/accounts/update-automobile-dialog";
import type { AutomobileRow } from "@/lib/domain/accounts-page";
import type { getTranslations } from "next-intl/server";

type T = Awaited<ReturnType<typeof getTranslations>>;

export function AutomobileTab({
  t,
  institutions,
  rows,
}: {
  t: T;
  institutions: { id: string; name: string }[];
  rows: AutomobileRow[];
}) {
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <AddAutomobileDialog institutions={institutions} />
      </div>

      {rows.length === 0 ? (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-10 text-center text-sm text-[var(--muted)]">
          {t("noVehicle")}
        </div>
      ) : (
        rows.map((a) => (
          <div
            key={a.id}
            className="relative bg-[var(--surface)] border border-[var(--border)] rounded-xl p-6 space-y-4 hover:border-[var(--accent)]/40 hover:bg-[var(--surface-elevated)] active:scale-[0.98] active:opacity-90 transition cursor-pointer"
          >
            <Link
              href={`/accounts/${a.id}`}
              aria-label={`Voir ${a.name}`}
              className="absolute inset-0 z-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-inset"
            />
            <div className="flex items-start justify-between">
              <div>
                {a.institutionName && (
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <InstitutionLogo name={a.institutionName} logoUrl={a.institutionLogoUrl} size={24} />
                    <p className="text-xs text-[var(--muted)]">{a.institutionName}</p>
                  </div>
                )}
                <p className="font-medium text-[var(--foreground)]">{a.name}</p>
              </div>
              <div className="relative z-10 flex items-center gap-2">
                <UpdateAutomobileDialog
                  id={a.id}
                  name={a.name}
                  valueCents={a.valueCents}
                  liabilityCents={a.liabilityCents}
                  insuranceMonthlyCents={a.insuranceMonthlyCents}
                />
              </div>
            </div>

            <div className={`grid gap-2 sm:gap-4 text-sm ${a.purchasePriceCents > BigInt(0) ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3"}`}>
              {a.purchasePriceCents > BigInt(0) && (
                <div>
                  <p className="text-[var(--muted)] text-xs mb-1">{t("auto.purchasePrice")}</p>
                  <p className="tabular-nums font-medium text-[var(--foreground)]">{formatCurrency(a.purchasePriceCents, 0)}</p>
                </div>
              )}
              <div>
                <p className="text-[var(--muted)] text-xs mb-1">{t("auto.value")}</p>
                <p className="tabular-nums font-medium text-[var(--foreground)]">{formatCurrency(a.valueCents, 0)}</p>
                {a.depreciationCents !== null && (
                  <p className={`text-xs tabular-nums ${a.depreciationCents >= BigInt(0) ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>
                    {a.depreciationCents >= BigInt(0) ? "+" : ""}
                    {formatCurrency(a.depreciationCents, 0)} ({a.depreciationPct}%)
                  </p>
                )}
              </div>
              <div>
                <p className="text-[var(--muted)] text-xs mb-1">{t("auto.loanDue")}</p>
                <p className={`tabular-nums font-medium ${a.liabilityCents > BigInt(0) ? "text-[var(--negative)]" : "text-[var(--muted)]"}`}>
                  {a.liabilityCents > BigInt(0) ? formatCurrency(a.liabilityCents, 0) : "-"}
                </p>
              </div>
              <div>
                <p className="text-[var(--muted)] text-xs mb-1">{t("auto.netValue")}</p>
                <p className="tabular-nums font-medium text-[var(--positive)]">{formatCurrency(a.equityCents, 0)}</p>
              </div>
            </div>

            {a.liabilityCents > BigInt(0) && (
              <div>
                <div className="flex justify-between text-xs text-[var(--muted)] mb-1.5">
                  <span>{t("auto.financing")}</span>
                  <span>{a.financingPct}%</span>
                </div>
                <div className="h-1.5 bg-[var(--surface-elevated)] rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      a.financingPct > 80 ? "bg-[var(--negative)]" : a.financingPct > 50 ? "bg-[var(--warning)]" : "bg-[var(--positive)]"
                    }`}
                    style={{ width: `${Math.min(a.financingPct, 100)}%` }}
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
