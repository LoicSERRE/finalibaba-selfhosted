"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { getOrCreateVapidKeys } from "@/lib/services/notifications";
import { getViewer } from "@/lib/auth-context";

export async function getPushStatus() {
  const viewer = await getViewer();
  const [{ publicKey }, settings, subscriptions] = await Promise.all([
    getOrCreateVapidKeys(),
    prisma.userSettings.upsert({
      where: { userId: viewer.id },
      create: { userId: viewer.id },
      update: {},
      select: { webPushEnabled: true },
    }),
    prisma.pushSubscription.findMany({
      where: { userId: viewer.id },
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
  const viewer = await getViewer();
  await prisma.pushSubscription.upsert({
    where: { endpoint: subscriptionJSON.endpoint },
    create: {
      endpoint: subscriptionJSON.endpoint,
      p256dh: subscriptionJSON.keys.p256dh,
      auth: subscriptionJSON.keys.auth,
      deviceLabel: deviceLabel?.trim() || null,
      userId: viewer.id,
    },
    // userId is re-pointed too: an endpoint is one physical browser, so if
    // someone else logs into this device and subscribes, the row must follow
    // the person now using it rather than keep pushing to the previous user.
    update: {
      p256dh: subscriptionJSON.keys.p256dh,
      auth: subscriptionJSON.keys.auth,
      userId: viewer.id,
    },
  });
  // First subscription on a fresh install re-enables the channel, same
  // "registering re-enables" convention as verifyAppLockRegistration.
  await prisma.userSettings.upsert({
    where: { userId: viewer.id },
    create: { userId: viewer.id, webPushEnabled: true },
    update: { webPushEnabled: true },
  });
  revalidatePath("/settings");
}

export async function unsubscribeFromPush(id: string) {
  const viewer = await getViewer();
  // deleteMany scoped to the viewer rather than delete-by-id: a Server Action
  // is directly invocable, so an id alone must never remove someone else's
  // device.
  await prisma.pushSubscription.deleteMany({ where: { id, userId: viewer.id } });
  revalidatePath("/settings");
}

export async function updateWebPushEnabled(enabled: boolean) {
  const viewer = await getViewer();
  await prisma.userSettings.upsert({
    where: { userId: viewer.id },
    create: { userId: viewer.id, webPushEnabled: enabled },
    update: { webPushEnabled: enabled },
  });
  revalidatePath("/settings");
}
