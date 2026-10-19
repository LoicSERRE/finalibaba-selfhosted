"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { NotebookPen, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FormAlert } from "@/components/ui/form-alert";
import { toast } from "@/components/ui/toast";
import { setTransactionNote } from "@/lib/actions/transactions";
import { NOTE_MAX_LENGTH, TAGS_MAX, parseTags } from "@/lib/domain/transaction-notes";

type Props = {
  readonly transactionId: string;
  readonly label: string;
  readonly note: string | null;
  readonly tags: readonly string[];
  /** Every tag already in use, offered as suggestions. */
  readonly suggestions: readonly string[];
};

const FIELD =
  "w-full px-3 py-2 rounded-lg bg-[var(--surface-elevated)] border border-[var(--border)] text-sm text-[var(--foreground)] placeholder:text-[var(--muted)] outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/30";

/**
 * Edit a transaction's note and tags (v2.14). Tags are entered one at a time
 * with the existing ones suggested; Enter or a comma adds the one typed,
 * Backspace on an empty field takes the last one back.
 */
export function TransactionNoteButton({ transactionId, label, note, tags, suggestions }: Props) {
  const t = useTranslations("transactions.note");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draftNote, setDraftNote] = useState(note ?? "");
  const [draftTags, setDraftTags] = useState<string[]>([...tags]);
  const [tagInput, setTagInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const hasContent = Boolean(note) || tags.length > 0;
  const listId = `tag-suggestions-${transactionId}`;

  const reset = (isOpen: boolean) => {
    setOpen(isOpen);
    if (!isOpen) return;
    setDraftNote(note ?? "");
    setDraftTags([...tags]);
    setTagInput("");
    setError(null);
  };

  const addTyped = () => {
    const next = parseTags([...draftTags, ...tagInput.split(",")]);
    setDraftTags(next);
    setTagInput("");
  };

  const onTagKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTyped();
    } else if (e.key === "Backspace" && tagInput === "" && draftTags.length > 0) {
      setDraftTags(draftTags.slice(0, -1));
    }
  };

  const save = () => {
    const finalTags = parseTags([...draftTags, ...tagInput.split(",")]);
    startTransition(async () => {
      const result = await setTransactionNote(transactionId, draftNote, finalTags);
      if (!result.ok) {
        setError(t(`errors.${result.error}`, { max: result.error === "too_many_tags" ? TAGS_MAX : NOTE_MAX_LENGTH }));
        return;
      }
      setOpen(false);
      toast({ message: t("saved") });
      router.refresh();
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={reset}
      title={t("title")}
      trigger={
        <button
          type="button"
          aria-label={t(hasContent ? "editFor" : "addFor", { label })}
          title={t(hasContent ? "edit" : "add")}
          className={`inline-flex items-center justify-center w-11 h-11 rounded-lg transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
            hasContent ? "text-[var(--accent-text)] hover:bg-[var(--accent)]/15" : "text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--surface-elevated)]"
          }`}
        >
          <NotebookPen size={16} aria-hidden="true" />
        </button>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-[var(--muted)] break-words">{label}</p>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-[var(--foreground)]">{t("noteLabel")}</span>
          <textarea
            value={draftNote}
            onChange={(e) => setDraftNote(e.target.value)}
            maxLength={NOTE_MAX_LENGTH}
            rows={3}
            placeholder={t("notePlaceholder")}
            className={`${FIELD} resize-y`}
          />
        </label>
        <div className="space-y-1.5">
          <label htmlFor={`${listId}-input`} className="text-sm font-medium text-[var(--foreground)]">
            {t("tagsLabel")}
          </label>
          {draftTags.length > 0 && (
            <ul className="flex flex-wrap gap-1.5">
              {draftTags.map((tag) => (
                <li key={tag} className="inline-flex items-center gap-1 text-xs pl-2 pr-1 py-0.5 rounded-full bg-[var(--accent)]/15 text-[var(--accent-text)]">
                  #{tag}
                  <button
                    type="button"
                    onClick={() => setDraftTags(draftTags.filter((x) => x !== tag))}
                    aria-label={t("removeTag", { tag })}
                    className="p-0.5 rounded-full hover:bg-[var(--accent)]/25 cursor-pointer"
                  >
                    <X size={12} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <input
            id={`${listId}-input`}
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={onTagKey}
            onBlur={() => tagInput.trim() && addTyped()}
            list={listId}
            placeholder={t("tagsPlaceholder")}
            className={FIELD}
          />
          <datalist id={listId}>
            {suggestions.filter((s) => !draftTags.includes(s)).map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          <p className="text-xs text-[var(--muted)]">{t("tagsHint", { max: TAGS_MAX })}</p>
        </div>
        <FormAlert tone="error">{error}</FormAlert>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            {t("cancel")}
          </Button>
          <Button onClick={save} disabled={pending}>
            {pending ? t("saving") : t("save")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
