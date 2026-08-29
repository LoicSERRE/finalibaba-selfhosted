import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { CredentialsSetupForm } from "@/components/auth/credentials-setup-form";
import { isInvitationValid, acceptInvitation } from "@/lib/actions/users";

export const dynamic = "force-dynamic";

// Never indexed: an invitation URL is a bearer credential until it's used.
export const metadata = { robots: { index: false, follow: false } };

/**
 * Redeems an admin-generated invitation into a real account - the same
 * "choose your own username and password" ceremony as the first-boot
 * bootstrap screen, just driven by a token instead of instance state, so the
 * admin never knows the password they're inviting someone to set.
 *
 * notFound() uniformly for "no such token", "already used" and "expired" -
 * an anonymous visitor learns nothing about which it was, same convention as
 * app/shared/[token]/page.tsx.
 */
export default async function InvitePage({ params }: Readonly<{ params: Promise<{ token: string }> }>) {
  const { token } = await params;
  if (!(await isInvitationValid(token))) notFound();

  const t = await getTranslations("auth");

  async function accept(formData: FormData) {
    "use server";
    await acceptInvitation(token, formData);
  }

  return (
    <CredentialsSetupForm
      title={t("inviteTitle")}
      subtitle={t("inviteSubtitle")}
      submitLabel={t("inviteSubmit")}
      onSubmit={accept}
    />
  );
}
