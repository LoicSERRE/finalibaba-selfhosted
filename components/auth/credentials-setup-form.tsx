"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, TrendingUp } from "lucide-react";
import { useTranslations } from "next-intl";
import { MIN_USERNAME_LENGTH, MIN_PASSWORD_LENGTH } from "@/lib/domain/users";

/**
 * "Choose your own username and password" - used by BOTH the first-boot
 * bootstrap (an instance that just turned AUTH_ENABLED on) and the
 * invitation flow. One component for both on purpose: they're the same
 * ceremony, and it's what makes "the admin never sets anyone else's
 * password" true without a second screen to maintain.
 *
 * `onSubmit` is the caller's Server Action; `notice` is the one line that
 * differs between the two contexts (bootstrap reassures the user their
 * existing data will be attached to this account, invitations don't).
 */
export function CredentialsSetupForm({
  title,
  subtitle,
  notice,
  submitLabel,
  onSubmit,
}: Readonly<{
  title: string;
  subtitle: string;
  notice?: string;
  submitLabel: string;
  onSubmit: (formData: FormData) => Promise<void>;
}>) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const t = useTranslations("auth");

  const mismatch = confirmPassword.length > 0 && password !== confirmPassword;
  const canSubmit =
    username.trim().length >= MIN_USERNAME_LENGTH &&
    password.length >= MIN_PASSWORD_LENGTH &&
    password === confirmPassword;

  async function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const fd = new FormData();
      fd.set("username", username);
      fd.set("password", password);
      await onSubmit(fd);
      // Straight to the login page: the account exists now, but this flow
      // deliberately doesn't auto-authenticate - the user proves the
      // password they just chose actually works.
      router.push("/login");
      router.refresh();
    } catch {
      setError(t("setupError"));
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[var(--background)] flex flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4 relative overflow-hidden"
            style={{ background: "linear-gradient(135deg, var(--accent), var(--accent-strong))" }}
          >
            <span className="text-white font-extrabold text-3xl tracking-tighter select-none">F</span>
          </div>
          <h1 className="text-2xl font-bold text-[var(--foreground)] tracking-tight text-center">{title}</h1>
          <p className="text-sm text-[var(--muted)] mt-1 text-center">{subtitle}</p>
        </div>

        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 space-y-4">
          {notice && (
            <p className="text-xs text-[var(--muted)] bg-[var(--surface-elevated)] border border-[var(--border)] rounded-xl px-3 py-2.5">
              {notice}
            </p>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="username" className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
                {t("username")}
              </label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                autoCapitalize="none"
                className="w-full bg-[var(--surface-elevated)] border border-[var(--border)] rounded-xl px-4 py-3 text-sm text-[var(--foreground)] placeholder-[var(--muted)]/40 focus:outline-none focus:border-[var(--accent)] transition-colors"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="password" className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
                {t("password")}
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  autoComplete="new-password"
                  className="w-full bg-[var(--surface-elevated)] border border-[var(--border)] rounded-xl px-4 py-3 pr-12 text-sm text-[var(--foreground)] placeholder-[var(--muted)]/40 focus:outline-none focus:border-[var(--accent)] transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? t("hidePassword") : t("showPassword")}
                  className="absolute right-0 top-0 h-full w-12 flex items-center justify-center text-[var(--muted)] hover:text-[var(--foreground)] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-inset rounded-r-xl"
                >
                  {showPassword ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
                </button>
              </div>
              <p className="text-xs text-[var(--muted)]">{t("passwordHint", { min: MIN_PASSWORD_LENGTH })}</p>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="confirmPassword"
                className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider"
              >
                {t("confirmPassword")}
              </label>
              <input
                id="confirmPassword"
                type={showPassword ? "text" : "password"}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••••••"
                autoComplete="new-password"
                className="w-full bg-[var(--surface-elevated)] border border-[var(--border)] rounded-xl px-4 py-3 text-sm text-[var(--foreground)] placeholder-[var(--muted)]/40 focus:outline-none focus:border-[var(--accent)] transition-colors"
              />
              {mismatch && (
                <p className="text-xs text-[var(--negative)]">{t("passwordMismatch")}</p>
              )}
            </div>

            {error && (
              <p role="alert" className="text-xs text-[var(--negative)] flex items-center gap-1.5">
                <span className="inline-block w-1 h-1 rounded-full bg-[var(--negative)]" aria-hidden="true" />
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading || !canSubmit}
              className="w-full py-3 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]"
              style={{ background: "linear-gradient(135deg, var(--accent), var(--accent-strong))" }}
            >
              {loading ? t("loading") : submitLabel}
            </button>
          </form>
        </div>

        <div className="mt-6 flex items-center justify-center gap-1.5 text-xs text-[var(--muted)]">
          <TrendingUp size={12} aria-hidden="true" />
          <span>{t("footer")}</span>
        </div>
      </div>
    </div>
  );
}
