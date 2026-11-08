"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { Server } from "lucide-react";
import { setInstanceMail } from "@/lib/actions/alerts";
import { guardAction } from "@/lib/utils/action-state";
import type { ActionResult } from "@/lib/domain/action-result";
import type { InstanceMailForm } from "@/lib/services/instance-mail";
import { FormAlert } from "@/components/ui/form-alert";
import { Button } from "@/components/ui/button";
import { SaveSettingsButton } from "@/components/settings/save-settings-button";

type SaveResult = Awaited<ReturnType<typeof setInstanceMail>>;
type ErrorKey<R> = R extends ActionResult<unknown, infer E> ? E | "unexpected" : never;

const guardedSave = guardAction(setInstanceMail);

const inputClass =
  "w-full bg-[var(--surface-elevated)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/30";

/**
 * The instance's mail server, admin only. Every user may then pick it for
 * their alert email without seeing it (alert-channels-section.tsx).
 *
 * "This project's mail service" fills in the optional `mail` Compose service:
 * its Docker service name is its hostname on the internal network, and port
 * 25 rather than 587 because docker-mailserver's SMTP_ONLY mode has no SASL -
 * it relays for the Docker network instead, so no user or password.
 */
export function InstanceMailSection({ mail }: Readonly<{ mail: InstanceMailForm }>) {
  const t = useTranslations("settings.instanceMail");
  const tc = useTranslations("settings.alertChannels");
  const [host, setHost] = useState(mail.host ?? "");
  const [port, setPort] = useState(mail.port?.toString() ?? "");
  const [result, saveAction] = useActionState<SaveResult | null, FormData>((_previous, formData) => guardedSave(formData), null);

  const errors: Record<ErrorKey<SaveResult>, string> = {
    save_failed: t("errors.saveFailed"),
    unexpected: t("errors.unexpected"),
  };

  function fillProjectService() {
    setHost("mail");
    setPort("25");
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-[var(--foreground)]">{t("title")}</h2>
        <p className="text-xs text-[var(--muted)] mt-0.5">{t("subtitle")}</p>
      </div>
      <form action={saveAction} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <p className="text-xs text-[var(--muted)] max-w-md">{t("projectServiceHint")}</p>
          <Button type="button" variant="outline" size="sm" onClick={fillProjectService}>
            <Server size={14} aria-hidden="true" />
            {t("useProjectService")}
          </Button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label htmlFor="instanceSmtpHost" className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
              {tc("smtpHost")}
            </label>
            <input
              id="instanceSmtpHost"
              name="smtpHost"
              type="text"
              autoComplete="off"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="mail"
              className={inputClass}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="instanceSmtpPort" className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
              {tc("smtpPort")}
            </label>
            <input
              id="instanceSmtpPort"
              name="smtpPort"
              type="number"
              inputMode="numeric"
              autoComplete="off"
              min="1"
              max="65535"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              placeholder="25"
              className={`${inputClass} tabular-nums`}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="instanceSmtpUser" className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
              {tc("smtpUser")}
            </label>
            <input
              id="instanceSmtpUser"
              name="smtpUser"
              type="text"
              autoComplete="off"
              defaultValue={mail.user ?? ""}
              className={inputClass}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="instanceSmtpPassword" className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
              {tc("smtpPassword")}
            </label>
            <input
              id="instanceSmtpPassword"
              name="smtpPassword"
              type="password"
              autoComplete="new-password"
              placeholder={mail.hasPassword ? "••••••••" : tc("smtpPasswordPlaceholder")}
              className={inputClass}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="instanceSmtpFrom" className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
            {tc("smtpFrom")}
          </label>
          <input
            id="instanceSmtpFrom"
            name="smtpFrom"
            type="email"
            autoComplete="off"
            defaultValue={mail.from ?? ""}
            placeholder="finalibaba@example.com"
            className={inputClass}
          />
        </div>
        <p className="text-xs text-[var(--muted)]">{t("removeHint")}</p>

        <div className="flex justify-end pt-2">
          <SaveSettingsButton />
        </div>
        <FormAlert tone={result?.ok ? "success" : "error"}>
          {result && (result.ok ? t(result.data.configured ? "saved" : "removed") : errors[result.error])}
        </FormAlert>
      </form>
    </section>
  );
}
