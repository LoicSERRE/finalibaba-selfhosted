// Shared categorical color palettes. Kept as literal hex - these feed a DB
// column (Category.color) and inline `style` props for SVG/chart elements
// that can't resolve CSS custom properties - so they can't just reference
// the var(--token) system. Centralized here instead of each consumer
// independently re-typing (and risking drift on) the same handful of hues.

// User-facing category color picker (components/add-category-dialog.tsx).
export const CATEGORY_SWATCHES = [
  "#6366f1", "#22c55e", "#ef4444", "#f59e0b", "#3b82f6",
  "#ec4899", "#14b8a6", "#a855f7", "#84cc16", "#64748b",
] as const;

// Asset-allocation chart series (components/asset-allocation-chart.tsx).
// Deliberately excludes red - this app uses red exclusively for
// negative/loss amounts elsewhere, and reusing it for a neutral allocation
// slice would misread as "this slice is bad."
export const CHART_COLORS = [
  "#6366f1", "#22c55e", "#f59e0b", "#3b82f6", "#ec4899", "#14b8a6",
] as const;

// Institution-logo fallback avatar background (components/institution-logo.tsx).
export const AVATAR_COLORS = [
  "#6366f1", "#8b5cf6", "#3b82f6", "#06b6d4",
  "#22c55e", "#f59e0b", "#ec4899", "#ef4444",
] as const;

// One fixed hue per asset category, shared by the dashboard pie, the analytics
// pie and the "safe vs risky" radar bar, so a category always reads as the same
// colour everywhere rather than three copies that drift.
//
// Two audit findings shaped these values and both are easy to undo by accident.
// Hue: cash, savings and realEstate were once all in the same narrow
// blue-purple band and indistinguishable as small legend dots. Semantics:
// realEstate then spent a while as a warm grey, which made the largest wedge of
// a typical French portfolio render in the one colour the eye reads as "no
// data" - and the sector palette below matches `unclassified` to grey
// deliberately. Terracotta is a real earth tone, clear of crypto's amber and
// automobile's pink, and saturated enough to read as a choice, not an absence.
export const ALLOCATION_CATEGORY_COLORS: Record<string, string> = {
  cash: "#6366f1",
  savings: "#14b8a6",
  investments: "#22c55e",
  crypto: "#f59e0b",
  realEstate: "#a1665e",
  auto: "#ec4899",
};

// Full sector-exposure breakdown (v1.16, components/analytics/sector-exposure-section.tsx)
// - a different taxonomy from ALLOCATION_CATEGORY_COLORS above (GICS-style
// sectors, not asset-class buckets), shown on the same Analytics page, so
// kept as its own map rather than overloading the existing one with keys
// from two unrelated category systems. 13 colors (11 GICS sectors from
// lib/domain/sector-exposure.ts's SECTOR_KEYS, plus "crypto" and
// "unclassified") spread across the hue wheel to stay visually distinct -
// not individually contrast-measured the way the 6-color map above was
// after a real complaint, but deliberately avoiding both pure red (this
// app's own "negative amount" convention everywhere else) and clustering
// multiple entries in the same narrow hue band that caused that complaint
// in the first place. `crypto` deliberately reuses
// `ALLOCATION_CATEGORY_COLORS.crypto`'s exact amber - same "a category
// reads as the same color everywhere in the app" principle that map's own
// comment already states, not a coincidence - which is also *why*
// `consumer_cyclical` isn't amber too (a real, caught-before-shipping
// collision: both were originally #f59e0b) and sits in fuchsia instead, the
// largest open gap between industrials' purple and real_estate's pink.
// `unclassified` is a cool muted gray, matching `realEstate` above's
// precedent of a desaturated neutral for a "different kind of thing" bucket.
export const SECTOR_COLORS: Record<string, string> = {
  technology: "#6366f1",
  financial_services: "#0ea5e9",
  healthcare: "#22c55e",
  consumer_cyclical: "#d946ef",
  consumer_defensive: "#84cc16",
  industrials: "#a855f7",
  energy: "#fb923c",
  utilities: "#14b8a6",
  basic_materials: "#78716c",
  real_estate: "#ec4899",
  communication_services: "#06b6d4",
  crypto: "#f59e0b",
  unclassified: "#94a3b8",
};
