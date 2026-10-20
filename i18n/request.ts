import { getRequestConfig } from "next-intl/server";
import { cookies, headers } from "next/headers";
import { baseCurrency, currencySymbol } from "@/lib/utils/base-currency";
import { withCurrencySymbol } from "@/lib/domain/currency-labels";

const DEFAULT_LOCALE = process.env.DEFAULT_LOCALE ?? "fr";
const SUPPORTED = new Set(["en", "fr"]);

export default getRequestConfig(async () => {
  const cookieLocale = (await cookies()).get("NEXT_LOCALE")?.value ?? "";
  let locale: string;
  if (SUPPORTED.has(cookieLocale)) {
    locale = cookieLocale;
  } else {
    const acceptLang = (await headers()).get("Accept-Language") ?? "";
    const browserLang = acceptLang.split(",")[0]?.split(";")[0]?.trim().slice(0, 2).toLowerCase() ?? "";
    locale = SUPPORTED.has(browserLang) ? browserLang : DEFAULT_LOCALE;
  }

  let messages;
  try {
    messages = (await import(`../messages/${locale}.json`)).default;
  } catch {
    // Fallback to default locale if requested locale file is missing
    messages = (await import(`../messages/${DEFAULT_LOCALE}.json`)).default;
  }

  // Unit labels say "Montant (€)": on an instance kept in another base the
  // symbol is swapped once here, for every page and both locales (v2.19).
  return { locale, messages: withCurrencySymbol(messages, currencySymbol(baseCurrency())) };
});
