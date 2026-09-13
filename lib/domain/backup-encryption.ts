import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * Optional passphrase encryption for the backup FILE.
 *
 * **Why the file and not more columns.** The database already encrypts the
 * credentials, and the financial data cannot be encrypted at rest without
 * ending every SQL sum and group-by the app is built on (see
 * lib/domain/crypto-at-rest.ts). But a backup has a different threat model
 * entirely: it leaves the machine. It lands in a Downloads folder, a cloud
 * sync, an email to yourself - which for a home instance is far and away the
 * most likely way data ever escapes. Encrypting the file covers everything the
 * columns cannot, including balances and transaction labels, and costs no
 * query anything.
 *
 * **Opt-in, with a passphrase the user chooses.** Not the instance's
 * ENCRYPTION_KEY, deliberately: a backup exists to survive a disaster, and
 * disasters take `.env` with them. A backup only the dead server could read is
 * not a backup. The cost is stated plainly in the UI - forget the passphrase
 * and the file is lost, with nobody able to help.
 *
 * scrypt rather than a bare hash, because unlike every other secret in this
 * app this one IS human-chosen and therefore guessable: the work factor is
 * what stands between a leaked file and an offline dictionary run.
 */

/** Identifies our own format before anything tries to gunzip it. */
export const BACKUP_MAGIC = Buffer.from("FNLBENC1");
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

/** scrypt cost. ~100ms per derivation, paid once per backup, not per request. */
const SCRYPT_COST = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export const HEADER_BYTES = BACKUP_MAGIC.length + SALT_BYTES + IV_BYTES;

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase.normalize("NFKC"), salt, KEY_BYTES, SCRYPT_COST);
}

/** True for a file this module produced. */
export function isEncryptedBackup(buffer: Buffer): boolean {
  return (
    buffer.length >= HEADER_BYTES + TAG_BYTES &&
    timingSafeEqual(buffer.subarray(0, BACKUP_MAGIC.length), BACKUP_MAGIC)
  );
}

/**
 * The header, and a cipher to pipe the dump through.
 *
 * Returned as parts rather than encrypting a whole buffer so the download can
 * stay streaming: a real instance's dump is bigger than anything worth holding
 * in memory twice.
 */
export function createBackupCipher(passphrase: string) {
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(passphrase, salt), iv, {
    authTagLength: TAG_BYTES,
  });
  return { header: Buffer.concat([BACKUP_MAGIC, salt, iv]), cipher };
}

/**
 * Decrypts a whole uploaded file.
 *
 * Buffered rather than streamed on purpose: GCM only authenticates once the
 * tag is reached, so streaming a restore would mean feeding psql bytes that
 * have not been verified yet - and a restore drops the database first.
 *
 * Returns null for a wrong passphrase or a tampered file. The caller turns
 * that into one message: distinguishing "wrong passphrase" from "corrupt file"
 * tells whoever is holding a stolen backup which of the two they have.
 */
export function decryptBackup(buffer: Buffer, passphrase: string): Buffer<ArrayBuffer> | null {
  if (!isEncryptedBackup(buffer)) return null;

  const salt = buffer.subarray(BACKUP_MAGIC.length, BACKUP_MAGIC.length + SALT_BYTES);
  const iv = buffer.subarray(BACKUP_MAGIC.length + SALT_BYTES, HEADER_BYTES);
  const body = buffer.subarray(HEADER_BYTES);
  const ciphertext = body.subarray(0, body.length - TAG_BYTES);
  const tag = body.subarray(body.length - TAG_BYTES);

  try {
    const decipher = createDecipheriv("aes-256-gcm", deriveKey(passphrase, salt), iv, {
      authTagLength: TAG_BYTES,
    });
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    return null;
  }
}
