"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

const SUPPORTED = new Set(["en", "fr"]);

export async function setLocale(locale: string) {
  if (!SUPPORTED.has(locale)) return;
  (await cookies()).set("NEXT_LOCALE", locale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
  revalidatePath("/", "layout");
}
