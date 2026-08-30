"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Smartphone, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { setTradeRepublicConfig, clearTradeRepublicConfig } from "@/lib/actions/institutions";

/**
 * Connect a Trade Republic account to one institution, so each user can sync
 * their own (v2.1). The counterpart to ConfigureWoobDialog, deliberately kept
 * as its own component rather than a mode of that one: the two share only the
 * shape of a credentials form, and every field, warning and follow-up step
 * differs.
 *
 * Credentials are saved first and the login happens afterwards, from
 * TradeRepublicSetupPrompt: Trade Republic pushes a code to the phone and
 * waits for it, so the second factor cannot be part of a single submit.
 *
 * This never touches the TR_PHONE/TR_PIN environment variables. Those stay the
 * instance owner's and keep syncing independently, the same way configuring
 * Woob never disabled the env-driven LCL path.
 */
export function ConfigureTradeRepublicDialog({
  institutionId,
  institutionName,
  isConfigured,
  hasDedicatedEnvSync,
}: Readonly<{
  institutionId: string;
  institutionName: string;
  isConfigured: boolean;
  /** True when TR_PHONE is set AND this institution is the one that env sync
   *  writes to - configuring both against the same institution is legitimate
   *  but needs saying out loud, same as the Woob dialog's own warning. */
  hasDedicatedEnvSync: boolean;
}>) {
  const t = useTranslations("configureTradeRepublic");
  const tc = useTranslations("common");
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function reset() {
    setPhone("");
    setPin("");
    setError(null);
  }

  function handleSave() {
    setError(null);
    startTransition(async () => {
      try {
        await setTradeRepublicConfig(institutionId, phone, pin);
        setOpen(false);
        reset();
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  function handleClear() {
    setError(null);
    startTransition(async () => {
      try {
        await clearTradeRepublicConfig(institutionId);
        setOpen(false);
        reset();
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
      title={t("title", { name: institutionName })}
      trigger={
        <Button variant="outline" size="sm">
          <Smartphone size={14} aria-hidden="true" />
          {isConfigured ? t("configured") : t("configure")}
        </Button>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-[var(--muted)]">{t("intro")}</p>

        {hasDedicatedEnvSync && (
          <div className="rounded-xl border border-[var(--warning)]/40 bg-[var(--warning)]/10 px-4 py-3 text-sm text-[var(--warning)]">
            {t("dedicatedEnvWarning")}
          </div>
        )}

        <Input
          label={t("phone")}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+33612345678"
          autoComplete="off"
          hint={t("phoneHint")}
        />
        <Input
          label={t("pin")}
          type="password"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          placeholder="••••"
          autoComplete="off"
          hint={t("pinHint")}
        />

        {isConfigured && <p className="text-xs text-[var(--muted)]">{t("reconfigureHint")}</p>}

        {error && <p className="text-sm text-[var(--negative)]">{error}</p>}

        <div className="flex items-center justify-between gap-2 flex-wrap">
          {isConfigured ? (
            <Button variant="ghost" size="sm" onClick={handleClear} disabled={pending}>
              <Trash2 size={14} aria-hidden="true" />
              {t("deleteConfig")}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              {tc("cancel")}
            </Button>
            <Button onClick={handleSave} disabled={pending || !phone.trim() || !pin.trim()}>
              {pending ? tc("saving") : isConfigured ? t("update") : t("submit")}
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
