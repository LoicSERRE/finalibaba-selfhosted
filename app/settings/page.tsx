export const dynamic = "force-dynamic";

import { prisma } from "@/lib/prisma";
import { Settings } from "lucide-react";
import { AddInstitutionDialog } from "@/components/add-institution-dialog";
import { DeleteButton } from "@/components/delete-button";
import { EmptyState } from "@/components/empty-state";
import { deleteInstitution } from "@/lib/actions/institutions";
import { InstitutionLogo } from "@/components/institution-logo";
import { getInstitutionLogoUrl } from "@/lib/institutions";
import { ConnectOpenBankingButton, SyncOpenBankingButton } from "@/components/open-banking-buttons";
import { ConnectOpenBankingDialog } from "@/components/connect-open-banking-dialog";
import { ConfigureWoobDialog } from "@/components/configure-woob-dialog";
import { InstitutionSyncButton } from "@/components/institution-sync-button";
import { SyncStatus } from "@/components/sync-status";
import { getSyncStatus } from "@/lib/actions/sync";
import { getUserSettings, updateUserSettings } from "@/lib/actions/user-settings";
import { SaveSettingsButton } from "@/components/save-settings-button";
import { CheckCircle, AlertTriangle, Clock } from "lucide-react";

// Institutions managed by dedicated sync scripts — Woob config button hidden for these
const DEDICATED_SYNC_INSTITUTIONS = ["lcl", "trade republic"];

