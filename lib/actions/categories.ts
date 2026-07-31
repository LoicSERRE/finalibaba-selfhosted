"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { parseCents } from "@/lib/utils/format";

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function parseOptionalCents(val: FormDataEntryValue | null): bigint | undefined {
  if (!val || (val as string).trim() === "") return undefined;
  const cents = parseCents(val as string);
  return cents > BigInt(0) ? cents : undefined;
}

function revalidateAll() {
  revalidatePath("/budgets");
  revalidatePath("/accounts");
}

export async function createCategory(formData: FormData) {
  const name = (formData.get("name") as string).trim();
  if (!name) throw new Error("Name required");

  const color = (formData.get("color") as string | null)?.trim() ?? "";
  if (!HEX_COLOR_RE.test(color)) throw new Error("Invalid color");

  const budgetCents = parseOptionalCents(formData.get("budget"));

  await prisma.category.create({
    data: { name, color, budgetCents },
  });
  revalidateAll();
}

export async function updateCategory(id: string, formData: FormData) {
  const name = (formData.get("name") as string).trim();
  if (!name) throw new Error("Name required");

  const color = (formData.get("color") as string | null)?.trim() ?? "";
  if (!HEX_COLOR_RE.test(color)) throw new Error("Invalid color");

  const budgetCents = parseOptionalCents(formData.get("budget"));

  await prisma.category.update({
    where: { id },
    data: { name, color, budgetCents: budgetCents ?? null },
  });
  revalidateAll();
}

export async function deleteCategory(id: string) {
  await prisma.category.delete({ where: { id } });
  revalidateAll();
}
