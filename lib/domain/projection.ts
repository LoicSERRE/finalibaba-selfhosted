// Long-term net worth projection (v1.14) - pure compound-growth math,
// mirrors lib/domain/loan.ts's "params in, computed stats out" shape.
// Deliberately a closed-form formula per year rather than an iterative
// simulation - same convention loan.ts already uses for its own annuity
// math, and avoids float drift accumulating across 30 loop iterations.
//
// Takes plain `number` cents, not `bigint` - this is called client-side
// from a component driven by a live input, recomputed on every change;
// the caller converts from `bigint` once at the boundary. Growth math in
// `Number` (not `bigint`) matches how investCAGR/goalPct already mix
// Number(bigintCents) ratios elsewhere in lib/domain/analytics.ts - JS's
// 53-bit safe-integer range comfortably covers real personal net-worth
// magnitudes.
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

// A single blended return rate applied to the *entire* net worth (the
// plain projectNetWorth above) silently assumes every euro - including
// cash sitting in a checking account or a low-yield livret - compounds at
// the same rate as the invested portion. Real user feedback: "on ne sait
// pas où va l'épargne" - a livret at ~2-3% and a PEA at ~7% can't share
// one number without materially over- or under-stating the real outcome.
//
// This splits both today's net worth AND the future annual contribution
// into two growing buckets - "invested" (compounds at investedReturnRate,
// the only bucket effectiveTaxRate applies to, matching how latent tax is
// scoped to investment/crypto accounts elsewhere in this app) and "liquid"
// (cash + savings accounts, compounds at a separate, usually much lower
// liquidReturnRate) - plus a third, non-compounding fixedCents offset for
// everything else (real estate/automobile equity net of any standalone
// loan capital) added unchanged at every year. This app has no home-price-
// appreciation model anywhere else either, so freezing that portion is the
// honest "we don't model this" stance rather than a silent, more
// optimistic assumption.
//
// The contribution is split in the same proportion as today's real
// liquidCents/investedCents balance - this app doesn't track which
// account declared monthly savings actually lands in, so "assume future
// savings keep the same habit as today's real portfolio split" is the
// best available grounded default (vs. inventing a number, or - the
// previous behavior - implicitly assuming 100% goes to the invested rate).
export function projectNetWorthSplit(params: {
  liquidCurrentCents: number;
  investedCurrentCents: number;
  fixedCurrentCents: number;
  annualContributionCents: number;
  liquidReturnRate: number;
  investedReturnRate: number;
  horizonYears: number;
  effectiveTaxRate?: number;
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
      fixedCurrentCents + invested.netWorthAfterTaxCents + liquidPoints[i].netWorthAfterTaxCents,
    ),
  }));
}
