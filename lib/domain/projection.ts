// Long-term net worth projection: closed-form per year rather than an
// iterative simulation, which avoids float drift across 30 iterations.
//
// Plain `number` cents, not `bigint` - this runs client-side on every keystroke
// of a live input, and the caller converts once at the boundary.
export interface ProjectionPoint {
  year: number; // 0 = today
  netWorthCents: number;
  // Same figure with estimated latent tax on projected *gain* deducted -
  // see effectiveTaxRate below. Equals netWorthCents whenever effectiveTaxRate
  // is 0 (the default) or the position hasn't gained yet.
  netWorthAfterTaxCents: number;
}

// NW(t) = N0*(1+r)^t + C*(((1+r)^t - 1)/r) - future value of a lump sum
// plus an ordinary annuity of C contributed at the end of each year. The
// r=0 case is handled separately since the annuity term divides by r.
export function projectNetWorth(params: {
  currentCents: number;
  annualContributionCents: number; // 0 when no declared savings
  annualReturnRate: number; // e.g. 0.05 for 5%
  horizonYears: number;
  // Blended latent-tax rate (0-1 ratio, see lib/domain/analytics.ts's
  // effectiveTaxRate) applied only to projected *gain*, never to fresh
  // contributions - mirrors totalLatentTax's own "only gains are taxed"
  // logic elsewhere in this app. gain(t) = NW(t) - N0 - C*t (growth
  // attributable to returns, not money put in). Defaults to 0 (no tax
  // modeled) so existing pre-tax-only callers are unaffected.
  effectiveTaxRate?: number;
}): ProjectionPoint[] {
  const { currentCents, annualContributionCents: C, annualReturnRate: r, horizonYears, effectiveTaxRate = 0 } = params;
  const points: ProjectionPoint[] = [];
  for (let t = 0; t <= horizonYears; t++) {
    const netWorthCents =
      r === 0 ? currentCents + C * t : currentCents * (1 + r) ** t + (C * ((1 + r) ** t - 1)) / r;
    const gainCents = netWorthCents - currentCents - C * t;
    const netWorthAfterTaxCents = gainCents > 0 ? netWorthCents - gainCents * effectiveTaxRate : netWorthCents;
    points.push({
      year: t,
      netWorthCents: Math.round(netWorthCents),
      netWorthAfterTaxCents: Math.round(netWorthAfterTaxCents),
    });
  }
  return points;
}

// One blended rate over the ENTIRE net worth assumes cash in a current account
// compounds like a PEA. This splits today's net worth and the future
// contribution into two growing buckets - invested (the only one
// effectiveTaxRate applies to) and liquid - plus a non-compounding fixedCents
// offset for property and vehicles, frozen because this app models no
// home-price appreciation anywhere and inventing one would be optimistic.
//
// The contribution splits in today's own liquid/invested proportion: the app
// does not track where declared savings land, so "the same habit as today" is
// the grounded default rather than assuming it all goes to the invested rate.
export function projectNetWorthSplit(params: {
  liquidCurrentCents: number;
  investedCurrentCents: number;
  fixedCurrentCents: number;
  annualContributionCents: number;
  liquidReturnRate: number;
  investedReturnRate: number;
  horizonYears: number;
  effectiveTaxRate?: number;
  /** Latent tax already owed on today's gains, deducted at every point
   *  INCLUDING year 0. Taxing only future gains made year 0 equal the pre-tax
   *  figure, so the chart opened on a number the card above it had already
   *  reduced by exactly this amount. */
  currentLatentTaxCents?: number;
}): ProjectionPoint[] {
  const {
    liquidCurrentCents,
    investedCurrentCents,
    fixedCurrentCents,
    annualContributionCents: C,
    liquidReturnRate,
    investedReturnRate,
    horizonYears,
    effectiveTaxRate = 0,
    currentLatentTaxCents = 0,
  } = params;

  const growingTotal = liquidCurrentCents + investedCurrentCents;
  // No current liquid/invested balance at all (e.g. a fresh account that's
  // only real estate) - put fresh savings in the liquid bucket rather than
  // dividing by zero or guessing an invested share with no basis.
  const investedShare = growingTotal > 0 ? investedCurrentCents / growingTotal : 0;
  const investedContributionCents = C * investedShare;
  const liquidContributionCents = C - investedContributionCents;

  const investedPoints = projectNetWorth({
    currentCents: investedCurrentCents,
    annualContributionCents: investedContributionCents,
    annualReturnRate: investedReturnRate,
    horizonYears,
    effectiveTaxRate,
  });
  const liquidPoints = projectNetWorth({
    currentCents: liquidCurrentCents,
    annualContributionCents: liquidContributionCents,
    annualReturnRate: liquidReturnRate,
    horizonYears,
  });

  return investedPoints.map((invested, i) => ({
    year: invested.year,
    netWorthCents: Math.round(fixedCurrentCents + invested.netWorthCents + liquidPoints[i].netWorthCents),
    netWorthAfterTaxCents: Math.round(
      fixedCurrentCents
        + invested.netWorthAfterTaxCents
        + liquidPoints[i].netWorthAfterTaxCents
        - currentLatentTaxCents,
    ),
  }));
}
