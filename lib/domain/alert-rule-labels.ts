/**
 * How a stored AlertRule reads on screen, one sentence per kind.
 *
 * Split out of components/settings/alert-rules-section.tsx at v2.10.5. It was
 * 23 cyclomatic complexity sitting inside an 810-line client component, which
 * made a pure function reachable only by rendering one - the reason its eight
 * branches had never been tested. It takes the translator as an argument and
 * touches nothing else, so it belongs here.
 */
import { formatCurrency } from "@/lib/utils/format";

type AlertRuleKind =
  | "ACCOUNT_BALANCE"
  | "BUDGET_OVERRUN"
  | "ACCOUNT_OVERDRAFT"
  | "INVESTMENT_VALUE"
  | "HOLDING_PRICE"
  | "UNREALIZED_GAIN"
  | "REBALANCING_DRIFT"
  | "NEW_TRANSACTION";

type AlertRuleRow = {
  id: string;
  kind: AlertRuleKind;
  active: boolean;
  message: string | null;
  account: { id: string; name: string } | null;
  balanceThresholdCents: bigint | null;
  category: { id: string; name: string; budgetCents: bigint | null } | null;
  holding: { id: string; ticker: string; name: string | null; account: { id: string; name: string } } | null;
  gainUnit: "PERCENT" | "AMOUNT" | null;
  gainThresholdPct: number | null;
  transactionDirection: "DEBIT" | "CREDIT" | null;
};


export type { AlertRuleKind, AlertRuleRow };


// The same three fallbacks were spelled out inline at every case below, which
// is most of what made this function's measured complexity outweigh its length:
// each `??` is a branch. Naming them reads better than repeating them and drops
// roughly a third of the branches. "?" is the placeholder for a target whose row
// was deleted out from under the rule - the FK is onDelete: Cascade, so this is
// defensive rather than expected.
const accountName = (rule: AlertRuleRow) => rule.account?.name ?? "?";
const holdingName = (rule: AlertRuleRow) => rule.holding?.name ?? rule.holding?.ticker ?? "?";
const thresholdAmount = (rule: AlertRuleRow) => formatCurrency(rule.balanceThresholdCents ?? BigInt(0));

// Kept separate from the JSX below to stay under the sonarjs
// cognitive-complexity gate now that there are 8 kinds to label.
export function ruleLabel(rule: AlertRuleRow, t: (key: string, vars?: Record<string, string | number>) => string): string {
  switch (rule.kind) {
    case "ACCOUNT_BALANCE":
      return t("ruleAccountBalance", {
        account: accountName(rule),
        threshold: thresholdAmount(rule),
      });
    case "ACCOUNT_OVERDRAFT":
      return t("ruleAccountOverdraft", { account: accountName(rule) });
    case "INVESTMENT_VALUE":
      return t("ruleInvestmentValue", {
        account: accountName(rule),
        threshold: thresholdAmount(rule),
      });
    case "HOLDING_PRICE":
      return t("ruleHoldingPrice", {
        ticker: holdingName(rule),
        threshold: thresholdAmount(rule),
      });
    case "REBALANCING_DRIFT":
      return t("ruleRebalancingDrift", {
        ticker: holdingName(rule),
        threshold: `${rule.gainThresholdPct ?? 0} pts`,
      });
    case "UNREALIZED_GAIN":
      return t("ruleUnrealizedGain", {
        scope: rule.account?.name ?? t("gainAllAccounts"),
        threshold: rule.gainUnit === "PERCENT" ? `${rule.gainThresholdPct ?? 0} %` : thresholdAmount(rule),
      });
    case "NEW_TRANSACTION": {
      const scope = rule.account?.name ?? t("newTransactionAllAccounts");
      const direction =
        rule.transactionDirection === "DEBIT"
          ? t("directionDebit")
          : rule.transactionDirection === "CREDIT"
            ? t("directionCredit")
            : t("directionBoth");
      const minimum = rule.balanceThresholdCents !== null ? formatCurrency(rule.balanceThresholdCents) : null;
      return minimum
        ? t("ruleNewTransactionWithMinimum", { scope, direction, minimum })
        : t("ruleNewTransaction", { scope, direction });
    }
    case "BUDGET_OVERRUN":
    default:
      return t("ruleBudgetOverrun", { category: rule.category?.name ?? "?" });
  }
}
