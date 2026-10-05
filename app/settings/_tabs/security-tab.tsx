import { prisma } from "@/lib/db/prisma";
import { AccountSection } from "@/components/settings/account-section";
import { TwoFactorSection } from "@/components/settings/two-factor-section";
import { AppLockSection } from "@/components/settings/app-lock-section";
import { SecuritySection } from "@/components/settings/security-section";
import { MyDataSection } from "@/components/settings/my-data-section";
import { BackupRestoreSection } from "@/components/settings/backup-restore-section";
import { getOwnAccount } from "@/lib/actions/users";
import { getAppLockStatus } from "@/lib/actions/app-lock";
import { getAuditLog } from "@/lib/actions/security";
import { requiresTwoFactor } from "@/lib/services/two-factor-policy";
import type { SettingsTabProps } from "./context";

/**
 * Who can get in, and what they did: identity and password, the second factor,
 * the device lock, sessions and the audit log, then the data exports.
 */
export async function SecurityTab({ viewer, show, isAdmin, isMulti }: SettingsTabProps) {
  const [ownAccount, viewerTotpEnabled, appLockStatus, auditEvents, requireTwoFactor] = await Promise.all([
    // Multi-user surfaces only mean something with auth on: in mono mode there
    // is no login, so these are skipped rather than fetched and hidden.
    isMulti ? getOwnAccount() : Promise.resolve(null),
    // From User, not UserSettings. v2.0 moved TOTP onto User and left the old
    // column behind as vestigial; reading the old one made Settings show
    // "Désactivée" forever while login correctly asked for the code.
    prisma.user
      .findUnique({ where: { id: viewer.id }, select: { totpEnabled: true } })
      .then((u) => u?.totpEnabled ?? false),
    show.sensitive ? getAppLockStatus() : Promise.resolve(null),
    show.withAuth ? getAuditLog() : Promise.resolve([]),
    show.withAuth ? requiresTwoFactor() : Promise.resolve(false),
  ]);

  return (
    <>
      {show.withAuth && ownAccount && (
        <AccountSection
          username={ownAccount.username}
          displayName={ownAccount.displayName}
          role={ownAccount.role}
          needsSetup={ownAccount.needsSetup}
        />
      )}

      {/* 2FA - meaningless without built-in auth active, and hidden in demo
          mode (setup/disable mutations are blocked anyway). */}
      {show.withAuth && <TwoFactorSection totpEnabled={viewerTotpEnabled} />}

      {/* App-lock - deliberately NOT gated by AUTH_ENABLED like 2FA: a fast
          local unlock for an already-installed, already-trusted PWA, meant to
          work even on a private-network instance with no password login at
          all. Hidden in demo mode only. */}
      {show.sensitive && appLockStatus && (
        <AppLockSection userId={viewer.id} enabled={appLockStatus.enabled} credentials={appLockStatus.credentials} />
      )}

      {/* Sessions, the 2FA policy and the activity log. */}
      {show.withAuth && (
        <SecuritySection events={auditEvents} isAdmin={isAdmin} requireTwoFactor={requireTwoFactor} />
      )}

      {/* Everybody's own data first: the one that concerns the person reading,
          and for a member the only one they see. */}
      {show.sensitive && <MyDataSection />}

      {/* Admin-only: this wraps pg_dump/psql over the WHOLE database, so a
          restore replaces every user's data (and the user table itself). The
          backup routes enforce it - this just doesn't offer a member a section
          whose every button returns 403. */}
      {show.adminOnly && <BackupRestoreSection />}
    </>
  );
}
