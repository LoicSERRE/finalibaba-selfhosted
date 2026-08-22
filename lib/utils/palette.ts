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

// Net-worth allocation-by-category color coding - one fixed hue per asset
// category, shared by the dashboard pie chart (app/page.tsx), the analytics
// pie chart (lib/analytics.ts), and the analytics "safe vs risky" radar bar
// (components/analytics/allocation-radar-section.tsx) so the same category
// always reads as the same color everywhere in the app, not three
// independently-typed copies that could silently drift apart.
//
// UI/UX audit finding: `savings` and `cash` used to be #8b5cf6/#6366f1
// (19° apart in hue - indigo and violet), and `realEstate` used #3b82f6
// (also blue-family, 22° from cash) - three of the six categories
// clustered in the same narrow blue-purple band, nearly indistinguishable
// as small legend dots/pie slices (confirmed visually, not just by hue
// math, in a real rendered screenshot). `savings` moved to teal (67° from
// cash) and `realEstate` to a warm neutral gray - a genuinely distinct
// family from every other saturated hue here, sidestepping any further
// close-hue risk rather than hunting for one more "far enough" color.
export const ALLOCATION_CATEGORY_COLORS: Record<string, string> = {
  cash: "#6366f1",
  savings: "#14b8a6",
  investments: "#22c55e",
  crypto: "#f59e0b",
  realEstate: "#78716c",
  auto: "#ec4899",
};
