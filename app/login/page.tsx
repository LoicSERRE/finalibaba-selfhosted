import { LoginForm } from "@/components/login-form";

// proxy.ts now redirects /login -> / itself when AUTH_ENABLED is off (before
// this page ever renders), so this component doesn't need to duplicate that
// check - see proxy.ts for why it has to live there and not here.
export default function LoginPage() {
  return <LoginForm />;
}
