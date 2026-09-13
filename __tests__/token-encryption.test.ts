import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, isEncrypted, tokenLookupHash } from "@/lib/domain/crypto-at-rest";
import { generateShareToken } from "@/lib/domain/share-links";
import { generateApiKeyToken } from "@/lib/domain/api-keys";

/**
 * Share links, API keys and invitations are bearer credentials: whoever holds
 * the string gets in, from anywhere, without the database. That is what makes
 * them worth encrypting even though a dump reader can already see the
 * financial data they unlock - a token in a leaked backup keeps working from
 * the outside long after the dump is closed.
 *
 * Encrypting them costs a lookup, which is the whole subtlety: they are found
 * BY value, and AES-GCM's random IV means the stored bytes differ every time.
 * `tokenHash` is what the WHERE clause matches. These tests pin the two halves
 * that must stay true together - the digest finds the row, and the ciphertext
 * still yields the original for the UI to show again.
 */

describe("a token can still be found after being encrypted", () => {
  it("the digest is stable while the ciphertext is not", () => {
    const token = generateShareToken();
    const first = encryptSecret(token);
    const second = encryptSecret(token);

    // Two encryptions of the same token differ, which is exactly why the
    // lookup cannot use them.
    expect(first).not.toBe(second);
    // The digest does not, which is exactly why it can.
    expect(tokenLookupHash(token)).toBe(tokenLookupHash(token));
    expect(decryptSecret(first)).toBe(token);
    expect(decryptSecret(second)).toBe(token);
  });

  it("different tokens never collide on their digest", () => {
    const digests = new Set(Array.from({ length: 200 }, () => tokenLookupHash(generateShareToken())));
    expect(digests.size).toBe(200);
  });

  it("the digest reveals nothing that looks like the token", () => {
    const token = generateApiKeyToken();
    expect(tokenLookupHash(token)).not.toContain(token);
    // fnlb_ is a cosmetic prefix on API keys; even that must not survive into
    // the digest, or a dump would tell you which rows are API keys.
    expect(tokenLookupHash(token)).not.toContain("fnlb_");
    expect(tokenLookupHash(token)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("the round trip the UI depends on", () => {
  it("a share link and an API key both come back copyable", () => {
    // Both stay re-copyable in Settings rather than shown once, which is the
    // documented behaviour - so encryption must be reversible here, unlike
    // the password hashing next to it.
    for (const token of [generateShareToken(), generateApiKeyToken()]) {
      const stored = encryptSecret(token)!;
      expect(isEncrypted(stored)).toBe(true);
      expect(stored).not.toContain(token);
      expect(decryptSecret(stored)).toBe(token);
    }
  });

  it("a stored token is useless to someone reading the database", () => {
    const token = generateApiKeyToken();
    const stored = encryptSecret(token)!;
    // What a dump reader gets: the ciphertext and the digest. Neither is a
    // bearer credential - presenting either to the API would hash to
    // something else entirely and match no row.
    expect(tokenLookupHash(stored)).not.toBe(tokenLookupHash(token));
    expect(tokenLookupHash(tokenLookupHash(token))).not.toBe(tokenLookupHash(token));
  });
});
