"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

export default function ErrorPage({
  error,
  reset,
}: Readonly<{
  error: Error & { digest?: string };
  reset: () => void;
}>) {
  const t = useTranslations("common");

  useEffect(() => {
    // Next.js's recommended pattern for error.tsx - ensures the error still
    // reaches server/browser logs even without a dedicated error-reporting
    // service wired up.
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center min-h-64 gap-4 text-center px-6">
      <p className="text-sm text-[var(--muted)]">{t("unexpectedError")}</p>
      <Button onClick={reset}>{t("retry")}</Button>
    </div>
  );
}
