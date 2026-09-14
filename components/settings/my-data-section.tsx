import { Download, ShieldCheck } from "lucide-react";
import { getTranslations } from "next-intl/server";

/**
 * "Export my data", for every user rather than only the admin.
 *
 * A plain server component with a link: the download is a GET, so it needs no
 * client state, no action and no JavaScript. `download` is deliberately absent
 * - the route sets Content-Disposition itself, and letting the server name the
 * file keeps the timestamp honest even if the tab has been open for hours.
 *
 * Sits above the admin-only backup section so the first thing anybody sees in
 * this part of Settings is the one that concerns them. Before this the whole
 * area was hidden for a member, so an invited user had no way to get their own
 * record out at all - reported as exactly that.
 */
export async function MyDataSection() {
  const t = await getTranslations("settings.myData");

  return (
    <section className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 space-y-4">
      <div className="space-y-1">
        <h2 className="text-base font-medium text-[var(--foreground)]">{t("title")}</h2>
        <p className="text-sm text-[var(--muted)]">{t("description")}</p>
      </div>

      <p className="text-xs text-[var(--muted)] flex items-start gap-2">
        <ShieldCheck size={14} className="mt-0.5 shrink-0 text-[var(--positive)]" aria-hidden="true" />
        {t("noCredentials")}
      </p>

      <a
        href="/api/my-data"
        className="inline-flex items-center gap-2 text-sm px-3 py-2 rounded-lg bg-[var(--accent)] text-white font-medium hover:bg-[var(--accent-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]"
      >
        <Download size={14} aria-hidden="true" />
        {t("action")}
      </a>
    </section>
  );
}
