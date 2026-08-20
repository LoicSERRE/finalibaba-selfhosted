import { randomBytes } from "node:crypto";
import type Decimal from "decimal.js";
import { holdingMarketValue } from "@/lib/domain/analytics";

// 256 bits - unlike AUTH_PASSWORD, this is never human-typed, so there's
// nothing to brute-force-guard with a rate limiter the way lib/auth.ts does
// for login attempts. Unguessability comes entirely from entropy.
export function generateShareToken(): string {
  return randomBytes(32).toString("base64url");
}

export function isShareLinkExpired(expiresAt: Date | null, now: Date = new Date()): boolean {
  return expiresAt !== null && expiresAt.getTime() <= now.getTime();
}

export interface SharedHolding {
  id: string;
  ticker: string;
  quantity: string;
  valueCents: bigint;
}

export interface SharedHoldingAccountGroup {
  accountId: string;
  accountName: string;
  totalCents: bigint;
  holdings: SharedHolding[];
}

interface SharedHoldingsAccountInput {
  id: string;
  name: string;
  type: string;
  holdings: { id: string; ticker: string; quantity: Decimal; lastPriceCents: bigint }[];
}

// Scoped to the "Read-only share links" feature (see CLAUDE.md) - only
// INVESTMENT/CRYPTO accounts carry holdings at all, and only ones that
// actually have at least one are worth a section. Deliberately omits cost
// basis/gain (unlike the account detail page's own holdings table) - a
// share link is opt-in-per-field (ShareLink.includeHoldings) precisely
// because it may be reachable from the public internet, and current value
// alone is already implied by the per-account total shown elsewhere on this
// same page; entry price/unrealized gain is a step further into someone
// else's financial detail that wasn't asked for.
export function buildSharedHoldings(accounts: SharedHoldingsAccountInput[]): SharedHoldingAccountGroup[] {
  return accounts
    .filter((a) => (a.type === "INVESTMENT" || a.type === "CRYPTO") && a.holdings.length > 0)
    .map((a) => {
      const holdings = a.holdings
        .map((h) => ({ id: h.id, ticker: h.ticker, quantity: h.quantity.toString(), valueCents: holdingMarketValue(h) }))
        .sort((x, y) => {
          if (y.valueCents > x.valueCents) return 1;
          if (y.valueCents < x.valueCents) return -1;
          return 0;
        });
      return {
        accountId: a.id,
        accountName: a.name,
        totalCents: holdings.reduce((sum, h) => sum + h.valueCents, BigInt(0)),
        holdings,
      };
    })
    .sort((x, y) => x.accountName.localeCompare(y.accountName));
}
