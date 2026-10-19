"use client";

import type { PaletteItem } from "@/lib/domain/command-palette";
import { GO_SHORTCUTS } from "@/lib/domain/shortcuts";
import { SETTINGS_TABS } from "@/lib/domain/settings-tabs";
import type { PaletteResults } from "@/lib/actions/palette";

type Translate = (key: string, values?: Record<string, string>) => string;

const GO_HINT: Record<string, string> = Object.fromEntries(Object.entries(GO_SHORTCUTS).map(([key, href]) => [href, `g ${key}`]));

const PAGES: ReadonlyArray<{ href: string; label: string; keywords: string }> = [
  { href: "/", label: "pages.dashboard", keywords: "keywords.dashboard" },
  { href: "/accounts", label: "pages.accounts", keywords: "keywords.accounts" },
  { href: "/transactions", label: "pages.transactions", keywords: "keywords.transactions" },
  { href: "/budgets", label: "pages.budgets", keywords: "keywords.budgets" },
  { href: "/recurring", label: "pages.recurring", keywords: "keywords.recurring" },
  { href: "/income", label: "pages.income", keywords: "keywords.income" },
  { href: "/analytics", label: "pages.analytics", keywords: "keywords.analytics" },
  { href: "/tax-report", label: "pages.taxReport", keywords: "keywords.taxReport" },
  { href: "/settings", label: "pages.settings", keywords: "keywords.settings" },
];

/** Pages, Settings tabs and actions, translated (v2.15). */
export function staticItems(t: Translate, tabs: Translate, discreet: boolean): PaletteItem[] {
  const pages: PaletteItem[] = PAGES.map((page) => ({
    id: `page:${page.href}`,
    group: "pages",
    label: t(page.label),
    keywords: t(page.keywords).split(","),
    hint: GO_HINT[page.href],
    href: page.href,
  }));
  const settingsTabs: PaletteItem[] = SETTINGS_TABS.map((tab) => ({
    id: `settings:${tab}`,
    group: "pages",
    label: `${t("pages.settings")} · ${tabs(tab)}`,
    href: `/settings?tab=${tab}`,
  }));
  const actions: PaletteItem[] = [
    { id: "action:discretion", group: "actions", label: t(discreet ? "actions.showAmounts" : "actions.hideAmounts"), keywords: t("keywords.discretion").split(","), hint: "H" },
    { id: "action:theme-dark", group: "actions", label: t("actions.themeDark"), keywords: [t("keywords.theme")] },
    { id: "action:theme-light", group: "actions", label: t("actions.themeLight"), keywords: [t("keywords.theme")] },
    { id: "action:theme-auto", group: "actions", label: t("actions.themeAuto"), keywords: [t("keywords.theme")] },
    { id: "action:locale-fr", group: "actions", label: t("actions.localeFr"), keywords: [t("keywords.language")] },
    { id: "action:locale-en", group: "actions", label: t("actions.localeEn"), keywords: [t("keywords.language")] },
    { id: "action:help", group: "actions", label: t("actions.help"), keywords: [t("keywords.help")], hint: "?" },
  ];
  return [...pages, ...settingsTabs, ...actions];
}

/** What the server found, as items, then "search the ledger for it". */
export function resultItems(results: PaletteResults | null, query: string, t: Translate): PaletteItem[] {
  const q = query.trim();
  if (!results || q === "") return [];
  const accounts: PaletteItem[] = results.accounts.map((a) => ({
    id: `account:${a.id}`, group: "accounts", label: a.name, hint: a.institution, href: `/accounts/${a.id}`,
  }));
  const categories: PaletteItem[] = results.categories.map((c) => ({
    id: `category:${c.id}`, group: "categories", label: c.name, href: `/budgets/${c.id}`,
  }));
  const transactions: PaletteItem[] = results.transactions.map((tx) => ({
    id: `transaction:${tx.id}`, group: "transactions", label: tx.label, hint: `${tx.date} · ${tx.account}`, amount: tx.amount,
    href: `/transactions?q=${encodeURIComponent(tx.label)}`,
  }));
  const search: PaletteItem = { id: "search", group: "search", label: t("searchIn", { q }), href: `/transactions?q=${encodeURIComponent(q)}` };
  return [...accounts, ...categories, ...transactions, search];
}
