import type { FlowNames } from "@/lib/domain/money-flow";

type T = (key: string) => string;

/** A movement's two names, [left the current accounts, came in] - shared by the flow and the current-accounts card. */
export function movementNames(t: T) {
  const pair = (out: string, inName: string) => [t(out), t(inName)] as const;
  return {
    setSavings: pair("setAside.savings", "setAside.takenFromSavings"),
    setInvestment: pair("setAside.investment", "setAside.takenFromInvestment"),
    loan: pair("movements.loanOut", "movements.loanIn"),
    untracked: pair("movements.untrackedOut", "movements.untrackedIn"),
    between: pair("movements.between", "movements.between"),
    elsewhere: pair("movements.elsewhereOut", "movements.elsewhereIn"),
  };
}

/** The money flow's labels (v2.21) - the month and year views share them. */
export function flowNames(t: T): FlowNames {
  return {
    hub: t("flow.hub"),
    other: t("flow.other"),
    uncategorizedIncome: t("flow.uncategorizedIncome"),
    uncategorizedSpend: t("flow.uncategorizedSpend"),
    leftover: t("movements.leftover"),
    drawnCurrent: t("movements.drawnCurrent"),
    ...movementNames(t),
  };
}
