type T = (key: string) => string;

/** The money flow's labels, set-aside ones included (v2.21) - the month and year views share them. */
export function flowNames(t: T) {
  return {
    income: t("flow.income"),
    savings: t("flow.savings"),
    drawn: t("flow.drawn"),
    other: t("flow.other"),
    uncategorizedIncome: t("flow.uncategorizedIncome"),
    uncategorizedSpend: t("flow.uncategorizedSpend"),
    leftover: t("flow.leftover"),
    drawnCurrent: t("flow.drawnCurrent"),
    setSavings: t("setAside.savings"),
    takenFromSavings: t("setAside.takenFromSavings"),
    setInvestment: t("setAside.investment"),
    takenFromInvestment: t("setAside.takenFromInvestment"),
  };
}
