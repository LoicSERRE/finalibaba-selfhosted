import { ShareLinksSection } from "@/components/settings/share-links-section";
import { PortfolioSharingSection } from "@/components/settings/portfolio-sharing-section";
import { UsersSection } from "@/components/settings/users-section";
import { ApiKeysSection } from "@/components/settings/api-keys-section";
import { getShareLinks } from "@/lib/actions/share-links";
import { getApiKeys } from "@/lib/actions/api-keys";
import { listInvitations, listUsers } from "@/lib/actions/users";
import { listPortfolioGrants } from "@/lib/actions/sharing";
import { OWNER_USER_ID } from "@/lib/auth-context";
import type { SettingsTabProps } from "./context";

/** Everyone and everything that can see this portfolio from outside it. */
export async function SharingTab({ viewer, show, isAdmin, isMulti }: SettingsTabProps) {
  const [shareLinks, apiKeys, grants, users, invitations] = await Promise.all([
    getShareLinks(),
    getApiKeys(),
    // Portfolio grants and user management mean nothing without a login, so a
    // mono instance does not pay for queries it can never use.
    isMulti ? listPortfolioGrants() : Promise.resolve({ given: [], received: [] }),
    isMulti && isAdmin ? listUsers() : Promise.resolve([]),
    isMulti && isAdmin ? listInvitations() : Promise.resolve([]),
  ]);

  return (
    <>
      {/* Read-only share links - deliberately NOT gated by AUTH_ENABLED: the
          primary use case is sharing one view externally while AUTH_ENABLED
          stays off for the trusted private network. Hidden in demo mode only. */}
      {show.sensitive && <ShareLinksSection links={shareLinks} />}

      {show.withAuth && <PortfolioSharingSection given={grants.given} received={grants.received} />}

      {show.userManagement && (
        <UsersSection users={users} invitations={invitations} currentUserId={viewer.id} ownerUserId={OWNER_USER_ID} />
      )}

      {/* Public REST API keys - same "independent of AUTH_ENABLED" reasoning:
          proxy.ts exempts /api/v1 from the session gate, each route gates
          itself via the key instead. */}
      {show.sensitive && <ApiKeysSection keys={apiKeys} />}
    </>
  );
}
