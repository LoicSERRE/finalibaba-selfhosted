import { describe, expect, it } from "vitest";
import { gzipSync } from "node:zlib";
import {
  BACKUP_MAGIC,
  createBackupCipher,
  decryptBackup,
  isEncryptedBackup,
} from "@/lib/domain/backup-encryption";

/**
 * A backup is the one artefact that leaves the machine, so these pin the two
 * halves that have to hold together: a stolen file yields nothing, and the
 * person who made it can still get their data back. Getting only the first
 * right is not a backup.
 */

function encrypt(plaintext: Buffer, passphrase: string): Buffer {
  const { header, cipher } = createBackupCipher(passphrase);
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([header, body, cipher.getAuthTag()]);
}

const DUMP = gzipSync(
  Buffer.from(
    "COPY \"Account\" (id, name) FROM stdin;\nacc-1\tCOMPTE COURANT DE LOIC\n" +
      "COPY \"Transaction\" (label, amountCents) FROM stdin;\nCOURSES CARREFOUR\t-4250\n"
  )
);

describe("what a stolen backup file yields", () => {
  it("none of the plaintext, not even the gzip header", () => {
    const encrypted = encrypt(DUMP, "correct horse battery staple");
    // The real leak path for a home instance: this file in a Downloads folder,
    // a cloud sync, a mail to yourself.
    expect(encrypted.includes(Buffer.from("COMPTE COURANT DE LOIC"))).toBe(false);
    expect(encrypted.includes(Buffer.from("COURSES CARREFOUR"))).toBe(false);
    expect(encrypted.includes(DUMP)).toBe(false);
    // gzip's own magic would otherwise announce what kind of file this is.
    expect(encrypted.subarray(0, 2).equals(Buffer.from([0x1f, 0x8b]))).toBe(false);
  });

  it("is refused by the wrong passphrase rather than half-decoded", () => {
    const encrypted = encrypt(DUMP, "the real one");
    expect(decryptBackup(encrypted, "a guess")).toBeNull();
    expect(decryptBackup(encrypted, "")).toBeNull();
  });

  it("is refused after a single flipped byte", () => {
    // GCM authenticates: a truncated or edited backup must be rejected, not
    // fed to psql, which drops the database before it reads anything.
    const encrypted = encrypt(DUMP, "pass");
    const tampered = Buffer.from(encrypted);
    tampered[tampered.length - 20] ^= 0xff;
    expect(decryptBackup(tampered, "pass")).toBeNull();
  });

  it("is refused when truncated", () => {
    const encrypted = encrypt(DUMP, "pass");
    expect(decryptBackup(encrypted.subarray(0, encrypted.length - 8), "pass")).toBeNull();
  });
});

describe("what the person who made it gets back", () => {
  it("exactly the bytes that went in", () => {
    const encrypted = encrypt(DUMP, "correct horse battery staple");
    expect(decryptBackup(encrypted, "correct horse battery staple")?.equals(DUMP)).toBe(true);
  });

  it("survives a passphrase with accents, spaces and emoji", () => {
    const pass = "  Mon Été 2026 ☕ très sûr  ";
    expect(decryptBackup(encrypt(DUMP, pass), pass)?.equals(DUMP)).toBe(true);
  });

  it("normalises the passphrase, so the same characters typed differently work", () => {
    // "é" has two Unicode spellings and a phone keyboard may not use the same
    // one as a laptop. Without NFKC a passphrase typed on the other device is
    // simply wrong, with no way to tell why.
    const composed = "café";
    const decomposed = "café";
    expect(decryptBackup(encrypt(DUMP, composed), decomposed)?.equals(DUMP)).toBe(true);
  });

  it("produces a different file every time for the same input", () => {
    // A fresh salt and IV per backup: two dumps of an unchanged database must
    // not be byte-identical, or their equality leaks that nothing changed.
    expect(encrypt(DUMP, "p").equals(encrypt(DUMP, "p"))).toBe(false);
  });
});

describe("telling an encrypted backup from a plain one", () => {
  it("recognises its own format", () => {
    expect(isEncryptedBackup(encrypt(DUMP, "p"))).toBe(true);
    expect(BACKUP_MAGIC.length).toBeGreaterThan(0);
  });

  it("does not mistake a plain gzip backup for one", () => {
    // Restoring an older, unencrypted backup has to keep working.
    expect(isEncryptedBackup(DUMP)).toBe(false);
    expect(isEncryptedBackup(Buffer.from("-- plain SQL dump"))).toBe(false);
    expect(isEncryptedBackup(Buffer.alloc(0))).toBe(false);
  });
});
