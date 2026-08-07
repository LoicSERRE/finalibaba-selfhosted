import { LoginForm } from "@/components/auth/login-form";
import { getTotpEnabled } from "@/lib/actions/user-settings";

// Must reflect the current DB state on every request, not a build-time
// snapshot - toggling 2FA in Settings has to show up on the very next login.
export const dynamic = "force-dynamic";

// proxy.ts now redirects /login -> / itself when AUTH_ENABLED is off (before
// this page ever renders), so this component doesn't need to duplicate that
// check - see proxy.ts for why it has to live there and not here.
export default async function LoginPage() {
  const totpEnabled = await getTotpEnabled();
  return <LoginForm totpEnabled={totpEnabled} />;
}
