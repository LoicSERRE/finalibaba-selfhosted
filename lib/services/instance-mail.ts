import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { decryptSecret } from "@/lib/domain/crypto-at-rest";

/**
 * The instance's mail server: set once by an admin, offered to every user as
 * "send my alerts through the instance's server" (UserSettings.useInstanceMail).
 *
 * A user who picks it chooses only whether they get email and where it goes;
 * the host, port and credentials stay the admin's. That is what lets a member
 * use the instance's own network - typically the `mail` service, which relays
 * for anything on the Docker network without credentials - without being able
 * to point an SMTP connection anywhere on that network themselves (see
 * lib/services/smtp-relay-policy.ts).
 *
 * A plain module rather than a Server Action file: dispatchAlert reads the
 * decrypted password through it.
 */
export type SmtpTransport = {
  host: string;
  port: number;
  user: string | null;
  password: string | null;
  from: string;
};

/** What the admin's form shows: never the password, only whether one is set. */
export type InstanceMailForm = {
  host: string | null;
  port: number | null;
  user: string | null;
  from: string | null;
  hasPassword: boolean;
};

const MAIL_COLUMNS = { smtpHost: true, smtpPort: true, smtpUser: true, smtpPassword: true, smtpFrom: true } as const;

function readInstanceMail() {
  return prisma.instanceSettings.findUnique({ where: { id: "singleton" }, select: MAIL_COLUMNS });
}

type MailRow = Awaited<ReturnType<typeof readInstanceMail>>;

function isComplete(row: MailRow): row is NonNullable<MailRow> & { smtpHost: string; smtpPort: number; smtpFrom: string } {
  return Boolean(row?.smtpHost && row.smtpPort && row.smtpFrom);
}

/** The instance's server, decrypted for one send, or null when an admin has
 *  not set one up. */
export async function instanceMailTransport(): Promise<SmtpTransport | null> {
  const row = await readInstanceMail();
  if (!isComplete(row)) return null;
  return {
    host: row.smtpHost,
    port: row.smtpPort,
    user: row.smtpUser,
    password: decryptSecret(row.smtpPassword),
    from: row.smtpFrom,
  };
}

/** Whether there is a server to offer users. */
export async function instanceMailAvailable(): Promise<boolean> {
  return isComplete(await readInstanceMail());
}

export async function instanceMailForm(): Promise<InstanceMailForm> {
  const row = await readInstanceMail();
  return {
    host: row?.smtpHost ?? null,
    port: row?.smtpPort ?? null,
    user: row?.smtpUser ?? null,
    from: row?.smtpFrom ?? null,
    hasPassword: Boolean(row?.smtpPassword),
  };
}

/** `password` null leaves the stored one unchanged; it arrives already encrypted. */
export async function updateInstanceMail(data: {
  host: string | null;
  port: number | null;
  user: string | null;
  password: string | null;
  from: string | null;
}): Promise<void> {
  const columns = { smtpHost: data.host, smtpPort: data.port, smtpUser: data.user, smtpFrom: data.from };
  await prisma.instanceSettings.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", ...columns, smtpPassword: data.password },
    update: { ...columns, ...(data.password ? { smtpPassword: data.password } : {}) },
  });
  revalidatePath("/settings");
}
