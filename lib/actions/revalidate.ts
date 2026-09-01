import { revalidatePath } from "next/cache";
import {
  accountSurfaces,
  categorySurfaces,
  holdingSurfaces,
  incomeSurfaces,
  saleSurfaces,
  transactionSurfaces,
} from "@/lib/domain/revalidation-surfaces";

/**
 * The thin half of the revalidation split: lib/domain/revalidation-surfaces.ts
 * decides which pages show a given entity (pure, testable), and this calls
 * revalidatePath over the result.
 *
 * Deliberately not a "use server" module. These are internal helpers for the
 * action files, not actions themselves - exporting them from a "use server"
 * module would publish a browser-invocable endpoint per helper for no reason.
 */

function revalidateAll(paths: string[]): void {
  for (const path of paths) revalidatePath(path);
}

export function revalidateAccount(accountId?: string | null): void {
  revalidateAll(accountSurfaces(accountId));
}

export function revalidateHolding(accountId?: string | null): void {
  revalidateAll(holdingSurfaces(accountId));
}

export function revalidateTransactions(
  accountId?: string | null,
  categoryIds: readonly (string | null | undefined)[] = [],
): void {
  revalidateAll(transactionSurfaces(accountId, categoryIds));
}

export function revalidateCategory(categoryId?: string | null): void {
  revalidateAll(categorySurfaces(categoryId));
}

export function revalidateIncome(accountId?: string | null): void {
  revalidateAll(incomeSurfaces(accountId));
}

export function revalidateSale(accountId?: string | null): void {
  revalidateAll(saleSurfaces(accountId));
}
