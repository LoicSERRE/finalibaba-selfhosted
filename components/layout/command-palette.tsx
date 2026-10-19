"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as RadixDialog from "@radix-ui/react-dialog";
import { useTranslations } from "next-intl";
import { goTarget, isBareKey, isPaletteShortcut } from "@/lib/domain/shortcuts";
import { OPEN_PALETTE_EVENT, type PaletteMode } from "@/components/layout/palette-events";
import { CommandPalettePanel } from "@/components/layout/command-palette-panel";
import { PaletteHelp } from "@/components/layout/palette-help";

/**
 * The command palette and the app's keyboard shortcuts (v2.15), mounted once
 * in the root layout for a signed-in viewer: Ctrl/Cmd+K opens the palette,
 * "?" its shortcut list, and "g" then a letter jumps to a page. The H key
 * for discretion has its own listener (discretion.tsx).
 */
export function CommandPalette() {
  const t = useTranslations("palette");
  const router = useRouter();
  const [mode, setMode] = useState<PaletteMode | null>(null);
  const previous = useRef<{ key: string; at: number } | null>(null);

  useEffect(() => {
    const onOpen = (e: Event) => setMode((e as CustomEvent<PaletteMode>).detail ?? "search");
    const onKeyDown = (e: KeyboardEvent) => {
      if (isPaletteShortcut(e)) {
        e.preventDefault();
        setMode((m) => (m === "search" ? null : "search"));
        return;
      }
      if (!isBareKey(e)) return;
      if (e.key === "?") {
        e.preventDefault();
        setMode("help");
        return;
      }
      const href = goTarget(previous.current, e.key, Date.now());
      previous.current = { key: e.key.toLowerCase(), at: Date.now() };
      if (href) {
        e.preventDefault();
        previous.current = null;
        router.push(href);
      }
    };
    globalThis.addEventListener(OPEN_PALETTE_EVENT, onOpen);
    globalThis.addEventListener("keydown", onKeyDown);
    return () => {
      globalThis.removeEventListener(OPEN_PALETTE_EVENT, onOpen);
      globalThis.removeEventListener("keydown", onKeyDown);
    };
  }, [router]);

  const close = () => setMode(null);
  const title = mode === "help" ? t("help.title") : t("title");

  return (
    <RadixDialog.Root open={mode !== null} onOpenChange={(open) => !open && close()}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="dialog-overlay fixed inset-0 bg-black/60 backdrop-blur-sm z-40" />
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[12dvh]">
          <RadixDialog.Content className="dialog-content w-full max-w-xl bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-2xl p-4">
            <RadixDialog.Title className="sr-only">{title}</RadixDialog.Title>
            <RadixDialog.Description className="sr-only">{title}</RadixDialog.Description>
            {mode === "help" ? <PaletteHelp /> : <CommandPalettePanel onClose={close} onHelp={() => setMode("help")} />}
          </RadixDialog.Content>
        </div>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
