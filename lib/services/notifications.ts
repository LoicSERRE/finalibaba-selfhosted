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
 * No Title header: HTTP header values must be Latin-1 (fetch/undici throws
 * a ByteString conversion error otherwise), and alert text here is
 * French/user-entered, so it can contain non-Latin-1 characters (accents).
 * ntfy falls back to a generic title when none is set - the body carries
 * the real message either way. Authorization is fine as a header though -
 * a bearer token is always ASCII, only the human-entered alert text has the
 * Latin-1 problem. Only relevant for a self-hosted ntfy server with
 * auth-default-access=deny-all (README's "Self-hosted alerts" section) -
 * the public ntfy.sh has no auth to send, token stays unset there.
 */
export async function sendNtfyMessage(topicUrl: string, body: string, authToken: string | null = null): Promise<boolean> {
  try {
    const headers = authToken ? { Authorization: `Bearer ${authToken}` } : undefined;
    const res = await fetch(topicUrl, { method: "POST", body, headers });
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
    jobs.push(sendNtfyMessage(settings.ntfyTopicUrl, `${title}\n\n${body}`, settings.ntfyAuthToken));
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
