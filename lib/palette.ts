// Shared categorical color palettes. Kept as literal hex — these feed a DB
// column (Category.color) and inline `style` props for SVG/chart elements
// that can't resolve CSS custom properties — so they can't just reference
// the var(--token) system. Centralized here instead of each consumer
// independently re-typing (and risking drift on) the same handful of hues.

// User-facing category color picker (components/add-category-dialog.tsx).
export const CATEGORY_SWATCHES = [
  "#6366f1", "#22c55e", "#ef4444", "#f59e0b", "#3b82f6",
  "#ec4899", "#14b8a6", "#a855f7", "#84cc16", "#64748b",
] as const;

// Asset-allocation chart series (components/asset-allocation-chart.tsx).
// Deliberately excludes red — this app uses red exclusively for
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
