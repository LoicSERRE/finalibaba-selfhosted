import nodemailer from "nodemailer";
import * as webPush from "web-push";
import { renderAlertEmailHtml } from "@/lib/services/email-template";
import { prisma } from "@/lib/db/prisma";

type AlertChannelSettings = {
  ntfyTopicUrl: string | null;
  ntfyAuthToken: string | null;
  ntfyEnabled: boolean;
  alertEmailTo: string | null;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpUser: string | null;
  smtpPassword: string | null;
  smtpFrom: string | null;
  emailAlertsEnabled: boolean;
  webPushEnabled: boolean;
  // Whose devices to push to - VAPID keys themselves are instance-level as
  // of v2.0 and resolved inside sendWebPush.
  userId: string;
};

/**
 * Uses ntfy's JSON publish API (POST to the server root with `topic` as a
 * body field) instead of the simple API (POST straight to the topic URL,
 * message as a raw body, title as a `Title` header). The simple API's
 * `Title` header doesn't work here - HTTP header values must be Latin-1
 * (fetch/undici throws a ByteString conversion error otherwise), and alert
 * titles are French/user-entered, so they routinely contain accents.
 * Confirmed the hard way while first building this - titles used to get
 * folded into the body instead, with ntfy showing its own generic fallback
 * title. The JSON API's `title`/`message` are plain JSON string values, not
 * header values, so they're UTF-8-safe with no encoding workaround needed -
 * this is the actual fix, not a smarter Latin-1 workaround. Authorization
 * stays a header (a bearer token is always ASCII, no Latin-1 issue there) -
 * only relevant for a self-hosted ntfy server with auth-default-access=
 * deny-all (README's "Self-hosted alerts" section), the public ntfy.sh has
 * no auth to send.
 *
 * `icon`/`click` (a notification icon and a tap-to-open URL) only get set
 * when APP_URL is configured - both need a URL ntfy's own servers/client can
 * fetch, which only holds when the instance is confirmed publicly reachable
 * (same "leave blank for localhost use" convention APP_URL already has for
 * GoCardless's OAuth callback). `/icon` is Next's own file-route
 * (app/icon.tsx, a generated 32x32 PNG) - ntfy only accepts JPEG/PNG icons,
 * not SVG, which is why this doesn't point at public/icon.svg instead.
 *
 * `tags: ["bar_chart"]` renders as 📊 in the ntfy app/web client (ntfy maps
 * GitHub-style emoji shortcodes) - a user found every alert visually
 * indistinguishable from any other app's notifications in their phone's
 * notification list. Deliberately one fixed tag for every alert rather than
 * a different emoji per alert kind (⚠️ for a sync failure vs 🎉 for a loan
 * paid off, etc.) - dispatchAlert below only ever receives a plain
 * title/body pair from all ~8 call sites across this route, so a
 * per-kind tag would mean threading a new parameter through every one of
 * them for a cosmetic nice-to-have; one consistent, on-brand tag (matches
 * the app's own bar-chart logo motif) already solves "make it recognizable
 * at a glance" without that.
 */
export async function sendNtfyMessage(topicUrl: string, title: string, body: string, authToken: string | null = null): Promise<boolean> {
  try {
    const parsed = new URL(topicUrl);
    const topic = parsed.pathname.replace(/^\//, "");
    const appUrl = process.env.APP_URL?.replace(/\/$/, "");
    const payload: Record<string, unknown> = { topic, title, message: body, tags: ["bar_chart"] };
    if (appUrl) {
      payload.icon = `${appUrl}/icon`;
      payload.click = appUrl;
    }
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (authToken) headers.Authorization = `Bearer ${authToken}`;
    const res = await fetch(parsed.origin, { method: "POST", body: JSON.stringify(payload), headers });
    return res.ok;
  } catch (e) {
    console.error("Failed to send ntfy alert", e);
    return false;
  }
}

export async function sendEmail(
  config: { host: string; port: number; user: string | null; password: string | null; from: string; to: string },
  subject: string,
  text: string,
  html?: string
): Promise<boolean> {
  try {
    const transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      // 465 is the conventional implicit-TLS port; every other port (587,
      // 25, custom relays) uses STARTTLS instead - nodemailer's own
      // `secure` flag only controls the former.
      secure: config.port === 465,
      auth: config.user ? { user: config.user, pass: config.password ?? "" } : undefined,
    });
    // html is optional so existing/direct callers keep sending plain text
    // unchanged - only dispatchAlert below opts into the styled version.
    await transporter.sendMail({ from: config.from, to: config.to, subject, text, ...(html ? { html } : {}) });
    return true;
  } catch (e) {
    console.error("Failed to send alert email", e);
    return false;
  }
}

