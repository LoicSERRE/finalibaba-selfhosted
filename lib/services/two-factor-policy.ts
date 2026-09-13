import { prisma } from "@/lib/db/prisma";
import { revalidatePath } from "next/cache";

/**
 * The instance-wide "everyone must use 2FA" switch.
 *
 * Instance-level rather than per-user for the obvious reason: a policy each
 * person opts into individually is not a policy. Off by default, so upgrading
 * never locks an existing instance's users out of their own data.
 *
 * A plain module rather than a Server Action file: `app/layout.tsx` reads it
 * on every render to decide whether to show the setup gate, and a page reading
 * a `"use server"` export is how a helper ends up remotely invocable for no
 * reason.
 */
export async function requiresTwoFactor(): Promise<boolean> {
  const row = await prisma.instanceSettings.findUnique({
    where: { id: "singleton" },
    select: { requireTwoFactor: true },
  });
  return row?.requireTwoFactor ?? false;
}

export async function updateInstanceTwoFactorPolicy(enabled: boolean): Promise<void> {
  await prisma.instanceSettings.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", requireTwoFactor: enabled },
    update: { requireTwoFactor: enabled },
  });
  revalidatePath("/settings");
}
