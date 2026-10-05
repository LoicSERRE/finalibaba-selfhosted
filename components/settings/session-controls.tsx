"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { LogOut, ShieldCheck } from "lucide-react";
import { revokeOwnSessions } from "@/lib/actions/users";
import { setTwoFactorPolicy } from "@/lib/actions/security";
import { guardAction } from "@/lib/utils/action-state";
import type { ActionResult } from "@/lib/domain/action-result";
import { FormAlert } from "@/components/ui/form-alert";
import { Button } from "@/components/ui/button";
import { SaveSettingsButton } from "@/components/settings/save-settings-button";

/**
 * "Sign out everywhere" and the instance 2FA policy - the reference
 * implementation of how a Settings form reports an outcome. To reproduce it
 * elsewhere:
 *
 * 1. The Server Action returns an ActionResult with its own error keys
 *    (lib/domain/action-result.ts), and keeps throwing only for authorization.
 * 2. The form calls it through guardAction (lib/utils/action-state.ts), so a
 *    thrown error - including one Next redacted into a digest - arrives as
 *    the "unexpected" key instead of crashing the form or showing the digest.
 * 3. useActionState holds the last result; the pending state disables the
 *    submit button (useFormStatus inside SaveSettingsButton does the same) so
 *    the action cannot be fired twice.
 * 4. FormAlert shows it beside the control: every key the action can return
 *    has a translation, and the compiler checks the mapping is complete.
 */

type RevokeResult = Awaited<ReturnType<typeof revokeOwnSessions>>;
type PolicyResult = Awaited<ReturnType<typeof setTwoFactorPolicy>>;

const guardedRevoke = guardAction(revokeOwnSessions);
const guardedPolicy = guardAction(setTwoFactorPolicy);

type ErrorKey<R> = R extends ActionResult<unknown, infer E> ? E | "unexpected" : never;

export function SessionControls({
  isAdmin,
  requireTwoFactor,
}: Readonly<{ isAdmin: boolean; requireTwoFactor: boolean }>) {
  const t = useTranslations("settings.security");

  const [revoke, revokeAction, revoking] = useActionState<RevokeResult | null>(() => guardedRevoke(), null);
  const [policy, policyAction] = useActionState<PolicyResult | null, FormData>(
    (_previous, formData) => guardedPolicy(formData),
    null
  );

  const revokeErrors: Record<ErrorKey<RevokeResult>, string> = {
    auth_disabled: t("errors.authDisabled"),
    revoke_failed: t("errors.revokeFailed"),
    unexpected: t("errors.unexpected"),
  };
  const policyErrors: Record<ErrorKey<PolicyResult>, string> = {
    save_failed: t("errors.policySaveFailed"),
    unexpected: t("errors.unexpected"),
  };

  return (
    <>
      {/* Ending every session, including this browser's. Deliberately
          including it: "log out everywhere" that quietly spares the device
          you typed it on is the version people misread, and signing back in
          costs one password entry. On success this browser is signed out too,
          so the page is replaced before a success message could matter. */}
      <form action={revokeAction} className="space-y-3">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="max-w-md">
            <p className="text-sm font-medium text-[var(--foreground)]">{t("revokeTitle")}</p>
            <p className="text-xs text-[var(--muted)] mt-0.5">{t("revokeHint")}</p>
          </div>
          <Button type="submit" variant="destructive" disabled={revoking}>
            <LogOut size={14} aria-hidden="true" />
            {t("revokeAction")}
          </Button>
        </div>
        <FormAlert tone="error">{revoke && !revoke.ok ? revokeErrors[revoke.error] : null}</FormAlert>
      </form>

      {isAdmin && (
        <form action={policyAction} className="border-t border-[var(--border)] pt-5 space-y-3">
          {/* The hint is a DESCRIPTION, not part of the name: named by the
              label, described by the hint, which is what these two attributes
              are for. */}
          <div className="flex items-start gap-3">
            <input
              id="requireTwoFactor"
              type="checkbox"
              name="requireTwoFactor"
              defaultChecked={requireTwoFactor}
              aria-describedby="requireTwoFactorHint"
              className="mt-0.5 accent-[var(--accent)]"
            />
            <div>
              <label
                htmlFor="requireTwoFactor"
                className="flex items-center gap-2 text-sm font-medium text-[var(--foreground)] cursor-pointer"
              >
                <ShieldCheck size={14} aria-hidden="true" />
                {t("requireTotpTitle")}
              </label>
              <span id="requireTwoFactorHint" className="block text-xs text-[var(--muted)] mt-0.5">
                {t("requireTotpHint")}
              </span>
            </div>
          </div>
          <div className="flex justify-end">
            <SaveSettingsButton />
          </div>
          <FormAlert tone={policy?.ok ? "success" : "error"}>
            {policy && (policy.ok
              ? t(policy.data.required ? "policySavedRequired" : "policySavedOptional")
              : policyErrors[policy.error])}
          </FormAlert>
        </form>
      )}
    </>
  );
}
