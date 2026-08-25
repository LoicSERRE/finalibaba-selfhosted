"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { getOrCreateVapidKeys } from "@/lib/services/notifications";

export async function getPushStatus() {
  const [{ publicKey }, settings, subscriptions] = await Promise.all([
    getOrCreateVapidKeys(),
    prisma.userSettings.upsert({
      where: { id: "singleton" },
      create: {},
      update: {},
      select: { webPushEnabled: true },
    }),
    prisma.pushSubscription.findMany({
      orderBy: { createdAt: "asc" },
      select: { id: true, deviceLabel: true, createdAt: true, lastUsedAt: true },
    }),
  ]);
  return { enabled: settings.webPushEnabled, publicKey, subscriptions };
}

// subscriptionJSON is exactly what the browser's PushSubscription.toJSON()
// returns from pushManager.subscribe() - endpoint/keys.p256dh/keys.auth.
// Upsert on endpoint (not create), since re-subscribing the same browser
// (e.g. after clearing site data, or the push service rotating the
// endpoint) should replace the stale row rather than error on the unique
// constraint or accumulate duplicates for what's really the same device.
export async function subscribeToPush(
  subscriptionJSON: { endpoint: string; keys: { p256dh: string; auth: string } },
  deviceLabel: string | null
) {
  await prisma.pushSubscription.upsert({
    where: { endpoint: subscriptionJSON.endpoint },
    create: {
      endpoint: subscriptionJSON.endpoint,
      p256dh: subscriptionJSON.keys.p256dh,
      auth: subscriptionJSON.keys.auth,
      deviceLabel: deviceLabel?.trim() || null,
    },
    update: {
      p256dh: subscriptionJSON.keys.p256dh,
      auth: subscriptionJSON.keys.auth,
    },
  });
  // First subscription on a fresh install re-enables the channel, same
  // "registering re-enables" convention as verifyAppLockRegistration.
  await prisma.userSettings.update({ where: { id: "singleton" }, data: { webPushEnabled: true } });
  revalidatePath("/settings");
}

export async function unsubscribeFromPush(id: string) {
  await prisma.pushSubscription.delete({ where: { id } });
  revalidatePath("/settings");
}

export async function updateWebPushEnabled(enabled: boolean) {
  await prisma.userSettings.update({ where: { id: "singleton" }, data: { webPushEnabled: enabled } });
  revalidatePath("/settings");
}
