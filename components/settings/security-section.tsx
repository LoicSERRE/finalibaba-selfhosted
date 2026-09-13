import { getTranslations, getLocale } from "next-intl/server";
import { LogOut, ShieldCheck } from "lucide-react";
import { revokeOwnSessions } from "@/lib/actions/users";
import { setTwoFactorPolicy, type AuditRow } from "@/lib/actions/security";
import { SaveSettingsButton } from "@/components/settings/save-settings-button";
import { formatDateShort, localeToIntl } from "@/lib/utils/format";

/**
 * The two things an instance operator could not do before v2.10.6: end a
 * session, and see what has happened.
 *
 * A server component - every control is a native form posting to a Server
 * Action, and nothing here needs local state.
 */
export async function SecuritySection({
  events,
  isAdmin,
  requireTwoFactor,
}: Readonly<{
  events: AuditRow[];
  isAdmin: boolean;
  requireTwoFactor: boolean;
}>) {
  const t = await getTranslations("settings.security");
  const intlLocale = localeToIntl(await getLocale());

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-[var(--foreground)]">{t("title")}</h2>
        <p className="text-xs text-[var(--muted)] mt-0.5">{t("subtitle")}</p>
      </div>

      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 space-y-5">
        {/* Ending every session, including this browser's. Deliberately
            including it: "log out everywhere" that quietly spares the device
            you typed it on is the version people misread, and signing back in
            costs one password entry. */}
        <form action={revokeOwnSessions} className="flex items-start justify-between gap-4 flex-wrap">
          <div className="max-w-md">
            <p className="text-sm font-medium text-[var(--foreground)]">{t("revokeTitle")}</p>
            <p className="text-xs text-[var(--muted)] mt-0.5">{t("revokeHint")}</p>
          </div>
          <button
            type="submit"
            className="flex items-center gap-2 text-sm px-3 py-2 rounded-lg border border-[var(--border)] text-[var(--negative)] hover:bg-[var(--surface-elevated)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            <LogOut size={14} aria-hidden="true" />
            {t("revokeAction")}
          </button>
        </form>

        {isAdmin && (
          <form action={setTwoFactorPolicy} className="border-t border-[var(--border)] pt-5 space-y-3">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                name="requireTwoFactor"
                defaultChecked={requireTwoFactor}
                className="mt-0.5 accent-[var(--accent)]"
              />
              <span>
                <span className="flex items-center gap-2 text-sm font-medium text-[var(--foreground)]">
                  <ShieldCheck size={14} aria-hidden="true" />
                  {t("requireTotpTitle")}
                </span>
                <span className="block text-xs text-[var(--muted)] mt-0.5">{t("requireTotpHint")}</span>
              </span>
            </label>
            <SaveSettingsButton />
          </form>
        )}
      </div>

      <div>
        <h3 className="text-sm font-medium text-[var(--foreground)]">{t("auditTitle")}</h3>
        <p className="text-xs text-[var(--muted)] mt-0.5">
          {isAdmin ? t("auditHintAdmin") : t("auditHintMember")}
        </p>
      </div>

      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
        {events.length === 0 ? (
          <p className="px-5 py-4 text-sm text-[var(--muted)]">{t("auditEmpty")}</p>
        ) : (
          // Scrolls inside its own container: a long IP plus a long label is
          // wider than a phone, and the page itself must never scroll
          // sideways.
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-[var(--muted)] border-b border-[var(--border)]">
                  <th className="px-5 py-2 font-medium">{t("colWhen")}</th>
                  <th className="px-5 py-2 font-medium">{t("colWhat")}</th>
                  <th className="px-5 py-2 font-medium">{t("colWho")}</th>
                  <th className="px-5 py-2 font-medium">{t("colWhere")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {events.map((e) => (
                  <tr key={e.id}>
                    <td className="px-5 py-2 whitespace-nowrap text-[var(--muted)] tabular-nums">
                      {formatDateShort(e.createdAt, intlLocale)}
                    </td>
                    {/* The raw dotted key, not a translated sentence: these
                        are compared across versions and searched for, and a
                        localised label would make a log unreadable to anyone
                        helping from outside. */}
                    <td className="px-5 py-2 font-mono text-xs text-[var(--foreground)]">
                      {e.action}
                      {e.detail && <span className="text-[var(--muted)]"> · {e.detail}</span>}
                    </td>
                    <td className="px-5 py-2 text-[var(--muted)]">{e.actorLabel ?? "-"}</td>
                    <td className="px-5 py-2 text-[var(--muted)] font-mono text-xs">{e.ip ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
