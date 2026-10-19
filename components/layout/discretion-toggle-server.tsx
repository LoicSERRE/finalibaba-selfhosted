import { cookies } from "next/headers";
import { DISCRETION_COOKIE, isDiscreet } from "@/lib/domain/discretion";
import { DiscretionToggle } from "@/components/layout/discretion";

/**
 * DiscretionToggle with its server snapshot read from the cookie, so a
 * server-rendered toggle shows the right icon on first paint instead of
 * flipping after hydration. The client-only sidebar does not need this.
 */
export async function DiscretionToggleServer(
  props: Readonly<{ variant?: "row" | "icon"; className?: string }>
) {
  const initial = isDiscreet((await cookies()).get(DISCRETION_COOKIE)?.value);
  return <DiscretionToggle initial={initial} {...props} />;
}
