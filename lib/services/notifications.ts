import nodemailer from "nodemailer";
import { renderAlertEmailHtml } from "@/lib/services/email-template";

type AlertChannelSettings = {
  ntfyTopicUrl: string | null;
  ntfyAuthToken: string | null;
  alertEmailTo: string | null;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpUser: string | null;
  smtpPassword: string | null;
  smtpFrom: string | null;
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

/**
 * Fans out to every channel with non-blank config - "leave blank to
 * disable", same convention as every other optional integration in this
 * app. Each channel already catches its own errors (see above), so one
 * failing never blocks the other; Promise.allSettled is extra insurance
 * against an unexpected throw slipping through.
 */
export async function dispatchAlert(settings: AlertChannelSettings, title: string, body: string): Promise<void> {
  const jobs: Promise<boolean>[] = [];

  if (settings.ntfyTopicUrl) {
    jobs.push(sendNtfyMessage(settings.ntfyTopicUrl, title, body, settings.ntfyAuthToken));
  }

  if (settings.alertEmailTo && settings.smtpHost && settings.smtpPort && settings.smtpFrom) {
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

  await Promise.allSettled(jobs);
}
