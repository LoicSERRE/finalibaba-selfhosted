"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, TrendingUp } from "lucide-react";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    // Pass the IP via a hidden field isn't reliable client-side — the server
    // middleware will enforce rate limiting. We pass a placeholder.
    const { signIn } = await import("next-auth/react");
    const result = await signIn("credentials", {
      password,
      ip: "client",
      redirect: false,
    });

    setLoading(false);

    if (result?.ok) {
      router.push("/");
      router.refresh();
    } else {
      setError("Mot de passe incorrect");
      setPassword("");
    }
  }

  return (
    <div className="min-h-screen bg-[var(--background)] flex flex-col items-center justify-center px-4">
      {/* Card */}
      <div className="w-full max-w-sm">
        {/* Logo + name */}
        <div className="flex flex-col items-center mb-8">
          {/* Icon */}
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4 relative overflow-hidden"
            style={{ background: "linear-gradient(135deg, #6366f1, #4338ca)" }}
          >
            {/* F letter */}
            <span className="text-white font-extrabold text-3xl tracking-tighter select-none">F</span>
            {/* Trend bars decoration */}
            <div className="absolute bottom-2 right-2 flex items-end gap-0.5">
              <div className="w-1 h-1.5 rounded-sm bg-green-400 opacity-90" />
              <div className="w-1 h-2.5 rounded-sm bg-green-400 opacity-90" />
              <div className="w-1 h-3.5 rounded-sm bg-green-400 opacity-90" />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-[var(--foreground)] tracking-tight">Finalibaba</h1>
          <p className="text-sm text-[var(--muted)] mt-1">Votre patrimoine, en un coup d&apos;œil</p>
        </div>

        {/* Form */}
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 space-y-4">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="password" className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
                Mot de passe
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
                  aria-label={showPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"}
                  className="absolute right-0 top-0 h-full w-12 flex items-center justify-center text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {error && (
              <p className="text-xs text-[var(--negative)] flex items-center gap-1.5">
                <span className="inline-block w-1 h-1 rounded-full bg-[var(--negative)]" />
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading || !password}
              className="w-full py-3 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: "linear-gradient(135deg, #6366f1, #4338ca)" }}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                  </svg>
                  Connexion…
                </span>
              ) : "Se connecter"}
            </button>
          </form>
        </div>

        {/* Footer */}
        <div className="mt-6 flex items-center justify-center gap-1.5 text-xs text-[var(--muted)]">
          <TrendingUp size={12} />
          <span>Vos données restent sur votre serveur</span>
        </div>
      </div>
    </div>
  );
}
