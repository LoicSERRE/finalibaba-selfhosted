"use server";

import { revalidateCategory } from "@/lib/actions/revalidate";
import { prisma } from "@/lib/db/prisma";
import { getViewer, assertOwned } from "@/lib/auth-context";
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

// Rollover has no meaning for an INCOME category (no budgetCents concept
// either) - forced off regardless of what the form submitted, same
// server-side-enforced reasoning as budgetCents itself above.
function parseRolloverEnabled(formData: FormData, kind: CategoryKind): boolean {
  return kind === "EXPENSE" && formData.get("rolloverEnabled") === "on";
}

function revalidateAll(categoryId?: string | null) {
  revalidateCategory(categoryId);
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
  const rolloverEnabled = parseRolloverEnabled(formData, kind);

  const viewer = await getViewer();
  await prisma.category.create({
    data: {
      userId: viewer.id,
      name,
      color,
      kind,
      budgetCents,
      budgetRolloverEnabled: rolloverEnabled,
      budgetRolloverEnabledAt: rolloverEnabled ? new Date() : null,
    },
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
  const rolloverEnabled = parseRolloverEnabled(formData, kind);

  // The anchor only moves on the off->on transition - re-saving the form
  // while already enabled must not reset an accumulated carry back to
  // zero. `undefined` in the update payload below means "leave this field
  // untouched", same convention Prisma uses everywhere else in this file.
  const viewer = await getViewer();
  await assertOwned("category", id, viewer.id);
  const existing = await prisma.category.findUniqueOrThrow({ where: { id }, select: { budgetRolloverEnabled: true } });
  let budgetRolloverEnabledAt: Date | null | undefined;
  if (!rolloverEnabled) {
    budgetRolloverEnabledAt = null;
  } else if (existing.budgetRolloverEnabled) {
    budgetRolloverEnabledAt = undefined;
  } else {
    budgetRolloverEnabledAt = new Date();
  }

  await prisma.category.update({
    where: { id },
    data: { name, color, kind, budgetCents: budgetCents ?? null, budgetRolloverEnabled: rolloverEnabled, budgetRolloverEnabledAt },
  });
  revalidateAll();
}

export async function deleteCategory(id: string) {
  const viewer = await getViewer();
  await assertOwned("category", id, viewer.id);
  await prisma.category.delete({ where: { id } });
  revalidateAll();
}
