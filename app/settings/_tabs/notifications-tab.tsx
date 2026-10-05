import { prisma } from "@/lib/db/prisma";
import { baseAccountIds } from "@/lib/auth-context";
import { AlertChannelsSection } from "@/components/settings/alert-channels-section";
import { WebPushSection } from "@/components/settings/web-push-section";
import { AlertTriggersSection } from "@/components/settings/alert-triggers-section";
import { AlertRulesSection } from "@/components/settings/alert-rules-section";
import { getUserSettings } from "@/lib/actions/user-settings";
import { getPushStatus } from "@/lib/actions/push";
import { getAlertRules } from "@/lib/actions/alert-rules";
import type { SettingsTabProps } from "./context";

/**
 * How you are told (channels, Web Push) and what about (triggers, custom
 * rules). Every section here is hidden in demo mode: a demo instance must
 * not send real notifications.
 */
export async function NotificationsTab({ viewer }: SettingsTabProps) {
  // The rule pickers feed per-user alert rules, so the viewer's OWN accounts.
  const accountIds = await baseAccountIds(viewer.id);
  const [userSettings, pushStatus, alertRules, fiatAccounts, investmentAccounts, budgetCategories] = await Promise.all([
    getUserSettings(),
    getPushStatus(),
    getAlertRules(),
    prisma.account.findMany({
      where: { id: { in: accountIds }, type: { in: ["CHECKING", "SAVINGS", "MEAL_VOUCHER"] } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    // INVESTMENT_VALUE + UNREALIZED_GAIN's account picker, and
    // HOLDING_PRICE/REBALANCING_DRIFT's holding picker (flattened from these
    // accounts' holdings in the component). targetPct is fetched so the
    // component can offer REBALANCING_DRIFT only the holdings it can evaluate.
    prisma.account.findMany({
      where: { id: { in: accountIds }, type: { in: ["INVESTMENT", "CRYPTO"] } },
      select: {
        id: true,
        name: true,
        holdings: { select: { id: true, ticker: true, name: true, targetPct: true }, orderBy: { ticker: "asc" } },
      },
      orderBy: { name: "asc" },
    }),
    prisma.category.findMany({
      where: { userId: viewer.id, budgetCents: { not: null } },
      select: { id: true, name: true, budgetCents: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <>
      {/* Keyed on the exact fields this section seeds into useState, so a save
          elsewhere - which revalidates the whole page - only remounts this form
          when one of THESE values genuinely changed underneath it (e.g. from
          another device). Unkeyed, it would keep its first-mount values and a
          save from here could overwrite a newer value with a stale one. */}
      <AlertChannelsSection
        key={`${userSettings.ntfyTopicUrl}-${userSettings.ntfyEnabled}-${userSettings.emailAlertsEnabled}-${userSettings.smtpHost}-${userSettings.smtpPort}`}
        settings={userSettings}
      />
      {/* A third channel, but its own section: "configuring" it is a subscribe
          action on this browser, not a text field to type into and save. */}
      <WebPushSection enabled={pushStatus.enabled} publicKey={pushStatus.publicKey} subscriptions={pushStatus.subscriptions} />
      <AlertTriggersSection settings={userSettings} />
      <AlertRulesSection
        rules={alertRules}
        fiatAccounts={fiatAccounts}
        investmentAccounts={investmentAccounts}
        categories={budgetCategories}
      />
    </>
  );
}
