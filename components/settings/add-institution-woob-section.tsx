"use client";

import { AlertTriangle } from "lucide-react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { WoobExtraFields } from "@/components/settings/woob-module-fields";
import { declaresWoobCredential, extraWoobFields, type WoobField } from "@/lib/domain/woob-fields";

/**
 * The Woob half of "Ajouter une institution": the module, its login and
 * password when it declares them, and whatever else it asks for (issue #135 -
 * the Crédit Agricole region, a date of birth).
 *
 * Its own file rather than a second function in add-institution-dialog.tsx:
 * lizard stops reporting a function that dialog follows in the same file, and
 * the complexity ratchet would count it as unmeasured.
 */
interface AddInstitutionWoobSectionProps {
  module: string;
  hasDedicatedEnvSync: boolean;
  /** Null while loading, or when the sync service cannot say. */
  fields: WoobField[] | null;
  fieldsLoading: boolean;
}

export function AddInstitutionWoobSection({
  module,
  hasDedicatedEnvSync,
  fields,
  fieldsLoading,
}: Readonly<AddInstitutionWoobSectionProps>) {
  const t = useTranslations("addInstitution");
  const tf = useTranslations("woobFields");
  return (
    <>
      <input type="hidden" name="woobModule" value={module} />
      <div className="space-y-3 pt-1 border-t border-[var(--border)]">
        {hasDedicatedEnvSync && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-[var(--warning)]/10 border border-[var(--warning)]/40">
            <AlertTriangle size={14} className="text-[var(--warning)] shrink-0 mt-0.5" aria-hidden="true" />
            <p className="text-xs text-[var(--warning)]">{t("dedicatedEnvWarning")}</p>
          </div>
        )}
        <p className="text-xs text-[var(--muted)] pt-1">{t("woobHint")}</p>
        {declaresWoobCredential(fields, "login") && (
          <Input id="inst-woob-login" label={t("login")} type="text" name="woobLogin" autoComplete="username" required />
        )}
        {declaresWoobCredential(fields, "password") && (
          <Input id="inst-woob-password" label={t("password")} type="password" name="woobPassword" autoComplete="current-password" required />
        )}
        {fieldsLoading && <p className="text-xs text-[var(--muted)]">{tf("loading")}</p>}
        {fields && <WoobExtraFields key={module} fields={extraWoobFields(fields)} idPrefix="inst-woob" />}
      </div>
    </>
  );
}
