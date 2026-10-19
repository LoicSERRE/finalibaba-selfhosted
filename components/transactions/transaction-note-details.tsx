import Link from "next/link";

/**
 * A transaction's note and tags under its label (v2.14). Each tag is a link
 * to the ledger filtered on it, so a tag is a way to find things as well as
 * a label. Renders nothing for a transaction with neither.
 */
export function TransactionNoteDetails({ note, tags }: Readonly<{ note: string | null; tags: readonly string[] }>) {
  if (!note && tags.length === 0) return null;
  return (
    <div className="mt-1 space-y-1">
      {note && (
        <p className="text-xs text-[var(--muted)] italic line-clamp-2 break-words" title={note}>
          {note}
        </p>
      )}
      {tags.length > 0 && (
        <ul className="flex flex-wrap gap-1">
          {tags.map((tag) => (
            <li key={tag}>
              <Link
                href={`/transactions?tag=${encodeURIComponent(tag)}`}
                className="inline-block text-[11px] leading-5 px-2 rounded-full bg-[var(--accent)]/15 text-[var(--accent-text)] hover:bg-[var(--accent)]/25 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              >
                #{tag}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
