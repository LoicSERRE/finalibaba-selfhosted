import { getTranslations } from "next-intl/server";
import { updateAlertTriggers } from "@/lib/actions/alerts";
import { SaveSettingsButton } from "@/components/settings/save-settings-button";
import { InfoTooltip } from "@/components/ui/info-tooltip";

const inputClass =
  "w-full bg-[var(--surface-elevated)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/30";

// Server component (no "use client") - unlike AlertChannelsSection, nothing
// here needs local state or event handlers, just native form elements
// posting straight to a Server Action.
export async function AlertTriggersSection({
  settings,
}: Readonly<{
  settings: {
    netWorthAlertThresholdCents: bigint | null;
    loanAlertsEnabled: boolean;
    syncFailureAlertsEnabled: boolean;
    sectorDataAlertsEnabled: boolean;
  };
}>) {
  const t = await getTranslations("settings.alertTriggers");

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-[var(--foreground)]">{t("title")}</h2>
        <p className="text-xs text-[var(--muted)] mt-0.5">{t("subtitle")}</p>
      </div>
      <form action={updateAlertTriggers} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 space-y-5">
        <div className="space-y-1.5">
          <label htmlFor="netWorthAlertThreshold" className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider flex items-center gap-1">
            {t("netWorthThreshold")}
            <InfoTooltip>{t("netWorthThresholdHint")}</InfoTooltip>
          </label>
          <div className="relative">
            <input
              id="netWorthAlertThreshold"
              name="netWorthAlertThreshold"
              type="number"
              inputMode="decimal"
              autoComplete="off"
              min="0"
              step="1"
              defaultValue={settings.netWorthAlertThresholdCents !== null ? Number(settings.netWorthAlertThresholdCents) / 100 : ""}
              placeholder={t("netWorthThresholdPlaceholder")}
              className={`${inputClass} pr-8 tabular-nums`}
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[var(--muted)]">€</span>
          </div>
        </div>

        <div className="pt-2 border-t border-[var(--border)] space-y-3">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              name="loanAlertsEnabled"
              defaultChecked={settings.loanAlertsEnabled}
              className="w-4 h-4 rounded accent-[var(--accent)]"
            />
            <span className="text-sm text-[var(--foreground)]">{t("triggerLoan")}</span>
          </label>
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              name="syncFailureAlertsEnabled"
              defaultChecked={settings.syncFailureAlertsEnabled}
              className="w-4 h-4 rounded accent-[var(--accent)]"
            />
            <span className="text-sm text-[var(--foreground)]">{t("triggerSyncFailure")}</span>
          </label>
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              name="sectorDataAlertsEnabled"
              defaultChecked={settings.sectorDataAlertsEnabled}
              className="w-4 h-4 rounded accent-[var(--accent)]"
            />
            <span className="text-sm text-[var(--foreground)] flex items-center gap-1">
              {t("triggerSectorData")}
              <InfoTooltip>{t("triggerSectorDataHint")}</InfoTooltip>
            </span>
          </label>
        </div>

        <div className="flex justify-end pt-2">
          <SaveSettingsButton />
        </div>
      </form>
    </section>
  );
}
