"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

const SUPPORTED = new Set(["dark", "light"]);

export async function setTheme(theme: string) {
  if (!SUPPORTED.has(theme)) return;
  (await cookies()).set("THEME", theme, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
  revalidatePath("/", "layout");
}
