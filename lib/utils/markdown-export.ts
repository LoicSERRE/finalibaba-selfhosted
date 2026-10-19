// Shared by components/export-accounts-button.tsx and
// components/export-analytics-button.tsx - both build a Markdown export and
// trigger a client-side download of it.

export function fmt(cents: number, decimals = 0): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals,
  }).format(cents / 100);
}

export function sign(n: number): string {
  return n >= 0 ? "+" : "";
}

function foldForMatch(text: string): string {
  return text.normalize("NFD").replaceAll(/\p{M}/gu, "").toLowerCase().trim();
}

/**
 * Whether `qualifier` already reads as a whole word in `name`, ignoring case
 * and accents. Both exports decorate an account name with its type/subtype,
 * and the Trade Republic sync names its accounts after exactly those
 * ("PEA", "CTO", "Crypto") - which printed "PEA (PEA)" and "PEA - PEA".
 */
export function nameMentions(name: string, qualifier: string): boolean {
  const q = foldForMatch(qualifier);
  if (q === "") return false;
  const escaped = q.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
  return new RegExp(String.raw`(?:^|[^\p{L}\p{N}])${escaped}(?:$|[^\p{L}\p{N}])`, "u").test(foldForMatch(name));
}

export function downloadFile(content: string, suffix: string) {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `finalibaba-${suffix}-${new Date().toISOString().slice(0, 10)}.md`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
