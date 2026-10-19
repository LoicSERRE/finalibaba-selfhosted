"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Search } from "lucide-react";
import { composeResults, PALETTE_SEARCH_MIN, type PaletteItem } from "@/lib/domain/command-palette";
import { searchPalette, type PaletteResults } from "@/lib/actions/palette";
import { useDiscretion } from "@/components/layout/discretion";
import { runPaletteAction } from "@/components/layout/palette-actions";
import { resultItems, staticItems } from "@/components/layout/palette-items";

type Props = {
  readonly onClose: () => void;
  readonly onHelp: () => void;
};

const SEARCH_DELAY_MS = 200;

/**
 * The palette's search box and results (v2.15), as a combobox: the input
 * keeps focus, arrows move the active option, Enter runs it. Static commands
 * are ranked locally; accounts, categories and transactions come from
 * searchPalette once the query is long enough, newest request wins.
 */
export function CommandPalettePanel({ onClose, onHelp }: Props) {
  const t = useTranslations("palette");
  const tabs = useTranslations("settings.tabs");
  const router = useRouter();
  const { discreet } = useDiscretion(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [results, setResults] = useState<PaletteResults | null>(null);
  const latest = useRef(0);

  useEffect(() => {
    const q = query.trim();
    const request = ++latest.current;
    if (q.length < PALETTE_SEARCH_MIN) return;
    const timer = setTimeout(() => {
      searchPalette(q).then((found) => {
        if (request === latest.current) setResults(found);
      }, () => undefined);
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const items = useMemo(
    // Results for a query now too short are stale, not cleared state: ignored
    // here rather than reset inside the effect.
    () =>
      composeResults(
        staticItems(t, tabs, discreet),
        resultItems(query.trim().length >= PALETTE_SEARCH_MIN ? results : null, query, t),
        query
      ),
    [t, tabs, discreet, query, results]
  );
  const current = Math.min(active, Math.max(items.length - 1, 0));

  const run = (item: PaletteItem | undefined) => {
    if (!item) return;
    if (item.id === "action:help") {
      onHelp();
      return;
    }
    onClose();
    if (item.href) router.push(item.href);
    else void runPaletteAction(item.id.slice("action:".length), router.refresh);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") setActive((current + 1) % Math.max(items.length, 1));
    else if (e.key === "ArrowUp") setActive((current - 1 + items.length) % Math.max(items.length, 1));
    else if (e.key === "Enter") run(items[current]);
    else return;
    e.preventDefault();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 px-3 rounded-lg bg-[var(--surface-elevated)] border border-[var(--border)] focus-within:border-[var(--accent)]">
        <Search size={16} aria-hidden="true" className="text-[var(--muted)] shrink-0" />
        <input
          autoFocus
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-options"
          aria-activedescendant={items[current] ? `palette-${items[current].id}` : undefined}
          aria-label={t("inputLabel")}
          placeholder={t("placeholder")}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          className="w-full min-h-[44px] bg-transparent text-sm text-[var(--foreground)] placeholder:text-[var(--muted)] outline-none"
        />
      </div>
      <ul id="palette-options" role="listbox" aria-label={t("resultsLabel")} className="max-h-[50dvh] overflow-y-auto -mx-2">
        {items.length === 0 && <li className="px-3 py-6 text-center text-sm text-[var(--muted)]">{t("empty")}</li>}
        {items.map((item, index) => (
          <li
            key={item.id}
            id={`palette-${item.id}`}
            role="option"
            aria-selected={index === current}
            onMouseMove={() => setActive(index)}
            onClick={() => run(item)}
            className={`flex items-center gap-3 mx-2 px-3 py-2 rounded-lg text-sm cursor-pointer ${
              index === current ? "bg-[var(--accent)]/15 text-[var(--foreground)]" : "text-[var(--muted)]"
            }`}
          >
            <span className="shrink-0 w-24 text-[10px] uppercase tracking-wider text-[var(--muted)]">{t(`groups.${item.group}`)}</span>
            <span className="flex-1 min-w-0 truncate text-[var(--foreground)]">{item.label}</span>
            {item.amount && <span className="shrink-0 tabular-nums amount">{item.amount}</span>}
            {item.hint && <span className="shrink-0 text-xs text-[var(--muted)] truncate max-w-[40%]">{item.hint}</span>}
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-[var(--muted)]">{t("footer")}</p>
    </div>
  );
}
