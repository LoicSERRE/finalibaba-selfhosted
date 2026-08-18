"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { parseCents } from "@/lib/utils/format";
import { CategoryKind } from "@/app/generated/prisma/enums";

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function parseOptionalCents(val: FormDataEntryValue | null): bigint | undefined {
  if (!val || (val as string).trim() === "") return undefined;
  const cents = parseCents(val as string);
  return cents > BigInt(0) ? cents : undefined;
}

// Defaults to EXPENSE for any caller that doesn't send a "kind" field at
// all - keeps every pre-existing call site (and any future one that
// doesn't care) working unchanged.
function parseKind(formData: FormData): CategoryKind {
  return formData.get("kind") === "INCOME" ? "INCOME" : "EXPENSE";
}

function revalidateAll() {
  revalidatePath("/budgets");
  revalidatePath("/accounts");
  revalidatePath("/income");
}

export async function createCategory(formData: FormData) {
  const name = (formData.get("name") as string).trim();
  if (!name) throw new Error("Name required");

  const color = (formData.get("color") as string | null)?.trim() ?? "";
  if (!HEX_COLOR_RE.test(color)) throw new Error("Invalid color");

  const kind = parseKind(formData);
  // A budget cap has no meaning for an income category - never stored for
  // one, regardless of what the form happened to submit (the dialog hides
  // the field for INCOME, but a Server Action is reachable directly
  // regardless of what's rendered).
  const budgetCents = kind === "INCOME" ? undefined : parseOptionalCents(formData.get("budget"));

  await prisma.category.create({
    data: { name, color, kind, budgetCents },
  });
  revalidateAll();
}

export async function updateCategory(id: string, formData: FormData) {
  const name = (formData.get("name") as string).trim();
  if (!name) throw new Error("Name required");

  const color = (formData.get("color") as string | null)?.trim() ?? "";
  if (!HEX_COLOR_RE.test(color)) throw new Error("Invalid color");

  const kind = parseKind(formData);
  const budgetCents = kind === "INCOME" ? undefined : parseOptionalCents(formData.get("budget"));

  await prisma.category.update({
    where: { id },
    data: { name, color, kind, budgetCents: budgetCents ?? null },
  });
  revalidateAll();
}

export async function deleteCategory(id: string) {
  await prisma.category.delete({ where: { id } });
  revalidateAll();
}
