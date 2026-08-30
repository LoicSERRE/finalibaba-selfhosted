"use client";

import { useState } from "react";
import { Shuffle, Copy, Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { updateAlertChannels } from "@/lib/actions/alerts";
import { SaveSettingsButton } from "@/components/settings/save-settings-button";
import { Button } from "@/components/ui/button";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { copyToClipboard } from "@/lib/utils/clipboard";

// Client-side only - a pure "fill the field" convenience, not persisted
// until the form's own Save button runs updateAlertChannels. 192 bits from
// the Web Crypto API: same "unguessability from entropy, not from asking a
// human to invent a secret" reasoning as ShareLink's token
// (lib/domain/share-links.ts) - ntfy.sh's free tier has no access control
// of its own, so an easily-guessed topic name is the only thing standing
// between a public server and someone else reading real net worth figures.
function generateNtfyTopic(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `https://ntfy.sh/finalibaba-${hex}`;
}

const EMAIL_PRESETS: Record<string, { host: string; port: string }> = {
  gmail: { host: "smtp.gmail.com", port: "587" },
  outlook: { host: "smtp.office365.com", port: "587" },
  // Points at this project's own optional `mail` service (README's
  // "Self-hosted alerts" section, docker-mailserver behind the `mail`
  // Compose profile) - the Docker service name doubles as its hostname on
  // the internal network, same as `sync:8000` for the sync service
  // (docker-compose.yml's SYNC_SERVICE_URL). Port 25, not 587 - confirmed
  // empirically that docker-mailserver's SMTP_ONLY mode disables SASL/
  // Dovecot entirely, so authenticated submission on 587 doesn't work at
  // all. Port 25 relies on trusted-network relay instead (PERMIT_DOCKER in
  // docker-compose.yml, no smtpUser/smtpPassword needed) - same "same
  // Docker network = trusted, no credentials" model this project already
  // uses for app<->sync.
  selfhosted: { host: "mail", port: "25" },
};

const inputClass =
  "w-full bg-[var(--surface-elevated)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/30";

export function AlertChannelsSection({
  settings,
}: Readonly<{
  settings: {
    ntfyTopicUrl: string | null;
    ntfyAuthToken: string | null;
    ntfyEnabled: boolean;
    alertEmailTo: string | null;
    smtpHost: string | null;
    smtpPort: number | null;
    smtpUser: string | null;
    smtpFrom: string | null;
    emailAlertsEnabled: boolean;
  };
}>) {
  const t = useTranslations("settings.alertChannels");

  const [ntfyTopicUrl, setNtfyTopicUrl] = useState(settings.ntfyTopicUrl ?? "");
  const [copied, setCopied] = useState(false);
  const [ntfyEnabled, setNtfyEnabled] = useState(settings.ntfyEnabled);
  const [emailAlertsEnabled, setEmailAlertsEnabled] = useState(settings.emailAlertsEnabled);

  const [emailPreset, setEmailPreset] = useState("custom");
  const [smtpHost, setSmtpHost] = useState(settings.smtpHost ?? "");
  const [smtpPort, setSmtpPort] = useState(settings.smtpPort?.toString() ?? "");

  function handleGenerateTopic() {
    setNtfyTopicUrl(generateNtfyTopic());
  }

  async function handleCopy() {
    await copyToClipboard(ntfyTopicUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function handlePresetChange(value: string) {
    setEmailPreset(value);
    const preset = EMAIL_PRESETS[value];
    if (preset) {
      setSmtpHost(preset.host);
      setSmtpPort(preset.port);
    }
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-[var(--foreground)]">{t("title")}</h2>
        <p className="text-xs text-[var(--muted)] mt-0.5">{t("subtitle")}</p>
      </div>
      <form action={updateAlertChannels} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 space-y-5">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider flex items-center gap-1">
              {t("ntfySectionTitle")}
              <InfoTooltip>{t("ntfyHint")}</InfoTooltip>
            </p>
            <label className="flex items-center gap-2 cursor-pointer">
              <span className="text-xs text-[var(--foreground)]">{t("channelEnabled")}</span>
              <input
                type="checkbox"
                name="ntfyEnabled"
                checked={ntfyEnabled}
                onChange={(e) => setNtfyEnabled(e.target.checked)}
                className="w-4 h-4 rounded accent-[var(--accent)]"
              />
            </label>
          </div>
          {/* Dimmed (not disabled - config stays freely editable while a
              channel is off, see updateAlertChannels) when the channel's own
              "Actif" checkbox above is unchecked - otherwise a user who
              unchecks it has no visual cue their filled-in URL/token is now
              inert, only the checkbox state itself to notice. */}
          <div className={ntfyEnabled ? undefined : "opacity-50"}>
            <label htmlFor="ntfyTopicUrl" className="sr-only">
              {t("ntfy")}
            </label>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                id="ntfyTopicUrl"
                name="ntfyTopicUrl"
                type="url"
                autoComplete="off"
                value={ntfyTopicUrl}
                onChange={(e) => setNtfyTopicUrl(e.target.value)}
                placeholder="https://ntfy.sh/..."
                className={`${inputClass} flex-1`}
              />
              <div className="flex gap-2 shrink-0">
                <Button type="button" variant="outline" size="sm" onClick={handleGenerateTopic}>
                  <Shuffle size={14} aria-hidden="true" />
                  {t("ntfyGenerate")}
                </Button>
                {ntfyTopicUrl && (
                  <Button type="button" variant="outline" size="sm" onClick={handleCopy}>
                    {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
                    {copied ? t("ntfyCopied") : t("ntfyCopy")}
                  </Button>
                )}
              </div>
            </div>

            <div className="space-y-1.5 pt-1">
              <label htmlFor="ntfyAuthToken" className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider flex items-center gap-1">
                {t("ntfyAuthToken")}
                <InfoTooltip>{t("ntfyAuthTokenHint")}</InfoTooltip>
              </label>
              <input
                id="ntfyAuthToken"
                name="ntfyAuthToken"
                type="text"
                autoComplete="off"
                defaultValue={settings.ntfyAuthToken ?? ""}
                placeholder="tk_..."
                className={inputClass}
              />
            </div>
          </div>
        </div>

        <div className="pt-4 border-t border-[var(--border)] space-y-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">{t("emailSectionTitle")}</p>
            <label className="flex items-center gap-2 cursor-pointer">
              <span className="text-xs text-[var(--foreground)]">{t("channelEnabled")}</span>
              <input
                type="checkbox"
                name="emailAlertsEnabled"
                checked={emailAlertsEnabled}
                onChange={(e) => setEmailAlertsEnabled(e.target.checked)}
                className="w-4 h-4 rounded accent-[var(--accent)]"
              />
            </label>
          </div>

          {/* Same dim-when-off treatment as the ntfy block above. */}
          <div className={`space-y-4 ${emailAlertsEnabled ? "" : "opacity-50"}`}>
          <div className="space-y-1.5">
            <label htmlFor="alertEmailTo" className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
              {t("emailTo")}
            </label>
            <input
              id="alertEmailTo"
              name="alertEmailTo"
              type="email"
              autoComplete="off"
              defaultValue={settings.alertEmailTo ?? ""}
              placeholder="moi@example.com"
              className={inputClass}
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="emailPreset" className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
              {t("emailPreset")}
            </label>
            <select
              id="emailPreset"
              value={emailPreset}
              onChange={(e) => handlePresetChange(e.target.value)}
              className={inputClass}
            >
              <option value="custom">{t("emailPresetCustom")}</option>
              <option value="gmail">Gmail</option>
              <option value="outlook">Outlook / Office 365</option>
              <option value="selfhosted">{t("emailPresetSelfhosted")}</option>
            </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label htmlFor="smtpHost" className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
                {t("smtpHost")}
              </label>
              <input
                id="smtpHost"
                name="smtpHost"
                type="text"
                autoComplete="off"
                value={smtpHost}
                onChange={(e) => setSmtpHost(e.target.value)}
                placeholder="smtp.example.com"
                className={inputClass}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="smtpPort" className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
                {t("smtpPort")}
              </label>
              <input
                id="smtpPort"
                name="smtpPort"
                type="number"
                inputMode="numeric"
                autoComplete="off"
                min="1"
                max="65535"
                value={smtpPort}
                onChange={(e) => setSmtpPort(e.target.value)}
                placeholder="587"
                className={`${inputClass} tabular-nums`}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="smtpUser" className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
                {t("smtpUser")}
              </label>
              <input
                id="smtpUser"
                name="smtpUser"
                type="text"
                autoComplete="off"
                defaultValue={settings.smtpUser ?? ""}
                className={inputClass}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="smtpPassword" className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider flex items-center gap-1">
                {t("smtpPassword")}
                <InfoTooltip>{t("smtpPasswordHint")}</InfoTooltip>
              </label>
              <input
                id="smtpPassword"
                name="smtpPassword"
                type="password"
                autoComplete="new-password"
                placeholder={t("smtpPasswordPlaceholder")}
                className={inputClass}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="smtpFrom" className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider flex items-center gap-1">
              {t("smtpFrom")}
              <InfoTooltip>{t("smtpFromHint")}</InfoTooltip>
            </label>
            <input
              id="smtpFrom"
              name="smtpFrom"
              type="email"
              autoComplete="off"
              defaultValue={settings.smtpFrom ?? ""}
              placeholder="finalibaba@example.com"
              className={inputClass}
            />
          </div>
          <p className="text-xs text-[var(--muted)] opacity-70">{t("emailHint")}</p>
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <SaveSettingsButton />
        </div>
      </form>
    </section>
  );
}
