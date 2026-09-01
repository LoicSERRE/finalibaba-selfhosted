import { getTranslations } from "next-intl/server";
import { LoginForm } from "@/components/auth/login-form";
import { CredentialsSetupForm } from "@/components/auth/credentials-setup-form";
import { needsBootstrap, bootstrapOwner } from "@/lib/actions/users";

// Must reflect the current DB state on every request, not a build-time
// snapshot - toggling 2FA in Settings has to show up on the very next login,
// and the bootstrap state below flips the moment an admin account exists.
export const dynamic = "force-dynamic";

// proxy.ts now redirects /login -> / itself when AUTH_ENABLED is off (before
// this page ever renders), so this component doesn't need to duplicate that
// check - see proxy.ts for why it has to live there and not here.
export default async function LoginPage() {
  // An instance that just turned AUTH_ENABLED on and has no password anywhere
  // (no env var, no DB hash) would otherwise sit at a login form nobody can
  // pass. This is the "day 180" case: someone ran happily in mono mode for
  // months, then enabled auth. Their data already belongs to the owner row,
  // so this screen only sets credentials on it - nothing is moved or
  // reattached. See CLAUDE.md's "Multi-user architecture".
  if (await needsBootstrap()) {
    const t = await getTranslations("auth");
    return (
      <CredentialsSetupForm
        title={t("bootstrapTitle")}
        subtitle={t("bootstrapSubtitle")}
        notice={t("bootstrapNotice")}
        submitLabel={t("bootstrapSubmit")}
        onSubmit={bootstrapOwner}
      />
    );
  }

  // No totpEnabled fetch: it answered for the instance OWNER, before anyone
  // had typed a username, so on a multi-user instance every account got the
  // owner's answer. The server decides now, after checking the password.
  return <LoginForm />;
}
