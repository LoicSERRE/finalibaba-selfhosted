import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-64 gap-3">
      <p className="text-4xl font-semibold text-[var(--muted)]">404</p>
      <p className="text-sm text-[var(--muted)]">Page introuvable</p>
      <Link href="/" className="text-sm text-[var(--accent)] underline underline-offset-2">
        Retour au dashboard
      </Link>
    </div>
  );
}
