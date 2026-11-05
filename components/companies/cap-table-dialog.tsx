"use client";

import { centsToEuro } from "@/lib/utils/format";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pencil } from "lucide-react";
import { saveCapTable } from "@/lib/actions/companies";
import { CapTableEditor } from "@/components/companies/cap-table-editor";
import {
  newRowKey,
  toCapTableInput,
  type CapTableRowDraft,
  type DismembermentDraft,
} from "@/components/companies/cap-table-draft";
import { useFailureText, type ManagerAssociate, type ManagerDismemberment } from "@/components/companies/manager-shared";

/** The manager's cap table editor, on the company page. */
function rowsFrom(associates: ManagerAssociate[]): CapTableRowDraft[] {
  return associates.map((a) => ({
    key: newRowKey(),
    id: a.id,
    name: a.name,
    parts: String(a.parts),
    username: a.username ?? "",
    self: a.isViewer,
    currentAccount: a.currentAccountCents > 0 ? centsToEuro(a.currentAccountCents).replace(".", ",") : "",
    birthDate: a.birthDate ?? "",
  }));
}

/** The stored blocks, naming their sides by the rows' keys. */
function blocksFrom(rows: CapTableRowDraft[], dismemberments: ManagerDismemberment[]): DismembermentDraft[] {
  const keyOf = new Map(rows.map((r) => [r.id, r.key]));
  return dismemberments.map((d) => ({
    key: newRowKey(),
    parts: String(d.parts),
    usufructuaryKey: keyOf.get(d.usufructuaryId) ?? "",
    bareOwnerKey: keyOf.get(d.bareOwnerId) ?? "",
  }));
}

export function CapTableDialog({
  companyId,
  totalParts: initialTotal,
  associates,
  dismemberments,
}: Readonly<{ companyId: string; totalParts: number; associates: ManagerAssociate[]; dismemberments: ManagerDismemberment[] }>) {
  const t = useTranslations("companies");
  const router = useRouter();
  const failureText = useFailureText();
  const initialRows = () => rowsFrom(associates);
  const [open, setOpen] = useState(false);
  const [totalParts, setTotalParts] = useState(String(initialTotal));
  const [rows, setRows] = useState(initialRows);
  const [blocks, setBlocks] = useState(() => blocksFrom(rows, dismemberments));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const result = await saveCapTable(companyId, { totalParts: Number(totalParts), ...toCapTableInput(rows, blocks) });
      const failure = failureText(result);
      if (failure) {
        setError(failure);
        return;
      }
      setOpen(false);
      router.refresh();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          const fresh = initialRows();
          setRows(fresh);
          setBlocks(blocksFrom(fresh, dismemberments));
          setTotalParts(String(initialTotal));
          setError(null);
        }
      }}
      title={t("capTable.title")}
      trigger={
        <Button variant="ghost" size="sm">
          <Pencil size={14} aria-hidden="true" />
          {t("page.editAssociates")}
        </Button>
      }
    >
      <div className="space-y-4">
        <Input
          label={t("wizard.totalParts")}
          inputMode="numeric"
          value={totalParts}
          onChange={(e) => setTotalParts(e.target.value.replace(/\D/g, ""))}
        />
        <CapTableEditor totalParts={Number(totalParts)} rows={rows} onRowsChange={setRows} blocks={blocks} onBlocksChange={setBlocks} />
        {error && <p role="alert" className="text-sm text-[var(--negative-text)]">{error}</p>}
        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? t("capTable.saving") : t("capTable.save")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
