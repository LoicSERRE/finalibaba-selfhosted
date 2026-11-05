import { useTranslations } from "next-intl";
import type { CompanyFailure } from "@/lib/actions/companies";

/**
 * The company page's manager tools. Rendered for the manager only, and every
 * action behind them refuses anyone else (assertCompanyManager) - the hiding
 * is so an associate is never offered a button whose only outcome is an error.
 */

export type ManagerAssociate = {
  id: string;
  name: string;
  parts: number;
  username: string | null;
  isViewer: boolean;
  link: "accepted" | "pending" | null;
  currentAccountCents: number;
  /** "YYYY-MM-DD", for the editor - an usufructuary's age values the usufruct. */
  birthDate: string | null;
};

/** A stored démembrement block, its sides by associate id. */
export type ManagerDismemberment = { parts: number; usufructuaryId: string; bareOwnerId: string };

/** A returned failure as the sentence to show, or null for a success. */
export function useFailureText() {
  const t = useTranslations("companies.errors");
  return (result: { ok: true } | CompanyFailure) => (result.ok ? null : t(result.error));
}
