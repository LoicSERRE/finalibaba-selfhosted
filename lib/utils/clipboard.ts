/**
 * Copy text to the clipboard, including over plain HTTP.
 *
 * `navigator.clipboard` is secure-context-only: over a bare LAN IP without
 * TLS it is simply `undefined`, and calling `.writeText` on it throws. That is
 * this project's own documented default access pattern (README, "Securing
 * access" - `AUTH_ENABLED` off on a trusted private network), so every copy
 * button in Settings was broken for the most common self-hosted setup. The
 * invitation-link button matters most: handing that link to someone is the
 * entire point of the multi-user flow.
 *
 * Falls back to the old `document.execCommand("copy")` path, which is
 * deprecated but is precisely the one that still works in an insecure context.
 * Returns whether it worked, so a caller can tell the user to copy by hand
 * rather than silently showing a "Copied" tick that did nothing.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Permission denied, or a browser that exposes the API but refuses it
      // outside a user gesture - fall through to the legacy path.
    }
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    // Keep it out of view and out of the tab order, but still selectable:
    // display:none or visibility:hidden would make execCommand copy nothing.
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.top = "-9999px";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    textarea.remove();
    return ok;
  } catch {
    return false;
  }
}
