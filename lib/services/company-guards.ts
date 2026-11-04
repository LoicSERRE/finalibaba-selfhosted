import { prisma } from "@/lib/db/prisma";
import { assertCompanyManager } from "@/lib/auth-context";
import { assertOptionalId } from "@/lib/domain/action-input";

/**
 * Which company a new account belongs to, enforcing the invariant that an
 * account and its institution agree (dev-docs/companies.md): under a
 * company's bank connection it is that company's; without an institution it
 * is the company the manager asked for, or nobody's. A plain module, not a
 * "use server" one: it takes a userId.
 */
export async function companyForNewAccount(
  userId: string,
  institutionId: string | undefined,
  requestedCompanyId: unknown,
): Promise<string | null> {
  const requested = assertOptionalId(requestedCompanyId) ?? null;
  const institution = institutionId
    ? await prisma.institution.findUnique({ where: { id: institutionId }, select: { companyId: true } })
    : null;
  const companyId = institution?.companyId ?? requested;
  if (requested && institution && institution.companyId !== requested) throw new Error("Not found.");
  if (companyId) await assertCompanyManager(userId, companyId);
  return companyId;
}
