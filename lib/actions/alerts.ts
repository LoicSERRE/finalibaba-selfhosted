"use server";

import { revalidatePath } from "next/cache";
import { encryptSecret, isEncrypted } from "@/lib/domain/crypto-at-rest";
import { prisma } from "@/lib/db/prisma";
import { getViewer } from "@/lib/auth-context";
import { parseCents } from "@/lib/utils/format";

/**
 * A secret typed into a form, or null for "leave unchanged".
 *
 * Blank is "unchanged" (the field never round-trips the stored value). A value
 * that already looks like our `enc:v1:` ciphertext is refused outright: a real
 * person never types one, and accepting it was the middle link of the audited
 * exfiltration chain - a ciphertext leaked from one field/user could be stored
 * as the attacker's own channel secret and then decrypted and sent out. encrypt
 * only ever runs on genuine plaintext now.
 */
function secretFormInput(raw: FormDataEntryValue | null): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed === "" || isEncrypted(trimmed)) return null;
  return trimmed;
}

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

  // Both secrets: blank means "leave unchanged" (the field never pre-fills the
  // stored value), and only a genuine new plaintext is encrypted and written.
  const ntfyAuthToken = encryptSecret(secretFormInput(formData.get("ntfyAuthToken")));
  const smtpPassword = encryptSecret(secretFormInput(formData.get("smtpPassword")));

  const data = {
    ntfyTopicUrl,
    ntfyEnabled,
    alertEmailTo,
    smtpHost,
    smtpPort,
    smtpUser,
    smtpFrom,
    emailAlertsEnabled,
  };

  const viewer = await getViewer();
  await prisma.userSettings.upsert({
    where: { userId: viewer.id },
    create: { userId: viewer.id, ...data, ntfyAuthToken, smtpPassword },
    update: {
      ...data,
      ...(ntfyAuthToken ? { ntfyAuthToken } : {}),
      ...(smtpPassword ? { smtpPassword } : {}),
    },
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
  const priceIncreaseAlertsEnabled = formData.get("priceIncreaseAlertsEnabled") === "on";

  const viewer = await getViewer();
  const current = await prisma.userSettings.findUnique({
    where: { userId: viewer.id },
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
    priceIncreaseAlertsEnabled,
    ...(thresholdChanged ? { netWorthAlertLastAbove: null } : {}),
  };

  await prisma.userSettings.upsert({
    where: { userId: viewer.id },
    create: { userId: viewer.id, ...data },
    update: data,
  });

  revalidatePath("/settings");
}
