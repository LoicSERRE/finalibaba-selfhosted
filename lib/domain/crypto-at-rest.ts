import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";

/**
 * Encryption at rest for the columns that hold somebody else's credentials.
 *
 * **What this protects against, stated precisely, because the gap between what
 * encryption sounds like and what it does is where people get hurt.** It
 * protects a backup file that leaks, a dump shared by mistake, a stolen disk,
 * and anyone who reaches the database without also holding the server's
 * environment. It does NOT protect against whoever runs the instance: the sync
 * sidecar logs into a real bank at 3am with nobody present, so the server must
 * be able to decrypt unattended, and anything the server can do the person
 * holding the server can do. That is arithmetic, not a missing feature. The
 * only design that would change it - a key only the user holds - ends
 * unattended sync, which is the product.
 *
 * Why it exists anyway: before this, `SELECT "woobLogin", "woobPassword" FROM
 * "Institution"` returned every invited user's bank credentials in clear text.
 * The post-v2.0 security audit DID list the plaintext inventory (finding 3)
 * and accepted it against a threat model written when the app was single-user,
 * where "the host owner can read everything" meant "you can read your own
 * data". Multi-user changed what that sentence means and the sentence was
 * carried forward rather than re-derived. `Institution.trPin` was not even in
 * that inventory: v2.1 added it afterwards and nothing re-ran the list.
 *
 * `sync/crypto_at_rest.py` is the Python mirror. The two must agree on the
 * format exactly, so the wire format is pinned by tests on both sides.
 */

/** AES-256-GCM. 12 bytes is the IV size GCM is defined for. */
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const KEY_BYTES = 32;
const TAG_BYTES = 16;

/**
 * Marks a value as encrypted, and carries the format version.
 *
 * Load-bearing rather than decorative: a read that finds no prefix returns the
 * value untouched, which is what lets an existing instance keep working while
 * the migration runs and what makes re-running the migration a no-op. Bump the
 * version rather than changing v1's meaning - a value written by an older
 * release must stay readable.
 */
export const ENCRYPTED_PREFIX = "enc:v1:";

/**
 * The key, from `ENCRYPTION_KEY` when set, otherwise derived from
 * `NEXTAUTH_SECRET`.
 *
 * The fallback is what keeps this from becoming a new mandatory variable that
 * breaks every existing instance on upgrade and adds a step to a project whose
 * whole promise is `docker compose up`. `NEXTAUTH_SECRET` is already required
 * and already maximally sensitive, so deriving from it adds no new secret to
 * protect. HKDF rather than using it raw, so the encryption key is not the
 * same bytes as the session-signing key: a leak of one must not hand over the
 * other.
 *
 * **The cost of the fallback, which the README has to state**: rotating
 * `NEXTAUTH_SECRET` then makes every stored credential unreadable. Setting a
 * dedicated `ENCRYPTION_KEY` decouples the two, which is why `.env.example`
 * shows how to generate one.
 */
function resolveKey(): Buffer {
  const explicit = process.env.ENCRYPTION_KEY;
  if (explicit) {
    const key = Buffer.from(explicit, "base64");
    if (key.length !== KEY_BYTES) {
      throw new Error(
        `ENCRYPTION_KEY must be ${KEY_BYTES} base64-encoded bytes, got ${key.length}. ` +
          `Generate one with: openssl rand -base64 32`
      );
    }
    return key;
  }

  const fallback = process.env.NEXTAUTH_SECRET;
  if (!fallback) {
    throw new Error(
      "Cannot encrypt at rest: set ENCRYPTION_KEY (openssl rand -base64 32) or NEXTAUTH_SECRET."
    );
  }
  // Fixed salt and info: the derivation must be reproducible across restarts
  // and across the two languages, so neither may be random.
  return Buffer.from(
    hkdfSync("sha256", Buffer.from(fallback, "utf8"), Buffer.from("finalibaba-at-rest"), Buffer.from("encryption-key-v1"), KEY_BYTES)
  );
}

/** True for a value this module wrote, false for anything still in clear. */
export function isEncrypted(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(ENCRYPTED_PREFIX);
}

/**
 * Encrypts a value for storage. Returns null for null, so a caller can pass a
 * nullable column straight through without branching.
 *
 * Already-encrypted input is returned unchanged rather than double-wrapped,
 * which is what makes the migration safe to re-run and safe to interrupt.
 */
export function encryptSecret(plain: string | null | undefined): string | null {
  if (plain === null || plain === undefined || plain === "") return null;
  if (isEncrypted(plain)) return plain;

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, resolveKey(), iv, { authTagLength: TAG_BYTES });
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENCRYPTED_PREFIX}${iv.toString("base64")}:${Buffer.concat([ciphertext, tag]).toString("base64")}`;
}

/**
 * Reads a value back.
 *
 * A value with no prefix is returned as-is: that is a row the migration has
 * not reached yet, not an error, and treating it as one would take a working
 * instance down mid-migration.
 *
 * A value that IS prefixed but fails to decrypt throws, and deliberately so.
 * That means the key changed (a rotated `NEXTAUTH_SECRET`, most likely) and
 * the honest outcome is a loud failure naming the cause, not a silent null
 * that would read downstream as "this user configured no bank password" and
 * quietly stop syncing.
 */
export function decryptSecret(stored: string | null | undefined): string | null {
  if (stored === null || stored === undefined || stored === "") return null;
  if (!isEncrypted(stored)) return stored;

  const body = stored.slice(ENCRYPTED_PREFIX.length);
  const separator = body.indexOf(":");
  if (separator === -1) throw new Error("Malformed encrypted value: no IV separator.");

  const iv = Buffer.from(body.slice(0, separator), "base64");
  const payload = Buffer.from(body.slice(separator + 1), "base64");
  if (iv.length !== IV_BYTES || payload.length < TAG_BYTES) {
    throw new Error("Malformed encrypted value: wrong IV or payload length.");
  }

  const ciphertext = payload.subarray(0, payload.length - TAG_BYTES);
  const tag = payload.subarray(payload.length - TAG_BYTES);
  // authTagLength is pinned rather than left to Node's default: without it a
  // TRUNCATED tag is accepted, and a shorter tag is a weaker forgery barrier.
  // semgrep's gcm-no-tag-length flagged the first version of this file, and
  // correctly - the payload length check below bounds the slice but never
  // tells the cipher what to require.
  const decipher = createDecipheriv(ALGORITHM, resolveKey(), iv, { authTagLength: TAG_BYTES });
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new Error(
      "Could not decrypt a stored credential. This usually means ENCRYPTION_KEY (or the " +
        "NEXTAUTH_SECRET it is derived from) changed since the value was written."
    );
  }
}

/**
 * The lookup digest for a token that is stored encrypted.
 *
 * Share links, API keys and invitations are all found BY their token, and a
 * random IV means the same token never encrypts to the same bytes twice - so
 * the ciphertext cannot be matched in a WHERE clause. This digest can.
 *
 * A plain SHA-256, and the reasoning matters because the instinct is bcrypt:
 * these are 256 random bits from `randomBytes(32)`, not a human-chosen
 * password. There is no dictionary to slow anyone down against, and a
 * per-row salt would defeat the single-query lookup this exists for. Keyed
 * with nothing for the same reason a salt is absent - the digest's job is
 * equality, and the secrecy comes from the token's own entropy.
 */
export function tokenLookupHash(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
