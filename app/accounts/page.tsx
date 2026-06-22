export const dynamic = "force-dynamic";

import { prisma } from "@/lib/prisma";
import { formatCurrency } from "@/lib/format";
import Link from "next/link";
import { AddAccountDialog } from "@/components/add-account-dialog";
import { AddAutomobileDialog } from "@/components/add-automobile-dialog";
import { AddRealEstateDialog } from "@/components/add-real-estate-dialog";
import { AddLoanDialog } from "@/components/add-loan-dialog";
import { DeleteAccountButton } from "@/components/delete-account-button";
import { UpdateRealEstateDialog } from "@/components/update-real-estate-dialog";
import { UpdateAutomobileDialog } from "@/components/update-automobile-dialog";
import { Sparkline } from "@/components/sparkline";
import { InstitutionLogo } from "@/components/institution-logo";
import { getInstitutionLogoUrl } from "@/lib/institutions";
import {
  ExportAccountsButton,
  type FiatAccountExport,
  type InvestAccountExport,
  type RealEstateAccountExport,
  type AutomobileAccountExport,
} from "@/components/export-accounts-button";
import Decimal from "decimal.js";
import { calcLoanStats, hasLoanParams } from "@/lib/loan";

const TYPE_LABELS: Record<string, string> = {
  CHECKING: "Courant",
  SAVINGS: "Épargne",
  MEAL_VOUCHER: "Titre-resto",
  INVESTMENT: "Investissements",
  CRYPTO: "Crypto",
  AUTOMOBILE: "Automobile",
};

const TABS = [
  { id: "liquidites", label: "Liquidités", labelShort: "Liquidités" },
  { id: "investissements", label: "Investissements", labelShort: "Invest." },
  { id: "immobilier", label: "Immobilier", labelShort: "Immo." },
  { id: "automobiles", label: "Automobiles", labelShort: "Auto." },
  { id: "credits", label: "Crédits", labelShort: "Crédits" },
] as const;

type TabId = (typeof TABS)[number]["id"];

const TAX_RATES: Record<string, number> = { PEA: 0.172, CTO: 0.314, CRYPTO: 0.30 };

function taxRate(type: string, subtype: string | null): number | null {
  if (type === "CRYPTO") return TAX_RATES.CRYPTO;
  if (type === "INVESTMENT" && subtype) return TAX_RATES[subtype] ?? null;
  return null;
}

