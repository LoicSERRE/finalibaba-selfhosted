"use client";

import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { createAccount } from "@/lib/actions/accounts";
import { useTranslations } from "next-intl";

type Institution = { id: string; name: string };

export function AddAccountDialog({
  institutions,
  defaultType,
}: Readonly<{
  institutions: Institution[];
  defaultType?: string;
}>) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState(defaultType ?? "CHECKING");
  const [subtype, setSubtype] = useState("");
  const [taxTreatment, setTaxTreatment] = useState("TAXABLE");
  const [taxRatePct, setTaxRatePct] = useState("31.4");
  const [pending, startTransition] = useTransition();
  const t = useTranslations("addAccount");
  const tc = useTranslations("common");

  const isRealEstate = type === "REAL_ESTATE";
  const isAutomobile = type === "AUTOMOBILE";
  const isManualValue = isRealEstate || isAutomobile;
  const isInvestment = type === "INVESTMENT" || type === "CRYPTO";
  const isPEACTO = type === "INVESTMENT";

  function handleTypeChange(newType: string) {
    setType(newType);
    if (newType === "CRYPTO") setTaxRatePct("31.4");
  }

  function handleSubtypeChange(newSubtype: string) {
    setSubtype(newSubtype);
    setTaxRatePct(newSubtype === "PEA" ? "17.2" : "31.4");
  }

  const ACCOUNT_TYPES = [
    { value: "CHECKING", label: t("typeChecking") },
    { value: "SAVINGS", label: t("typeSavings") },
    { value: "INVESTMENT", label: t("typeInvestment") },
    { value: "CRYPTO", label: t("typeCrypto") },
    { value: "MEAL_VOUCHER", label: t("typeMealVoucher") },
    { value: "REAL_ESTATE", label: t("typeRealEstate") },
    { value: "AUTOMOBILE", label: t("typeAutomobile") },
  ];

  function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      await createAccount(fd);
      setOpen(false);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title={t("title")}
      trigger={
        <Button aria-label={t("trigger")}>
          <Plus size={14} aria-hidden="true" />
          <span className="sr-only sm:not-sr-only" aria-hidden="true">{t("trigger")}</span>
        </Button>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Select
          label={t("type")}
          name="type"
          value={type}
          onChange={(e) => handleTypeChange(e.target.value)}
          options={ACCOUNT_TYPES}
        />
        <Select
          label={t("institution")}
          name="institutionId"
          options={
            institutions.length
              ? institutions.map((i) => ({ value: i.id, label: i.name }))
              : [{ value: "", label: t("noInstitution") }]
          }
          disabled={!institutions.length}
        />
        <Input
          label={t("name")}
          name="name"
          placeholder={isAutomobile ? "Tesla Model 3" : isRealEstate ? "Résidence principale" : "Livret A"}
          required
        />
        {!isInvestment && (
          <Input
            label={isManualValue ? t("estimatedValue") : t("balance")}
            name="initialBalance"
            type="number"
            step="0.01"
            // A fiat balance can legitimately be negative: this app models an
            // overdraft as a first-class state (AlertRule's ACCOUNT_OVERDRAFT
            // kind exists for exactly that), so blocking the entry contradicts
            // a shipped feature. The floor still applies to a manual valuation,
            // where a negative estate/vehicle value is meaningless.
            min={isManualValue ? "0" : undefined}
            placeholder="0.00"
          />
        )}
        {isManualValue && (
          <Input
            label={isAutomobile ? t("autoLiability") : t("mortgage")}
            name="liability"
            type="number"
            step="0.01"
            min="0"
            placeholder="0.00"
          />
        )}
        {isPEACTO && (
          <Select
            label={t("subtype")}
            name="investmentSubtype"
            value={subtype}
            onChange={(e) => handleSubtypeChange(e.target.value)}
            options={[
              { value: "", label: t("noSubtype") },
              { value: "PEA", label: t("peaLabel") },
              { value: "CTO", label: t("ctoLabel") },
            ]}
          />
        )}
        {isInvestment && (
          <>
            <Select
              label={t("taxTreatment")}
              name="taxTreatment"
              value={taxTreatment}
              onChange={(e) => setTaxTreatment(e.target.value)}
              options={[
                { value: "TAXABLE", label: t("taxTreatmentTaxable") },
                { value: "EXEMPT", label: t("taxTreatmentExempt") },
                { value: "DEFERRED", label: t("taxTreatmentDeferred") },
              ]}
            />
            {taxTreatment === "TAXABLE" && (
              <Input
                label={t("taxRatePct")}
                name="taxRatePct"
                type="number"
                step="0.1"
                min="0"
                max="100"
                value={taxRatePct}
                onChange={(e) => setTaxRatePct(e.target.value)}
              />
            )}
          </>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            {tc("cancel")}
          </Button>
          <Button type="submit" disabled={pending || !institutions.length}>
            {pending ? t("creating") : t("submit")}
          </Button>
        </div>
        {!institutions.length && (
          <p className="text-xs text-[var(--negative)] text-center">{t("addFirst")}</p>
        )}
      </form>
    </Dialog>
  );
}
