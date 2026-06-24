import { getRequestConfig } from "next-intl/server";
import { cookies, headers } from "next/headers";

const DEFAULT_LOCALE = process.env.DEFAULT_LOCALE ?? "fr";
const SUPPORTED = ["en", "fr"];

export default getRequestConfig(async () => {
  const cookieLocale = (await cookies()).get("NEXT_LOCALE")?.value ?? "";
  let locale: string;
  if (SUPPORTED.includes(cookieLocale)) {
    locale = cookieLocale;
  } else {
    const acceptLang = (await headers()).get("Accept-Language") ?? "";
    const browserLang = acceptLang.split(",")[0]?.split(";")[0]?.trim().slice(0, 2).toLowerCase() ?? "";
    locale = SUPPORTED.includes(browserLang) ? browserLang : DEFAULT_LOCALE;
  }

  let messages;
  try {
    messages = (await import(`../messages/${locale}.json`)).default;
  } catch {
    // Fallback to default locale if requested locale file is missing
    messages = (await import(`../messages/${DEFAULT_LOCALE}.json`)).default;
  }

  return { locale, messages };
});