// Same "app generates it, not the user" precedent as totpSecret (lib/auth.ts)
// - a self-hoster never sees or configures these, they're purely internal
// to identifying this app instance to push services. Generated once, on
// first use (the Settings page's first "activer" click - see
// lib/actions/push.ts), then reused for every subscription and every send
// forever after; VAPID keys must stay stable, regenerating them would
// silently invalidate every already-registered browser subscription.
// Instance-level as of v2.0 (they moved off UserSettings): a VAPID keypair
// identifies this SERVER to push services, not a person, so every user's
// subscriptions share one pair.
export async function getOrCreateVapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  const settings = await prisma.instanceSettings.upsert({
    where: { id: "singleton" },
    create: {},
    update: {},
    select: { vapidPublicKey: true, vapidPrivateKey: true },
  });
  if (settings.vapidPublicKey && settings.vapidPrivateKey) {
    return { publicKey: settings.vapidPublicKey, privateKey: settings.vapidPrivateKey };
  }
  const keys = webPush.generateVAPIDKeys();
  await prisma.instanceSettings.update({
    where: { id: "singleton" },
    data: { vapidPublicKey: keys.publicKey, vapidPrivateKey: keys.privateKey },
  });
  return keys;
}

// A 'https:' URL or 'mailto:' address identifying this app instance to push
// services, required by the VAPID spec - reuses APP_URL (same "leave blank
// for localhost use" convention already documented for GoCardless/ntfy
// above) when set, since it's already a real reachable URL for any instance
// that has one configured. Falls back to a fixed placeholder mailto -
// spec-required but not actually contacted by any push service in
// practice, so a generic value is fine for the common (no APP_URL) case.
const VAPID_SUBJECT = process.env.APP_URL?.replace(/\/$/, "") || "mailto:push@finalibaba.local";

// Fetches its own subscriber list rather than taking one as a parameter -
// same "a service reads what it needs from the DB directly" precedent as
// lib/services/api-auth.ts's authenticateApiKey(), which keeps this
// function's signature (and dispatchAlert's, and every one of the ~10
// alert-check functions in app/api/alerts/check/route.ts that call it)
// unchanged from before Web Push existed - UserSettings just grew 3 real
// columns that flow through automatically.
//
// Also prunes subscriptions the push service reports as gone (HTTP 404/410
// - the browser unsubscribed or the OS cleared it) - safe to do inline
// here since this function already has DB access for the read above, and
// a dead subscription would otherwise fail silently forever with no way
// for the user to notice short of it just never working.
export async function sendWebPush(userId: string, title: string, body: string): Promise<boolean> {
  // Scoped to this user's own devices (v2.0) - previously every subscription
  // in the instance, which with several users would push one person's
  // financial alerts to everyone else's phone.
  const subscriptions = await prisma.pushSubscription.findMany({ where: { userId } });
  if (subscriptions.length === 0) return false;

  // Instance-level keypair (moved off UserSettings in v2.0), read here rather
  // than passed in so callers don't have to know where it lives.
  const settings = await prisma.instanceSettings.findUnique({
    where: { id: "singleton" },
    select: { vapidPublicKey: true, vapidPrivateKey: true },
  });
  if (!settings?.vapidPublicKey || !settings.vapidPrivateKey) return false;

  webPush.setVapidDetails(VAPID_SUBJECT, settings.vapidPublicKey, settings.vapidPrivateKey);
  const payload = JSON.stringify({ title, body });

  const staleIds: string[] = [];
  let successCount = 0;
  await Promise.allSettled(
    subscriptions.map(async (sub) => {
      try {
        await webPush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload);
        successCount++;
      } catch (e) {
        const statusCode = e instanceof webPush.WebPushError ? e.statusCode : null;
        if (statusCode === 404 || statusCode === 410) {
          staleIds.push(sub.id);
        } else {
          console.error("Failed to send web push", e);
        }
      }
    })
  );

  if (staleIds.length > 0) {
    await prisma.pushSubscription.deleteMany({ where: { id: { in: staleIds } } });
  }
  return successCount > 0;
}

/**
 * Fans out to every channel that's both configured (non-blank config -
 * "leave blank to disable", same convention as every other optional
 * integration in this app - Web Push's own "configured" is "at least one
 * PushSubscription row exists", checked inside sendWebPush itself since
 * this function has no subscriber count to gate on) and enabled
 * (ntfyEnabled/emailAlertsEnabled/webPushEnabled, each defaulting to true
 * so an already-configured channel keeps firing for existing installs) - a
 * user with multiple channels configured can still choose to receive
 * through only some of them. Each channel already catches its own errors
 * (see above), so one failing never blocks the others; Promise.allSettled
 * is extra insurance against an unexpected throw slipping through.
 */
export async function dispatchAlert(settings: AlertChannelSettings, title: string, body: string): Promise<void> {
  const jobs: Promise<boolean>[] = [];

  if (settings.ntfyTopicUrl && settings.ntfyEnabled) {
    jobs.push(sendNtfyMessage(settings.ntfyTopicUrl, title, body, settings.ntfyAuthToken));
  }

  if (settings.alertEmailTo && settings.smtpHost && settings.smtpPort && settings.smtpFrom && settings.emailAlertsEnabled) {
    jobs.push(
      sendEmail(
        {
          host: settings.smtpHost,
          port: settings.smtpPort,
          user: settings.smtpUser,
          password: settings.smtpPassword,
          from: settings.smtpFrom,
          to: settings.alertEmailTo,
        },
        title,
        body,
        renderAlertEmailHtml(title, body)
      )
    );
  }

  // sendWebPush resolves the instance VAPID keypair and this user's own
  // subscriptions itself, so there's nothing left to gate on here beyond the
  // per-user toggle.
  if (settings.webPushEnabled) {
    jobs.push(sendWebPush(settings.userId, title, body));
  }

  await Promise.allSettled(jobs);
}
