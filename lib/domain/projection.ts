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
