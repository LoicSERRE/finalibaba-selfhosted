"use client";

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { useTranslations, useLocale } from "next-intl";

type DataPoint = {
  date: string; // pre-formatted, day+month only (no year) - display only, see isoDate below
  isoDate: string; // ISO 8601 "YYYY-MM-DD" - see the XAxis dataKey comment for why this is used instead of `date`
  netWorth: number; // in cents
};

function formatCurrency(cents: number) {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

export function NetWorthChart({ data }: Readonly<{ data: DataPoint[] }>) {
  const t = useTranslations("netWorthChart");
  const locale = useLocale();
  const shortDateFormat = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" });
  // isoDate -> "date" is a one-line reformat, cheap enough to do inline in
  // the two formatters below without needing a lookup map. Recharts' own
  // labelFormatter type is (label: ReactNode) => ReactNode - wider than
  // this component ever actually receives (always the isoDate string, for
  // a category axis) - narrowed to a plain string here since that's the
  // only case that ever really happens, with a fallback for the type's
  // own sake.
  function formatShortDate(isoDate: React.ReactNode): string {
    if (typeof isoDate !== "string") return String(isoDate);
    return shortDateFormat.format(new Date(`${isoDate}T00:00:00`));
  }

  if (!data.length) {
    return (
      <div className="h-64 flex items-center justify-center text-[var(--muted)] text-sm">
        {t("noHistory")}
      </div>
    );
  }

  return (
    <div role="img" aria-label={t("ariaLabel")}>
    <ResponsiveContainer width="100%" height={260}>
      {/* accessibilityLayer defaults to true in Recharts 3, which gives the
          root <svg> tabIndex={0} - on a mobile tap that leaves the browser's
          native focus ring visibly stuck on the chart (no CSS anywhere in
          this app resets it), showing as a white halo that looks backwards
          in both themes since it's an unthemed UA default, not app styling.
          role="img" above already covers this chart's accessible name, so
          the SVG doesn't need to be independently focusable/tabbable. */}
      {/* right: 16, not 0 - reproduced live (mouse hover at the exact pixel
          of each XAxis tick label, comparing to the tooltip's own date):
          with a 0 right margin, the last data point sits exactly on the
          plot area's right edge, so Recharts nudges its tick LABEL inward
          to keep the text from clipping past the SVG boundary - but that
          nudge is purely cosmetic, the hover/tooltip index resolution
          still uses the true (un-nudged) position. Result: hovering
          exactly where the last label reads "1 août" showed a tooltip for
          "1 mai" instead - confirmed to disappear once the last point has
          real breathing room and no longer needs nudging. Same fix applied
          to every other date-axis AreaChart in this app (projection-chart,
          cashflow-chart, balance-history-chart). */}
      <AreaChart data={data} margin={{ top: 4, right: 16, left: 8, bottom: 0 }} accessibilityLayer={false}>
        <defs>
          <linearGradient id="netWorthGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.25} />
            <stop offset="95%" stopColor="var(--accent)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="var(--border)"
          vertical={false}
        />
        {/* dataKey="isoDate" (unique per point), not "date" (the pre-
            formatted day+month display string, which omits the year and
            so repeats every 12 months) - real, precisely reproduced bug:
            with a duplicated category axis, Recharts' hover/active-index
            resolution breaks once the mouse passes the point where values
            start repeating (confirmed live via a scripted sweep - correct
            for the first ~half of this 24-month chart, then every hover
            past that point resolved to a position exactly one full
            "cycle" length short of the real cursor position, a constant
            offset matching exactly half the plot width/point count).
            isoDate is always unique, so Recharts has no duplicate values
            to get confused by. tickFormatter/labelFormatter below reformat
            it back to the short display string for what's actually shown. */}
        <XAxis
          dataKey="isoDate"
          tickFormatter={formatShortDate}
          tick={{ fill: "var(--muted)", fontSize: 12 }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tickFormatter={(v) => formatCurrency(v)}
          tick={{ fill: "var(--muted)", fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          width={78}
        />
        <Tooltip
          contentStyle={{
            background: "var(--surface-elevated)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            color: "var(--foreground)",
            fontSize: 13,
          }}
          labelFormatter={formatShortDate}
          formatter={(value) =>
            value != null
              ? [formatCurrency(Number(value)), t("seriesLabel")]
              : ["-", t("seriesLabel")]
          }
        />
        <Area
          type="monotone"
          dataKey="netWorth"
          stroke="var(--accent)"
          strokeWidth={2}
          fill="url(#netWorthGradient)"
          dot={false}
          activeDot={{ r: 4, fill: "var(--accent)" }}
          // Kept off defensively so a background re-render (e.g. this
          // app's AutoSync component firing router.refresh() after its
          // sync-poll cycle) can never restart a line-draw animation mid-
          // hover - but this was NOT the actual cause of the reported
          // "active point drifts away from the cursor" bug (confirmed:
          // disabling this alone didn't fix it). The real cause and fix
          // are the isoDate dataKey on XAxis above - a Recharts bug
          // specific to a category axis with duplicate values.
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
    </div>
  );
}
