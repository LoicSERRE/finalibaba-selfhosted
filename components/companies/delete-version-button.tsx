"use client";

import { useTranslations } from "next-intl";
import { DeleteButton } from "@/components/shared/delete-button";
import { toast } from "@/components/ui/toast";
import { deleteCapTableVersion } from "@/lib/actions/companies";

/**
 * Deletes a dated cap table recorded by mistake. With its confirmation
 * dialog, not an undo: it can drop an associate it alone named, and with them
 * their access to the company.
 */
export function DeleteVersionButton({ companyId, versionId }: Readonly<{ companyId: string; versionId: string }>) {
  const t = useTranslations("companies");
  return (
    <DeleteButton
      iconOnly
      label={t("history.delete")}
      description={t("history.deleteDescription")}
      onDelete={async () => {
        const result = await deleteCapTableVersion(companyId, versionId);
        if (!result.ok) toast({ message: t(`errors.${result.error}`), tone: "error" });
      }}
    />
  );
}
