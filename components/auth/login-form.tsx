"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, TrendingUp } from "lucide-react";
import { useTranslations } from "next-intl";

export function LoginForm({ totpEnabled }: Readonly<{ totpEnabled: boolean }>) {
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const t = useTranslations("auth");

  async function handleSubmit(e: React.SubmitEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const { signIn } = await import("next-auth/react");
    const result = await signIn("credentials", {
      password,
      totpCode,
      redirect: false,
    });

    setLoading(false);

    if (result?.ok) {
      router.push("/");
      router.refresh();
    } else {
      setError(totpEnabled ? t("errorInvalidWithCode") : t("errorInvalid"));
      setPassword("");
      setTotpCode("");
    }
  }

  return (
    <div className="min-h-screen bg-[var(--background)] flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4 relative overflow-hidden"
            style={{ background: "linear-gradient(135deg, var(--accent), var(--accent-strong))" }}
          >
            <span className="text-white font-extrabold text-3xl tracking-tighter select-none">F</span>
            <div className="absolute bottom-2 right-2 flex items-end gap-0.5">
              <div className="w-1 h-1.5 rounded-sm bg-[var(--positive)] opacity-90" />
              <div className="w-1 h-2.5 rounded-sm bg-[var(--positive)] opacity-90" />
              <div className="w-1 h-3.5 rounded-sm bg-[var(--positive)] opacity-90" />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-[var(--foreground)] tracking-tight">Finalibaba</h1>
          <p className="text-sm text-[var(--muted)] mt-1">{t("subtitle")}</p>
        </div>

        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 space-y-4">
          <form onSubmit={handleSubmit} className="space-y-4">
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
                  autoComplete="current-password"
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
            </div>

            {totpEnabled && (
              <div className="space-y-1.5">
                <label htmlFor="totpCode" className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
                  {t("totpLabel")}
                </label>
                <input
                  id="totpCode"
                  type="text"
                  inputMode="text"
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value)}
                  placeholder="123456"
                  autoComplete="one-time-code"
                  maxLength={11}
                  className="w-full bg-[var(--surface-elevated)] border border-[var(--border)] rounded-xl px-4 py-3 text-sm text-[var(--foreground)] placeholder-[var(--muted)]/40 focus:outline-none focus:border-[var(--accent)] transition-colors"
                />
                <p className="text-xs text-[var(--muted)]">{t("totpHint")}</p>
              </div>
            )}

            {error && (
              <p role="alert" className="text-xs text-[var(--negative)] flex items-center gap-1.5">
                <span className="inline-block w-1 h-1 rounded-full bg-[var(--negative)]" aria-hidden="true" />
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading || !password}
              className="w-full py-3 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]"
              style={{ background: "linear-gradient(135deg, var(--accent), var(--accent-strong))" }}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                  </svg>
                  {t("loading")}
                </span>
              ) : t("submit")}
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
