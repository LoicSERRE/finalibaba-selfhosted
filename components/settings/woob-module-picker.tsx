"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";

interface WoobModule {
  module: string;
  label: string;
}

interface Props {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  modules: WoobModule[];
  otherValue: string;
  otherLabel: string;
  placeholder: string;
  searchPlaceholder: string;
  searchAriaLabel: string;
  noResultsLabel: string;
}

// Diacritic-insensitive substring match - French bank names are full of
// accents ("Crédit Agricole", "Société Générale", "Épargne") and a user
// typing plain ASCII should still find them.
function normalize(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

// Searchable replacement for a plain <select> over the ~96-entry Woob
// catalog (see getWoobBankModules() in lib/actions/sync.ts) - a native
// <select> with that many <option>s renders as a browser dropdown that
// covers almost the entire viewport with no way to filter, which is exactly
// what a new self-hosted user hits on first use of "Ajouter une
// institution". Closed by default showing the current selection (or
// `placeholder`); opening it reveals an inline search box + a
// height-capped, internally-scrolling list, mirroring the same
// search-input-above-a-bounded-list shape components/settings/
// connect-open-banking-dialog.tsx already uses for GoCardless's own bank
// picker - this is the same problem, just filtering a static local array
// instead of debouncing a remote fetch.
//
// The search+list panel renders in normal document flow (pushing the rest
// of the form down), not as a `position: absolute` overlay - confirmed the
// hard way with a real Playwright screenshot that an absolutely positioned
// version gets silently clipped by the parent Dialog's own
// `overflow-y-auto` (components/ui/dialog.tsx's RadixDialog.Content):
// overflow clipping on an ancestor applies to absolutely positioned
// descendants regardless of z-index, so the list existed in the DOM
// (clicks against it still worked) but was completely invisible - exactly
// the kind of bug that only shows up in an actual rendered screenshot, not
// in code review.
export function WoobModulePicker({
  id,
  label,
  value,
  onChange,
  modules,
  otherValue,
  otherLabel,
  placeholder,
  searchPlaceholder,
  searchAriaLabel,
  noResultsLabel,
}: Readonly<Props>) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // -1 = nothing highlighted (initial state, and whenever the filtered list
  // changes shape - a stale index pointing past the new list's end, or at a
  // now-different option, would be worse than no highlight at all).
  const [highlighted, setHighlighted] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selectedLabel = value === otherValue ? otherLabel : modules.find((m) => m.module === value)?.label;
  const filtered = query.trim()
    ? modules.filter((m) => normalize(m.label).includes(normalize(query)))
    : modules;
  // otherValue is always appended as a real, selectable row in the DOM list
  // below (the escape hatch for a bank not in the catalog) - folding it
  // into this same array is what lets arrow-key navigation and
  // aria-activedescendant treat it as just one more option instead of a
  // special case the keyboard handler has to know about separately.
  const options = [...filtered, { module: otherValue, label: otherLabel }];
  const optionId = (index: number) => `${id}-option-${index}`;

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  // Runs on every close, regardless of which of the three paths above
  // triggered it (Escape, click-outside, or a real selection) - without
  // this, closing the panel drops focus into the void (the just-clicked
  // option button is removed from the DOM, and browsers fall back to
  // focusing <body>), stranding a keyboard user with no visible focus
  // indicator anywhere on the page.
  useEffect(() => {
    if (!open) triggerRef.current?.focus();
  }, [open]);

  useEffect(() => {
    setHighlighted(-1);
  }, [query, open]);

  useEffect(() => {
    if (highlighted < 0) return;
    document.getElementById(optionId(highlighted))?.scrollIntoView({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlighted]);

  function select(v: string) {
    onChange(v);
    setOpen(false);
    setQuery("");
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    switch (e.key) {
      case "Escape":
        setOpen(false);
        break;
      case "ArrowDown":
        e.preventDefault();
        setHighlighted((i) => (i + 1) % options.length);
        break;
      case "ArrowUp":
        e.preventDefault();
        setHighlighted((i) => (i <= 0 ? options.length - 1 : i - 1));
        break;
      case "Enter":
        e.preventDefault();
        if (highlighted >= 0 && highlighted < options.length) select(options[highlighted].module);
        break;
    }
  }

  return (
    <div ref={containerRef} className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={id} className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
          {label}
        </label>
      )}
      <button
        ref={triggerRef}
        id={id}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="w-full min-h-[44px] px-3 py-2 rounded-lg bg-[var(--surface-elevated)] border border-[var(--border)] text-sm text-left flex items-center justify-between gap-2 outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/30 transition-colors cursor-pointer"
      >
        <span className={selectedLabel ? "text-[var(--foreground)]" : "text-[var(--muted)]"}>
          {selectedLabel ?? placeholder}
        </span>
        <ChevronDown size={14} className="text-[var(--muted)] shrink-0" aria-hidden="true" />
      </button>

      {open && (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg overflow-hidden">
          <div className="relative p-2 border-b border-[var(--border)]">
            <Search size={14} className="absolute left-5 top-1/2 -translate-y-1/2 text-[var(--muted)]" aria-hidden="true" />
            <input
              ref={searchRef}
              type="text"
              role="combobox"
              aria-expanded={open}
              aria-controls={`${id}-listbox`}
              aria-activedescendant={highlighted >= 0 ? optionId(highlighted) : undefined}
              aria-autocomplete="list"
              aria-label={searchAriaLabel}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={searchPlaceholder}
              className="w-full bg-[var(--surface-elevated)] border border-[var(--border)] rounded-lg pl-8 pr-3 py-2 min-h-[40px] text-sm text-[var(--foreground)] placeholder:text-[var(--muted)] outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/30"
            />
          </div>
          <div ref={listRef} id={`${id}-listbox`} role="listbox" className="max-h-64 overflow-y-auto divide-y divide-[var(--border)]">
            {filtered.length === 0 && (
              <p className="py-6 text-center text-sm text-[var(--muted)]">{noResultsLabel}</p>
            )}
            {options.map((m, index) => (
              <button
                key={m.module}
                id={optionId(index)}
                type="button"
                role="option"
                aria-selected={value === m.module}
                onMouseEnter={() => setHighlighted(index)}
                onClick={() => select(m.module)}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2 min-h-[40px] text-sm text-left transition-colors cursor-pointer ${
                  highlighted === index ? "bg-[var(--surface-elevated)]" : "hover:bg-[var(--surface-elevated)]"
                } ${m.module === otherValue ? "text-[var(--muted)]" : ""}`}
              >
                <span className={m.module === otherValue ? "" : "text-[var(--foreground)]"}>{m.label}</span>
                {value === m.module && <Check size={14} className="text-[var(--accent-text)] shrink-0" aria-hidden="true" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