export default async function SettingsPage() {
  const gcConfigured = !!process.env.GOCARDLESS_SECRET_ID;

  const [institutions, syncStatus, userSettings] = await Promise.all([
    prisma.institution.findMany({
      include: {
        _count: { select: { accounts: true } },
        accounts: { where: { gocardlessAccountId: { not: null } }, select: { id: true } },
      },
      orderBy: { name: "asc" },
    }),
    getSyncStatus(),
    getUserSettings(),
  ]);

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-[var(--foreground)]">Paramètres</h1>
        <p className="text-sm text-[var(--muted)] mt-1">
          Configuration de votre espace
        </p>
      </div>

      {/* Institutions */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-[var(--foreground)]">Institutions</h2>
            <p className="text-xs text-[var(--muted)] mt-0.5">
              Banques, courtiers, plateformes crypto…
            </p>
          </div>
          <AddInstitutionDialog />
        </div>

        {institutions.length === 0 ? (
          <EmptyState
            icon={Settings}
            title="Aucune institution"
            description="Ajoutez votre première institution pour commencer à créer des comptes."
            action={<AddInstitutionDialog />}
          />
        ) : (
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl divide-y divide-[var(--border)]">
            {institutions.map((inst) => (
              <div
                key={inst.id}
                className="px-5 py-3.5 flex items-center justify-between"
              >
                <div className="flex items-center gap-3">
                  <InstitutionLogo
                    name={inst.name}
                    logoUrl={inst.logoUrl ?? getInstitutionLogoUrl(inst.name)}
                    size={32}
                  />
                  <div>
                    <p className="text-sm font-medium text-[var(--foreground)]">
                      {inst.name}
                    </p>
                    <p className="text-xs text-[var(--muted)] mt-0.5">
                      {inst._count.accounts}{" "}
                      {inst._count.accounts === 1 ? "compte" : "comptes"}
                      {inst.gocardlessInstitutionId && (
                        <span className="ml-2 text-[var(--accent)]">· Open Banking</span>
                      )}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {/* GoCardless Open Banking */}
                  {gcConfigured && (
                    inst.gocardlessInstitutionId
                      ? inst.accounts.length > 0
                        ? <SyncOpenBankingButton institutionId={inst.id} />
                        : <ConnectOpenBankingButton institutionId={inst.id} />
                      : <ConnectOpenBankingDialog institutionId={inst.id} institutionName={inst.name} />
                  )}
                  {/* Woob sync — masqué pour les institutions gérées par des scripts dédiés */}
                  {(() => {
                    if (DEDICATED_SYNC_INSTITUTIONS.includes(inst.name.toLowerCase())) return null;

                    const woobLog = syncStatus[`woob:${inst.id}`] ?? null;
                    return (
                      <>
                        {inst.woobModule && woobLog && (
                          <span className={`flex items-center gap-1 text-xs ${
                            woobLog.status === "success" ? "text-[var(--positive)]" :
                            woobLog.status === "auth_required" ? "text-amber-400" :
                            "text-[var(--negative)]"
                          }`}>
                            {woobLog.status === "success"
                              ? <CheckCircle size={12} />
                              : woobLog.status === "auth_required"
                              ? <AlertTriangle size={12} />
                              : <AlertTriangle size={12} />}
                          </span>
                        )}
                        {inst.woobModule && !woobLog && (
                          <Clock size={12} className="text-[var(--muted)]" />
                        )}
                        {inst.woobModule && <InstitutionSyncButton institutionId={inst.id} />}
                        <ConfigureWoobDialog
                          institutionId={inst.id}
                          institutionName={inst.name}
                          currentModule={inst.woobModule}
                        />
                      </>
                    );
                  })()}
                  <DeleteButton
                    label="Supprimer"
                    description={`L'institution « ${inst.name} » et tous ses comptes associés seront définitivement supprimés.`}
                    onDelete={async () => {
                      "use server";
                      await deleteInstitution(inst.id);
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Profil financier */}
      <section className="space-y-4">
        <div>
          <h2 className="text-base font-semibold text-[var(--foreground)]">Profil financier</h2>
          <p className="text-xs text-[var(--muted)] mt-0.5">
            Utilisé pour calculer votre taux d&apos;épargne, runway et revenus passifs
          </p>
        </div>
        <form action={updateUserSettings} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label htmlFor="salary" className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
                Salaire net mensuel
              </label>
              <div className="relative">
                <input
                  id="salary"
                  name="salary"
                  type="number"
                  inputMode="decimal"
                  autoComplete="off"
                  min="0"
                  step="1"
                  defaultValue={Number(userSettings.salaryNetCents) / 100}
                  placeholder="2000"
                  className="w-full bg-[var(--surface-elevated)] border border-[var(--border)] rounded-lg px-3 py-2 pr-8 text-sm text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/30 tabular-nums"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[var(--muted)]">€</span>
              </div>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="expenses" className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
                Dépenses incompressibles / mois
              </label>
              <div className="relative">
                <input
                  id="expenses"
                  name="expenses"
                  type="number"
                  inputMode="decimal"
                  autoComplete="off"
                  min="0"
                  step="1"
                  defaultValue={Number(userSettings.monthlyExpensesCents) / 100}
                  placeholder="900"
                  className="w-full bg-[var(--surface-elevated)] border border-[var(--border)] rounded-lg px-3 py-2 pr-8 text-sm text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/30 tabular-nums"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[var(--muted)]">€</span>
              </div>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="goal" className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
                Objectif patrimoine
              </label>
              <div className="relative">
                <input
                  id="goal"
                  name="goal"
                  type="number"
                  inputMode="decimal"
                  autoComplete="off"
                  min="0"
                  step="1000"
                  defaultValue={Number(userSettings.savingsGoalCents) / 100}
                  placeholder="50000"
                  className="w-full bg-[var(--surface-elevated)] border border-[var(--border)] rounded-lg px-3 py-2 pr-8 text-sm text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/30 tabular-nums"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[var(--muted)]">€</span>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label htmlFor="saved" className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
                Épargne mensuelle déclarée
              </label>
              <div className="relative">
                <input
                  id="saved"
                  name="saved"
                  type="number"
                  inputMode="decimal"
                  autoComplete="off"
                  min="0"
                  step="1"
                  defaultValue={Number(userSettings.monthlySavedCents) / 100}
                  placeholder="1100"
                  className="w-full bg-[var(--surface-elevated)] border border-[var(--border)] rounded-lg px-3 py-2 pr-8 text-sm text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/30 tabular-nums"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[var(--muted)]">€</span>
              </div>
              <p className="text-xs text-[var(--muted)] opacity-70">Livrets + investissements — hors virements inter-comptes et perf marché</p>
            </div>
          </div>
          <div className="flex justify-end">
            <SaveSettingsButton />
          </div>
        </form>
      </section>

      {/* Sync automatique */}
      <section className="space-y-4">
        <div>
          <h2 className="text-base font-semibold text-[var(--foreground)]">Synchronisation automatique</h2>
          <p className="text-xs text-[var(--muted)] mt-0.5">
            Sync toutes les 4h · TR keepalive toutes les 2h
          </p>
        </div>
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl px-5 divide-y divide-[var(--border)]">
          <SyncStatus
            source="lcl"
            label="LCL"
            log={syncStatus["lcl"] ?? null}
          />
          <SyncStatus
            source="trade-republic"
            label="Trade Republic"
            log={syncStatus["trade_republic"] ?? null}
          />
        </div>
        <p className="text-xs text-[var(--muted)]">
          LCL → première connexion : <code className="text-[var(--foreground)]">docker exec -it finalibaba-sync-1 python setup_lcl.py</code>
        </p>
      </section>

    </div>
  );
}
