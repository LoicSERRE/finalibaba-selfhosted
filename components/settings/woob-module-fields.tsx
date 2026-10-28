"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Input, Select } from "@/components/ui/input";
import { getWoobModuleFields } from "@/lib/actions/sync";
import {
  WOOB_EXTRA_PREFIX,
  isWoobModuleName,
  type WoobCredentialError,
  type WoobField,
} from "@/lib/domain/woob-fields";

/**
 * The fields a Woob module needs besides login and password (issue #135: the
 * Crédit Agricole region, ING's date of birth), as declared by the module
 * itself - see sync/woob_config.py. Shared by "Ajouter une institution" and
 * "Configurer la synchro", the two places a Woob connection is written.
 */

// A module typed by hand under "Autre" changes on every keystroke.
const DEBOUNCE_MS = 300;

/**
 * The module's fields, refetched when it changes. `fields` is null while
 * loading and when the sync service cannot say - the form then asks for a
 * login and a password, as before. Loading is derived rather than stored, so
 * the effect never sets state synchronously.
 */
interface ModuleFields {
  fields: WoobField[] | null;
  loading: boolean;
}

interface FetchedFields {
  module: string;
  fields: WoobField[] | null;
}

export function useWoobModuleFields(module: string | null): ModuleFields {
  const [result, setResult] = useState<FetchedFields | null>(null);
  const active = module !== null && isWoobModuleName(module) ? module : null;

  useEffect(() => {
    if (active === null) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      getWoobModuleFields(active)
        .catch(() => null)
        .then((fields) => {
          if (!cancelled) setResult({ module: active, fields });
        });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [active]);

  if (active === null) return { fields: null, loading: false };
  if (result?.module !== active) return { fields: null, loading: true };
  return { fields: result.fields, loading: false };
}

/** A choice's options. With no default the user has to pick; with a default
 *  outside the list (Caisse d'Epargne's account type: "" lets the module
 *  work it out) that default stays selectable instead of the first entry
 *  silently replacing it. */
function choiceOptions(field: WoobField, choose: string, moduleDefault: string) {
  const options = field.choices.map((c) => ({ value: c.value, label: c.label }));
  if (field.default === null) return [{ value: "", label: choose }, ...options];
  if (!options.some((o) => o.value === field.default)) return [{ value: field.default, label: moduleDefault }, ...options];
  return options;
}

/** One input per extra field, named `woobConfig.<id>` for the Server Action. */
export function WoobExtraFields({ fields, idPrefix }: Readonly<WoobExtraFieldsProps>) {
  return (
    <>
      {fields.map((field) => (
        <WoobFieldInput key={field.id} field={field} id={`${idPrefix}-${field.id}`} />
      ))}
    </>
  );
}

interface WoobExtraFieldsProps {
  fields: readonly WoobField[];
  idPrefix: string;
}

interface WoobFieldInputProps {
  field: WoobField;
  id: string;
}

function WoobFieldInput({ field, id }: Readonly<WoobFieldInputProps>) {
  const t = useTranslations("woobFields");
  const name = `${WOOB_EXTRA_PREFIX}${field.id}`;
  const required = field.required && field.default === null;
  if (field.kind === "choice") {
    return (
      <Select
        id={id}
        name={name}
        label={field.label}
        required={required}
        defaultValue={field.default ?? ""}
        options={choiceOptions(field, t("choose"), t("moduleDefault"))}
      />
    );
  }
  if (field.kind === "bool") {
    return (
      <Select
        id={id}
        name={name}
        label={field.label}
        defaultValue={field.default ?? "n"}
        options={[{ value: "y", label: t("yes") }, { value: "n", label: t("no") }]}
      />
    );
  }
  return (
    <Input
      id={id}
      name={name}
      label={field.label}
      type={field.kind === "secret" ? "password" : field.kind}
      defaultValue={field.default ?? undefined}
      required={required}
      // Bank fields, not this site's own credentials: a browser offering to
      // save or autofill them only ever gets it wrong.
      autoComplete="off"
    />
  );
}

/** The sentence for a failed save, naming the field by the module's label. */
export function useWoobErrorMessage() {
  const t = useTranslations("woobFields.errors");
  return (error: WoobCredentialError | "unexpected", fieldId: string | undefined, fields: readonly WoobField[] | null) => {
    const field = fields?.find((f) => f.id === fieldId)?.label ?? fieldId ?? "";
    return t(error, { field });
  };
}
