"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { parseCents } from "@/lib/utils/format";

// No getAlertSettings() here - lib/actions/user-settings.ts's
// getUserSettings() already fetches the same singleton row with every
// field, alert-related or not, so the Settings page reuses that instead of
// a second near-identical upsert-fetch.

// Split in two (channels vs triggers) so the Settings UI can present "how
// you're notified" and "what triggers a notification" as separate cards
// with their own Save button, instead of one long mixed form - see
// CLAUDE.md's "Alerts & webhooks" for the UX rationale.

export async function updateAlertChannels(formData: FormData) {
  const str = (name: string) => ((formData.get(name) as string) || "").trim() || null;

  const ntfyTopicUrl = str("ntfyTopicUrl");
  const ntfyAuthToken = str("ntfyAuthToken");
  const alertEmailTo = str("alertEmailTo");
  const smtpHost = str("smtpHost");
  const smtpPortRaw = str("smtpPort");
  const smtpPort = smtpPortRaw ? Number.parseInt(smtpPortRaw, 10) : null;
  const smtpUser = str("smtpUser");
  const smtpFrom = str("smtpFrom");
  // Independent per-channel on/off, layered on top of "is it configured"
  // above - standard checkbox semantics (present in FormData when checked,
  // absent when not), same pattern as loanAlertsEnabled/
  // syncFailureAlertsEnabled in updateAlertTriggers below.
  const ntfyEnabled = formData.get("ntfyEnabled") === "on";
  const emailAlertsEnabled = formData.get("emailAlertsEnabled") === "on";

  // Blank means "leave unchanged", not "clear it" - unlike every other
  // field here, this one is never pre-filled with the real stored value in
  // the form (a plaintext password shouldn't round-trip back into the
  // browser on every page load), so a blank submit almost always means "I
  // didn't touch this field", not "remove my password".
  const smtpPasswordInput = (formData.get("smtpPassword") as string) || "";

  const data = { ntfyTopicUrl, ntfyAuthToken, ntfyEnabled, alertEmailTo, smtpHost, smtpPort, smtpUser, smtpFrom, emailAlertsEnabled };

  await prisma.userSettings.upsert({
    where: { id: "singleton" },
    create: { ...data, smtpPassword: smtpPasswordInput || null },
    update: smtpPasswordInput ? { ...data, smtpPassword: smtpPasswordInput } : data,
  });

  revalidatePath("/settings");
}

export async function updateAlertTriggers(formData: FormData) {
  const netWorthAlertThresholdRaw = ((formData.get("netWorthAlertThreshold") as string) || "").trim();
  const netWorthAlertThresholdCents = netWorthAlertThresholdRaw ? parseCents(netWorthAlertThresholdRaw) : null;
  // Standard HTML checkbox semantics - a checked box is present in FormData
  // (value "on" unless it has its own name/value pair), an unchecked one is
  // simply absent. Net worth's off-switch is its blank threshold above;
  // these two triggers don't have an equivalent "empty means off" field, so
  // they need an explicit boolean.
  const loanAlertsEnabled = formData.get("loanAlertsEnabled") === "on";
  const syncFailureAlertsEnabled = formData.get("syncFailureAlertsEnabled") === "on";
  const sectorDataAlertsEnabled = formData.get("sectorDataAlertsEnabled") === "on";

  const current = await prisma.userSettings.findUnique({
    where: { id: "singleton" },
    select: { netWorthAlertThresholdCents: true },
  });
  // Changing the threshold invalidates the old crossing baseline - without
  // this, moving it from 100k to 200k while already at 150k would read as
  // "still below the new threshold, no change" instead of correctly
  // starting fresh (see evaluateNetWorthAlert's wasAbove=null case).
  const thresholdChanged = current?.netWorthAlertThresholdCents !== netWorthAlertThresholdCents;

  const data = {
    netWorthAlertThresholdCents,
    loanAlertsEnabled,
    syncFailureAlertsEnabled,
    sectorDataAlertsEnabled,
    ...(thresholdChanged ? { netWorthAlertLastAbove: null } : {}),
  };

  await prisma.userSettings.upsert({
    where: { id: "singleton" },
    create: data,
    update: data,
  });

  revalidatePath("/settings");
}