function holdingValue(h: { quantity: Decimal; lastPriceCents: bigint }): bigint {
  return BigInt(
    new Decimal(h.quantity.toString())
      .mul(h.lastPriceCents.toString())
      .round()
      .toNumber()
  );
}

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab: rawTab = "liquidites" } = await searchParams;
  const tab = (TABS.some((t) => t.id === rawTab) ? rawTab : "liquidites") as TabId;

  const [fiatAccounts, investAccounts, realEstateAccounts, automobileAccounts, loanAccounts, institutions] =
    await Promise.all([
      prisma.account.findMany({
        where: { type: { in: ["CHECKING", "SAVINGS", "MEAL_VOUCHER"] } },
        include: {
          institution: true,
          history: { orderBy: { recordedAt: "desc" }, take: 14 },
        },
        orderBy: [{ institution: { name: "asc" } }, { name: "asc" }],
      }),
      prisma.account.findMany({
        where: { type: { in: ["INVESTMENT", "CRYPTO"] } },
        include: {
          institution: true,
          holdings: { orderBy: { ticker: "asc" } },
        },
        orderBy: [{ type: "asc" }, { name: "asc" }],
      }),
      prisma.account.findMany({
        where: { type: "REAL_ESTATE" },
        include: { institution: true },
        orderBy: { name: "asc" },
      }),
      prisma.account.findMany({
        where: { type: "AUTOMOBILE" },
        include: { institution: true },
        orderBy: { name: "asc" },
      }),
      prisma.account.findMany({
        where: { type: "LOAN" },
        include: { institution: true },
        orderBy: { name: "asc" },
      }),
      prisma.institution.findMany({ orderBy: { name: "asc" } }),
    ]);

  const fiatTotal = fiatAccounts.reduce(
    (s, a) => s + (a.history[0]?.balanceCents ?? BigInt(0)),
    BigInt(0)
  );
  const investTotal = investAccounts.reduce(
    (s, a) => s + a.holdings.reduce((sum, h) => sum + holdingValue(h), BigInt(0)),
    BigInt(0)
  );
  const realEstateEquity = realEstateAccounts.reduce(
    (s, p) => s + ((p.manualValueCents ?? BigInt(0)) - (p.liabilityCents ?? BigInt(0))),
    BigInt(0)
  );
  const automobileEquity = automobileAccounts.reduce(
    (s, a) => s + ((a.manualValueCents ?? BigInt(0)) - (a.liabilityCents ?? BigInt(0))),
    BigInt(0)
  );

  const now = new Date();
  const loanTotal = loanAccounts.reduce((s, loan) => {
    const capital = hasLoanParams(loan)
      ? calcLoanStats(
          {
            loanAmountCents: loan.loanAmountCents,
            loanTaeg: loan.loanTaeg,
            loanDurationMonths: loan.loanDurationMonths,
            loanDeferralMonths: loan.loanDeferralMonths ?? 0,
            loanStartDate: loan.loanStartDate,
          },
          loan.insuranceMonthlyCents ?? BigInt(0),
          now
        ).currentCapitalCents
      : (loan.liabilityCents ?? BigInt(0));
    return s + capital;
  }, BigInt(0));

  const tabTotals: Record<TabId, bigint> = {
    liquidites: fiatTotal,
    investissements: investTotal,
    immobilier: realEstateEquity,
    automobiles: automobileEquity,
    credits: loanTotal,
  };

  const defaultType =
    tab === "investissements"
      ? "INVESTMENT"
      : tab === "immobilier"
      ? "REAL_ESTATE"
      : tab === "automobiles"
      ? "AUTOMOBILE"
      : tab === "credits"
      ? "LOAN"
      : "CHECKING";

  // ── Serialized data for export (BigInt → number) ──────────────────────────
  const fiatExport: FiatAccountExport[] = fiatAccounts.map((a) => ({
    id: a.id,
    name: a.name,
    institutionName: a.institution?.name ?? "",
    type: a.type,
    balanceCents: Number(a.history[0]?.balanceCents ?? BigInt(0)),
    deltaCents: Number(
      (a.history[0]?.balanceCents ?? BigInt(0)) -
        (a.history[1]?.balanceCents ?? a.history[0]?.balanceCents ?? BigInt(0))
    ),
  }));

  const investExport: InvestAccountExport[] = investAccounts.map((account) => {
    const rate = taxRate(account.type, account.investmentSubtype ?? null);
    const accountTotal = account.holdings.reduce((s, h) => s + holdingValue(h), BigInt(0));
    let accountGain = BigInt(0);
    let hasCostBasis = false;
    for (const h of account.holdings) {
      if (h.costBasisCents != null) {
        hasCostBasis = true;
        accountGain += holdingValue(h) - h.costBasisCents;
      }
    }
    const accountTax =
      hasCostBasis && rate !== null && accountGain > BigInt(0)
        ? BigInt(Math.round(Number(accountGain) * rate))
        : BigInt(0);
    return {
      id: account.id,
      name: account.name,
      institutionName: account.institution?.name ?? "",
      type: account.type,
      investmentSubtype: account.investmentSubtype ?? null,
      totalCents: Number(accountTotal),
      gainCents: hasCostBasis ? Number(accountGain) : null,
      taxCents: hasCostBasis ? Number(accountTax) : null,
      holdings: account.holdings.map((h) => {
        const value = holdingValue(h);
        const pct =
          accountTotal > BigInt(0)
            ? Math.round((Number(value) / Number(accountTotal)) * 100)
            : 0;
        const gain = h.costBasisCents != null ? value - h.costBasisCents : null;
        const gainPct =
          gain !== null && h.costBasisCents != null && h.costBasisCents > BigInt(0)
            ? (Number(gain) / Number(h.costBasisCents)) * 100
            : null;
        const tax =
          gain !== null && rate !== null && gain > BigInt(0)
            ? BigInt(Math.round(Number(gain) * rate))
            : null;
        return {
          ticker: h.ticker,
          name: h.name ?? null,
          quantity: new Decimal(h.quantity.toString()).toSignificantDigits(6).toString(),
          lastPriceCents: Number(h.lastPriceCents),
          valueCents: Number(value),
          pct,
          costBasisCents: h.costBasisCents != null ? Number(h.costBasisCents) : null,
          gainCents: gain != null ? Number(gain) : null,
          gainPct,
          taxCents: tax != null ? Number(tax) : null,
        };
      }),
    };
  });

  const realEstateExport: RealEstateAccountExport[] = realEstateAccounts.map((p) => {
    const value = p.manualValueCents ?? BigInt(0);
    const liability = p.liabilityCents ?? BigInt(0);
    const equity = value - liability;
    const ltv =
      value > BigInt(0) ? Math.round((Number(liability) / Number(value)) * 100) : 0;
    return {
      id: p.id,
      name: p.name,
      institutionName: p.institution?.name ?? "",
      valueCents: Number(value),
      liabilityCents: Number(liability),
      equityCents: Number(equity),
      ltv,
    };
  });

  const automobileExport: AutomobileAccountExport[] = automobileAccounts.map((a) => {
    const value = a.manualValueCents ?? BigInt(0);
    const purchasePrice = a.purchasePriceCents ?? BigInt(0);
    const liability = a.liabilityCents ?? BigInt(0);
    const equity = value - liability;
    const depreciation = purchasePrice > BigInt(0) ? value - purchasePrice : null;
    const depreciationPct =
      purchasePrice > BigInt(0)
        ? Math.round((Number(depreciation!) / Number(purchasePrice)) * 100)
        : null;
    return {
      id: a.id,
      name: a.name,
      institutionName: a.institution?.name ?? "",
      valueCents: Number(value),
      purchasePriceCents: Number(purchasePrice),
      liabilityCents: Number(liability),
      equityCents: Number(equity),
      depreciationCents: depreciation != null ? Number(depreciation) : null,
      depreciationPct,
    };
  });

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-[var(--foreground)]">Comptes</h1>
        <div className="flex items-center gap-2">
          <ExportAccountsButton
            fiatAccounts={fiatExport}
            investAccounts={investExport}
            realEstateAccounts={realEstateExport}
            automobileAccounts={automobileExport}
          />
          <AddAccountDialog institutions={institutions} defaultType={defaultType} />
        </div>
      </div>

      {/* Tabs */}
      <div className="grid grid-cols-5 bg-[var(--surface)] border border-[var(--border)] rounded-xl p-1 gap-1">
        {TABS.map(({ id, label, labelShort }) => (
          <Link
            key={id}
            href={`/accounts?tab=${id}`}
            className={`flex flex-col items-center py-2.5 px-1 rounded-lg text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
              tab === id
                ? "bg-[var(--accent)]/15 text-[var(--accent)]"
                : "text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--surface-elevated)]"
            }`}
          >
            <span className="text-xs font-medium sm:hidden">{labelShort}</span>
            <span className="text-sm font-medium hidden sm:block">{label}</span>
            <span className="hidden sm:block text-xs mt-0.5 tabular-nums opacity-75">
              {formatCurrency(tabTotals[id], 0)}
            </span>
          </Link>
        ))}
      </div>

      {/* ── Liquidités ── */}
      {tab === "liquidites" && (
        <div className="space-y-3">
          {fiatAccounts.length === 0 ? (
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-10 text-center text-sm text-[var(--muted)]">
              Aucun compte — ajoutez-en avec le bouton ci-dessus.
            </div>
          ) : (
            fiatAccounts.map((account) => {
              const current = account.history[0]?.balanceCents ?? BigInt(0);
              const previous = account.history[1]?.balanceCents ?? current;
              const delta = current - previous;
              const sparkValues = account.history
                .slice()
                .reverse()
                .map((h) => Number(h.balanceCents));

              return (
                <Link
                  key={account.id}
                  href={`/accounts/${account.id}`}
                  className="block bg-[var(--surface)] border border-[var(--border)] rounded-xl px-6 py-4 hover:border-[var(--accent)]/40 hover:bg-[var(--surface-elevated)] active:scale-[0.98] active:opacity-90 transition cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]"
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        {account.institution && (
                          <InstitutionLogo
                            name={account.institution.name}
                            logoUrl={account.institution.logoUrl ?? getInstitutionLogoUrl(account.institution.name)}
                            size={24}
                          />
                        )}
                        <p className="text-xs text-[var(--muted)]">
                          {account.institution?.name && `${account.institution.name} · `}{TYPE_LABELS[account.type] ?? account.type}
                        </p>
                      </div>
                      <p className="font-medium text-[var(--foreground)] truncate">{account.name}</p>
                    </div>
                    <div className="flex items-center gap-3 sm:gap-4 shrink-0">
                      {sparkValues.length >= 2 && <span className="hidden sm:block"><Sparkline values={sparkValues} /></span>}
                      <div className="text-right min-w-[110px]">
                        <p className="text-lg font-semibold tabular-nums text-[var(--foreground)]">
                          {formatCurrency(current)}
                        </p>
                        {delta !== BigInt(0) && (
                          <p
                            className={`text-xs tabular-nums ${
                              delta > BigInt(0) ? "text-[var(--positive)]" : "text-[var(--negative)]"
                            }`}
                          >
                            {delta > BigInt(0) ? "+" : ""}
                            {formatCurrency(delta)}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })
          )}
        </div>
      )}

      {/* ── Investissements ── */}
      {tab === "investissements" && (
        <div className="space-y-6">
          {investAccounts.length === 0 ? (
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-10 text-center text-sm text-[var(--muted)]">
              Aucun compte — ajoutez-en avec le bouton ci-dessus.
            </div>
          ) : (
            investAccounts.map((account) => {
              const rate = taxRate(account.type, account.investmentSubtype ?? null);
              const accountTotal = account.holdings.reduce(
                (s, h) => s + holdingValue(h),
                BigInt(0)
              );
              // Net gain + tax across holdings with known cost basis
              let accountGain = BigInt(0);
              let hasCostBasis = false;
              for (const h of account.holdings) {
                if (h.costBasisCents != null) {
                  hasCostBasis = true;
                  accountGain += holdingValue(h) - h.costBasisCents;
                }
              }
              const accountTax =
                hasCostBasis && rate !== null && accountGain > BigInt(0)
                  ? BigInt(Math.round(Number(accountGain) * rate))
                  : BigInt(0);

              return (
                <div
                  key={account.id}
                  className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden"
                >
                  <div className="px-4 sm:px-6 py-4 border-b border-[var(--border)] flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        {account.institution && (
                          <InstitutionLogo
                            name={account.institution.name}
                            logoUrl={account.institution.logoUrl ?? getInstitutionLogoUrl(account.institution.name)}
                            size={24}
                          />
                        )}
                        <p className="text-xs text-[var(--muted)] truncate">
                          {account.institution?.name && `${account.institution.name} · `}{TYPE_LABELS[account.type] ?? account.type}
                          {account.investmentSubtype && ` · ${account.investmentSubtype}`}
                        </p>
                      </div>
                      <p className="font-medium text-[var(--foreground)] truncate">{account.name}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-base font-semibold tabular-nums text-[var(--foreground)]">
                        {formatCurrency(accountTotal, 0)}
                      </p>
                      {hasCostBasis && (
                        <p className={`text-xs tabular-nums ${accountGain >= BigInt(0) ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>
                          {accountGain >= BigInt(0) ? "+" : ""}{formatCurrency(accountGain, 0)}
                          {accountTax > BigInt(0) && (
                            <span className="text-[var(--muted)] hidden sm:inline"> · -{formatCurrency(accountTax, 0)} impôts</span>
                          )}
                        </p>
                      )}
                    </div>
                  </div>

                  {account.holdings.length === 0 ? (
                    <div className="px-6 py-8 text-center text-sm text-[var(--muted)]">
                      Aucune position.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-[var(--border)]">
                          <th className="px-4 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wider">Actif</th>
                          <th className="hidden sm:table-cell px-4 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wider">Quantité</th>
                          <th className="hidden sm:table-cell px-4 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wider">Prix</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wider">Valeur</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wider">Plus-value</th>
                          {rate !== null && (
                            <th className="hidden sm:table-cell px-4 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wider">Impôt latent</th>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {account.holdings.map((h, i) => {
                          const value = holdingValue(h);
                          const pct =
                            accountTotal > BigInt(0)
                              ? Math.round((Number(value) / Number(accountTotal)) * 100)
                              : 0;
                          const gain = h.costBasisCents != null ? value - h.costBasisCents : null;
                          const gainPct =
                            gain !== null && h.costBasisCents != null && h.costBasisCents > BigInt(0)
                              ? (Number(gain) / Number(h.costBasisCents)) * 100
                              : null;
                          const tax =
                            gain !== null && rate !== null && gain > BigInt(0)
                              ? BigInt(Math.round(Number(gain) * rate))
                              : gain !== null && rate !== null
                              ? BigInt(0)
                              : null;

                          return (
                            <tr
                              key={h.id}
                              className={`${
                                i < account.holdings.length - 1
                                  ? "border-b border-[var(--border)]"
                                  : ""
                              } hover:bg-[var(--surface-elevated)] transition-colors`}
                            >
                              <td className="px-4 py-3">
                                <p className="font-medium text-[var(--foreground)]">{h.name || h.ticker}</p>
                                <p className="text-xs text-[var(--muted)]">{h.ticker}</p>
                              </td>
                              <td className="hidden sm:table-cell px-4 py-3 tabular-nums text-[var(--foreground)]">
                                {new Decimal(h.quantity.toString())
                                  .toSignificantDigits(6)
                                  .toString()}
                              </td>
                              <td className="hidden sm:table-cell px-4 py-3 tabular-nums text-[var(--foreground)]">
                                {formatCurrency(h.lastPriceCents)}
                              </td>
                              <td className="px-4 py-3">
                                <p className="tabular-nums font-medium text-[var(--foreground)]">
                                  {formatCurrency(value)}
                                </p>
                                <p className="text-xs text-[var(--muted)]">{pct}%</p>
                              </td>
                              <td className="px-4 py-3 tabular-nums">
                                {gain === null ? (
                                  <span className="text-[var(--muted)] text-xs">—</span>
                                ) : (
                                  <div>
                                    <p className={`font-medium ${gain >= BigInt(0) ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>
                                      {gain >= BigInt(0) ? "+" : ""}{formatCurrency(gain)}
                                    </p>
                                    {gainPct !== null && (
                                      <p className={`text-xs ${gainPct >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>
                                        {gainPct >= 0 ? "+" : ""}{gainPct.toFixed(1)}%
                                      </p>
                                    )}
                                  </div>
                                )}
                              </td>
                              {rate !== null && (
                                <td className="hidden sm:table-cell px-4 py-3 tabular-nums">
                                  {tax === null ? (
                                    <span className="text-[var(--muted)] text-xs">—</span>
                                  ) : tax === BigInt(0) ? (
                                    <span className="text-[var(--muted)] text-xs">0,00 €</span>
                                  ) : (
                                    <p className="text-[var(--negative)] font-medium">-{formatCurrency(tax)}</p>
                                  )}
                                </td>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ── Immobilier ── */}
      {tab === "immobilier" && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <AddRealEstateDialog institutions={institutions} />
          </div>
          {realEstateAccounts.length === 0 ? (
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-10 text-center text-sm text-[var(--muted)]">
              Aucun bien immobilier — utilisez le bouton ci-dessus pour en ajouter un.
            </div>
          ) : (
            realEstateAccounts.map((p) => {
              const value = p.manualValueCents ?? BigInt(0);
              const liability = p.liabilityCents ?? BigInt(0);
              const equity = value - liability;
              const ltv =
                value > BigInt(0)
                  ? Math.round((Number(liability) / Number(value)) * 100)
                  : 0;

              return (
                <div
                  key={p.id}
                  className="relative bg-[var(--surface)] border border-[var(--border)] rounded-xl p-6 space-y-5 hover:border-[var(--accent)]/40 hover:bg-[var(--surface-elevated)] active:scale-[0.98] active:opacity-90 transition cursor-pointer"
                >
                  <Link href={`/accounts/${p.id}`} aria-label={`Voir ${p.name}`} className="absolute inset-0 z-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-inset" />
                  <div className="flex items-start justify-between">
                    <div>
                      {p.institution && (
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <InstitutionLogo
                            name={p.institution.name}
                            logoUrl={p.institution.logoUrl ?? getInstitutionLogoUrl(p.institution.name)}
                            size={24}
                          />
                          <p className="text-xs text-[var(--muted)]">{p.institution.name}</p>
                        </div>
                      )}
                      <p className="font-medium text-[var(--foreground)]">{p.name}</p>
                    </div>
                    <div className="relative z-10 flex items-center gap-2">
                      <UpdateRealEstateDialog
                        id={p.id}
                        name={p.name}
                        valueCents={value}
                        liabilityCents={liability}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 sm:gap-4 text-sm">
                    <div>
                      <p className="text-[var(--muted)] text-xs mb-1">Valeur estimée</p>
                      <p className="tabular-nums font-medium text-[var(--foreground)]">
                        {formatCurrency(value, 0)}
                      </p>
                    </div>
                    <div>
                      <p className="text-[var(--muted)] text-xs mb-1">Capital restant dû</p>
                      <p className="tabular-nums font-medium text-[var(--negative)]">
                        {formatCurrency(liability, 0)}
                      </p>
                    </div>
                    <div>
                      <p className="text-[var(--muted)] text-xs mb-1">Fonds propres</p>
                      <p className="tabular-nums font-medium text-[var(--positive)]">
                        {formatCurrency(equity, 0)}
                      </p>
                    </div>
                  </div>

                  {liability > BigInt(0) && (
                    <div>
                      <div className="flex justify-between text-xs text-[var(--muted)] mb-1.5">
                        <span>LTV</span>
                        <span>{ltv}%</span>
                      </div>
                      <div className="h-1.5 bg-[var(--surface-elevated)] rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${
                            ltv > 80
                              ? "bg-[var(--negative)]"
                              : ltv > 60
                              ? "bg-[var(--accent)]"
                              : "bg-[var(--positive)]"
                          }`}
                          style={{ width: `${Math.min(ltv, 100)}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ── Crédits ── */}
      {tab === "credits" && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <AddLoanDialog institutions={institutions} />
          </div>
          {loanAccounts.length === 0 ? (
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-10 text-center text-sm text-[var(--muted)]">
              Aucun crédit — utilisez le bouton ci-dessus pour en ajouter un.
            </div>
          ) : (
            loanAccounts.map((loan) => {
              if (!hasLoanParams(loan)) {
                return (
                  <div key={loan.id} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-6 flex items-center justify-between">
                    <div>
                      <p className="font-medium text-[var(--foreground)]">{loan.name}</p>
                      <p className="text-xs text-[var(--muted)] mt-1">Paramètres incomplets.</p>
                    </div>
                    <DeleteAccountButton id={loan.id} name={loan.name} backHref="/accounts?tab=credits" />
                  </div>
                );
              }
              const loanParams = {
                loanAmountCents: loan.loanAmountCents,
                loanTaeg: loan.loanTaeg,
                loanDurationMonths: loan.loanDurationMonths,
                loanDeferralMonths: loan.loanDeferralMonths ?? 0,
                loanStartDate: loan.loanStartDate,
              };
              const stats = calcLoanStats(loanParams, loan.insuranceMonthlyCents ?? BigInt(0), now);
              const progressColor =
                stats.progressPct > 75
                  ? "bg-[var(--positive)]"
                  : stats.progressPct > 40
                  ? "bg-[var(--accent)]"
                  : "bg-[var(--negative)]";

              return (
                <div
                  key={loan.id}
                  className="relative bg-[var(--surface)] border border-[var(--border)] rounded-xl p-6 space-y-4 hover:border-[var(--accent)]/40 hover:bg-[var(--surface-elevated)] active:scale-[0.98] active:opacity-90 transition cursor-pointer"
                >
                  <Link href={`/accounts/${loan.id}`} aria-label={`Voir ${loan.name}`} className="absolute inset-0 z-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-inset" />
                  <div className="flex items-start justify-between">
                    <div>
                      {loan.institution && (
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <InstitutionLogo
                            name={loan.institution.name}
                            logoUrl={loan.institution.logoUrl ?? getInstitutionLogoUrl(loan.institution.name)}
                            size={24}
                          />
                          <p className="text-xs text-[var(--muted)]">{loan.institution.name}</p>
                        </div>
                      )}
                      <p className="font-medium text-[var(--foreground)]">{loan.name}</p>
                      <p className="text-xs text-[var(--muted)] mt-0.5">
                        TAEG {loan.loanTaeg.toFixed(2)}% · {loan.loanDurationMonths} mois
                        {(loan.loanDeferralMonths ?? 0) > 0 && ` · différé ${loan.loanDeferralMonths} mois`}
                      </p>
                    </div>
                    <div className="relative z-10 flex items-center gap-3">
                      <div className="text-right">
                        <p className="text-lg font-semibold tabular-nums text-[var(--negative)]">
                          {formatCurrency(stats.currentCapitalCents, 0)}
                        </p>
                        <p className="text-xs text-[var(--muted)]">capital restant dû</p>
                      </div>
                      <DeleteAccountButton
                        id={loan.id}
                        name={loan.name}
                        backHref="/accounts?tab=credits"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-4 text-sm">
                    <div>
                      <p className="text-[var(--muted)] text-xs mb-1">Montant emprunté</p>
                      <p className="tabular-nums font-medium text-[var(--foreground)]">
                        {formatCurrency(loan.loanAmountCents, 0)}
                      </p>
                    </div>
                    <div>
                      <p className="text-[var(--muted)] text-xs mb-1">Mensualité actuelle</p>
                      <p className="tabular-nums font-medium text-[var(--foreground)]">
                        {formatCurrency(stats.currentMonthlyTotalCents)}
                        {(loan.insuranceMonthlyCents ?? BigInt(0)) > BigInt(0) && (
                          <span className="text-xs text-[var(--muted)] font-normal"> (ass. incl.)</span>
                        )}
                      </p>
                    </div>
                    <div>
                      <p className="text-[var(--muted)] text-xs mb-1">Coût total crédit</p>
                      <p className="tabular-nums font-medium text-[var(--negative)]">
                        {formatCurrency(stats.totalCostCents, 0)}
                      </p>
                    </div>
                    <div>
                      <p className="text-[var(--muted)] text-xs mb-1">Fin prévue</p>
                      <p className="tabular-nums font-medium text-[var(--foreground)]">
                        {new Intl.DateTimeFormat("fr-FR", { month: "short", year: "numeric" }).format(stats.endDate)}
                      </p>
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between text-xs text-[var(--muted)] mb-1.5">
                      <span>Remboursement</span>
                      <span>{stats.progressPct}%</span>
                    </div>
                    <div className="h-1.5 bg-[var(--surface-elevated)] rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${progressColor}`}
                        style={{ width: `${stats.progressPct}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ── Automobiles ── */}
      {tab === "automobiles" && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <AddAutomobileDialog institutions={institutions} />
          </div>

          {automobileAccounts.length === 0 ? (
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-10 text-center text-sm text-[var(--muted)]">
              Aucun véhicule — utilisez le bouton ci-dessus pour en ajouter un.
            </div>
          ) : (
            automobileAccounts.map((a) => {
              const value = a.manualValueCents ?? BigInt(0);
              const purchasePrice = a.purchasePriceCents ?? BigInt(0);
              const liability = a.liabilityCents ?? BigInt(0);
              const equity = value - liability;
              const depreciation = purchasePrice > BigInt(0) ? value - purchasePrice : null;
              const depreciationPct =
                purchasePrice > BigInt(0)
                  ? Math.round((Number(depreciation!) / Number(purchasePrice)) * 100)
                  : null;
              const financement =
                value > BigInt(0)
                  ? Math.round((Number(liability) / Number(value)) * 100)
                  : 0;

              return (
                <div
                  key={a.id}
                  className="relative bg-[var(--surface)] border border-[var(--border)] rounded-xl p-6 space-y-4 hover:border-[var(--accent)]/40 hover:bg-[var(--surface-elevated)] active:scale-[0.98] active:opacity-90 transition cursor-pointer"
                >
                  <Link href={`/accounts/${a.id}`} aria-label={`Voir ${a.name}`} className="absolute inset-0 z-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-inset" />
                  <div className="flex items-start justify-between">
                    <div>
                      {a.institution && (
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <InstitutionLogo
                            name={a.institution.name}
                            logoUrl={a.institution.logoUrl ?? getInstitutionLogoUrl(a.institution.name)}
                            size={24}
                          />
                          <p className="text-xs text-[var(--muted)]">{a.institution.name}</p>
                        </div>
                      )}
                      <p className="font-medium text-[var(--foreground)]">{a.name}</p>
                    </div>
                    <div className="relative z-10 flex items-center gap-2">
                      <UpdateAutomobileDialog
                        id={a.id}
                        name={a.name}
                        valueCents={value}
                        liabilityCents={liability}
                        insuranceMonthlyCents={a.insuranceMonthlyCents ?? BigInt(0)}
                      />
                    </div>
                  </div>

                  <div className={`grid gap-2 sm:gap-4 text-sm ${purchasePrice > BigInt(0) ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3"}`}>
                    {purchasePrice > BigInt(0) && (
                      <div>
                        <p className="text-[var(--muted)] text-xs mb-1">Prix d&apos;achat</p>
                        <p className="tabular-nums font-medium text-[var(--foreground)]">
                          {formatCurrency(purchasePrice, 0)}
                        </p>
                      </div>
                    )}
                    <div>
                      <p className="text-[var(--muted)] text-xs mb-1">Valeur actuelle</p>
                      <p className="tabular-nums font-medium text-[var(--foreground)]">
                        {formatCurrency(value, 0)}
                      </p>
                      {depreciation !== null && (
                        <p
                          className={`text-xs tabular-nums ${
                            depreciation >= BigInt(0) ? "text-[var(--positive)]" : "text-[var(--negative)]"
                          }`}
                        >
                          {depreciation >= BigInt(0) ? "+" : ""}
                          {formatCurrency(depreciation, 0)} ({depreciationPct}%)
                        </p>
                      )}
                    </div>
                    <div>
                      <p className="text-[var(--muted)] text-xs mb-1">Crédit restant dû</p>
                      <p className={`tabular-nums font-medium ${liability > BigInt(0) ? "text-[var(--negative)]" : "text-[var(--muted)]"}`}>
                        {liability > BigInt(0) ? formatCurrency(liability, 0) : "—"}
                      </p>
                    </div>
                    <div>
                      <p className="text-[var(--muted)] text-xs mb-1">Valeur nette</p>
                      <p className="tabular-nums font-medium text-[var(--positive)]">
                        {formatCurrency(equity, 0)}
                      </p>
                    </div>
                  </div>

                  {liability > BigInt(0) && (
                    <div>
                      <div className="flex justify-between text-xs text-[var(--muted)] mb-1.5">
                        <span>Financement</span>
                        <span>{financement}%</span>
                      </div>
                      <div className="h-1.5 bg-[var(--surface-elevated)] rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${
                            financement > 80
                              ? "bg-[var(--negative)]"
                              : financement > 50
                              ? "bg-[var(--accent)]"
                              : "bg-[var(--positive)]"
                          }`}
                          style={{ width: `${Math.min(financement, 100)}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
