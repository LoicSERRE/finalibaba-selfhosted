import { formatCurrency } from "@/lib/utils/format";
import type { TopAssetRow } from "@/lib/domain/analytics";
import type { getTranslations } from "next-intl/server";

type T = Awaited<ReturnType<typeof getTranslations>>;

export function TopAssetsSection({
  t,
  ta,
  topAssets,
}: Readonly<{
  t: T;
  ta: T;
  topAssets: TopAssetRow[];
}>) {
  if (topAssets.length === 0) return null;

  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
      <div className="px-6 py-4 border-b border-[var(--border)]">
        <h2 className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
          {t("assets.title")}
        </h2>
      </div>
      <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--border)]">
            <th scope="col" className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wider whitespace-nowrap">{t("assets.colAsset")}</th>
            <th scope="col" className="hidden sm:table-cell px-6 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wider whitespace-nowrap">{t("assets.colCategory")}</th>
            <th scope="col" className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wider whitespace-nowrap">{t("assets.colValue")}</th>
            <th scope="col" className="hidden sm:table-cell px-6 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wider whitespace-nowrap">{t("assets.colGain")}</th>
            <th scope="col" className="hidden sm:table-cell px-6 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wider whitespace-nowrap">{t("assets.colTax")}</th>
            <th scope="col" className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wider whitespace-nowrap">{t("assets.colPct")}</th>
          </tr>
        </thead>
        <tbody>
          {topAssets.map((asset, i) => (
            <tr
              key={asset.id}
              className={`${
                i < topAssets.length - 1 ? "border-b border-[var(--border)]" : ""
              } hover:bg-[var(--surface-elevated)] transition-colors`}
            >
              <td className="px-4 sm:px-6 py-3">
                <p className="font-medium text-[var(--foreground)]">{asset.name}</p>
                <p className="text-xs text-[var(--muted)] sm:hidden">
                  {ta(asset.type as Parameters<typeof ta>[0])}
                  {asset.subtype && ` · ${asset.subtype}`}
                </p>
                <p className="hidden sm:block text-xs text-[var(--muted)]">{asset.institution}</p>
              </td>
              <td className="hidden sm:table-cell px-6 py-3 text-[var(--muted)]">
                {ta(asset.type as Parameters<typeof ta>[0])}
                {asset.subtype && <span className="ml-1 text-xs">· {asset.subtype}</span>}
              </td>
              <td className="px-4 sm:px-6 py-3 tabular-nums font-medium text-[var(--foreground)]">
                {formatCurrency(asset.value, 0)}
              </td>
              <td className="hidden sm:table-cell px-6 py-3 tabular-nums">
                {asset.gain === null ? (
                  <span className="text-[var(--muted)] text-xs">-</span>
                ) : (
                  <span className={asset.gain >= BigInt(0) ? "text-[var(--positive)]" : "text-[var(--negative)]"}>
                    {asset.gain >= BigInt(0) ? "+" : ""}{formatCurrency(asset.gain, 0)}
                  </span>
                )}
              </td>
              <td className="hidden sm:table-cell px-6 py-3 tabular-nums">
                {asset.tax === null ? (
                  <span className="text-[var(--muted)] text-xs">-</span>
                ) : asset.tax === BigInt(0) ? (
                  <span className="text-[var(--muted)] text-xs">0 €</span>
                ) : (
                  <span className="text-[var(--negative)]">-{formatCurrency(asset.tax, 0)}</span>
                )}
              </td>
              <td className="px-4 sm:px-6 py-3">
                <div className="flex items-center gap-2">
                  <div className="w-10 sm:w-16 h-1.5 bg-[var(--surface-elevated)] rounded-full overflow-hidden" aria-hidden="true">
                    <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${asset.pct}%` }} />
                  </div>
                  <span className="text-xs text-[var(--muted)] tabular-nums">{asset.pct}%</span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}
