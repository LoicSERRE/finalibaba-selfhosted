/**
 * What psql reads during an in-app restore (app/api/backup/route.ts).
 *
 * psql executes its own backslash commands from its input, and some reach
 * outside the database: `\!` runs a shell command, `\o |cmd` pipes into one -
 * in the app container, beside the app's secrets. A restore is meant to
 * replace the data, not to run whatever a file says on the host, so the
 * upload is fed in psql's restricted mode (PostgreSQL 16.10+, the fix for
 * CVE-2025-8714): `\restrict <key>` first, under which every backslash
 * command is refused but `\unrestrict` with that same key, which the file's
 * author cannot know.
 *
 * pg_dump 16.10+ writes its own `\restrict`/`\unrestrict` pair around a dump;
 * those whole lines are dropped, since inside ours they would be refused and
 * stop the restore. Nothing else is touched - a backslash in COPY data or in
 * a quoted string is data, which restricted mode leaves alone.
 */
const DUMP_RESTRICT_LINE = /^\\(?:un)?restrict [A-Za-z0-9]+\r?\n/gm;

export function restrictedRestoreInput(sql: Buffer, key: string): Buffer {
  if (!/^[A-Za-z0-9]{16,}$/.test(key)) throw new Error("A restrict key is 16+ letters or digits.");
  // latin1 maps every byte to one character and back, so a dump in any
  // encoding comes out byte for byte apart from the lines removed.
  const body = sql.toString("latin1").replace(DUMP_RESTRICT_LINE, "");
  return Buffer.concat([Buffer.from(`\\restrict ${key}\n`, "latin1"), Buffer.from(body, "latin1")]);
}
