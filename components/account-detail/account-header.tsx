import { formatCurrency } from "@/lib/utils/format";
import { InstitutionLogo } from "@/components/shared/institution-logo";
import { getInstitutionLogoUrl } from "@/lib/domain/institutions";
import { UpdateRealEstateDialog } from "@/components/accounts/update-real-estate-dialog";
import { UpdateAutomobileDialog } from "@/components/accounts/update-automobile-dialog";
import { RenameAccountDialog } from "@/components/accounts/rename-account-dialog";
import { DeleteAccountButton } from "@/components/accounts/delete-account-button";
import type { getTranslations } from "next-intl/server";

type T = Awaited<ReturnType<typeof getTranslations>>;

export function AccountHeader({
  td,
  ta,
  account,
  subtypeLabel,
  isFiat,
  isInvestment,
  isRealEstate,
  isAutomobile,
  isLoan,
  isSynced,
  currentValue,
  latestDelta,
  hasCostBasis,
  taxRate,
  netAfterTax,
  value,
  liability,
}: Readonly<{
  td: T;
  ta: T;
  account: {
    id: string;
    name: string;
    type: string;
    institution: { name: string; logoUrl: string | null } | null;
    insuranceMonthlyCents: bigint | null;
  };
  subtypeLabel: string;
  isFiat: boolean;
  isInvestment: boolean;
  isRealEstate: boolean;
  isAutomobile: boolean;
  isLoan: boolean;
  isSynced: boolean;
  currentValue: bigint;
  latestDelta: bigint | null;
  hasCostBasis: boolean;
  taxRate: number | null;
  netAfterTax: bigint;
  value: bigint;
  liability: bigint;
}>) {
  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            {account.institution && (
              <InstitutionLogo
                name={account.institution.name}
                logoUrl={account.institution.logoUrl ?? getInstitutionLogoUrl(account.institution.name)}
                size={28}
              />
            )}
            <p className="text-xs text-[var(--muted)]">
              {account.institution?.name && `${account.institution.name} · `}{ta(account.type as Parameters<typeof ta>[0])}{subtypeLabel}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <h1 className="text-2xl font-semibold text-[var(--foreground)]">{account.name}</h1>
            <RenameAccountDialog id={account.id} name={account.name} />
          </div>
          {isFiat && latestDelta !== null && latestDelta !== BigInt(0) && (
            <p
              className={`text-sm tabular-nums mt-2 ${
                latestDelta > BigInt(0) ? "text-[var(--positive)]" : "text-[var(--negative)]"
              }`}
            >
              {td("syncChanged", { delta: `${latestDelta > BigInt(0) ? "+" : ""}${formatCurrency(latestDelta)}` })}
            </p>
          )}
        </div>
        <div className="text-right shrink-0">
          <p className={`text-2xl sm:text-3xl font-semibold tabular-nums ${isLoan ? "text-[var(--negative)]" : "text-[var(--accent)]"}`}>
            {formatCurrency(currentValue, 0)}
          </p>
          {isInvestment && hasCostBasis && taxRate !== null && (
            <p className="text-xs text-[var(--muted)] mt-1">
              {td("afterTax", { amount: formatCurrency(netAfterTax, 0) })}
            </p>
          )}
          {isFiat && !isSynced && (
            <div className="mt-3 flex justify-end">
              <DeleteAccountButton
                id={account.id}
                name={account.name}
                backHref="/accounts?tab=liquidites"
              />
            </div>
          )}
          {isInvestment && !isSynced && (
            <div className="mt-3 flex justify-end">
              <DeleteAccountButton
                id={account.id}
                name={account.name}
                backHref="/accounts?tab=investissements"
              />
            </div>
          )}
          {isRealEstate && (
            <div className="flex items-center gap-2 mt-3 justify-end">
              <UpdateRealEstateDialog
                id={account.id}
                name={account.name}
                valueCents={value}
                liabilityCents={liability}
              />
              {!isSynced && (
                <DeleteAccountButton
                  id={account.id}
                  name={account.name}
                  backHref="/accounts?tab=immobilier"
                />
              )}
            </div>
          )}
          {isAutomobile && (
            <div className="flex items-center gap-2 mt-3 justify-end">
              <UpdateAutomobileDialog
                id={account.id}
                name={account.name}
                valueCents={value}
                liabilityCents={liability}
                insuranceMonthlyCents={account.insuranceMonthlyCents ?? BigInt(0)}
              />
              {!isSynced && (
                <DeleteAccountButton
                  id={account.id}
                  name={account.name}
                  backHref="/accounts?tab=automobiles"
                />
              )}
            </div>
          )}
          {isLoan && !isSynced && (
            <div className="flex items-center gap-2 mt-3 justify-end">
              <DeleteAccountButton
                id={account.id}
                name={account.name}
                backHref="/accounts?tab=credits"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
