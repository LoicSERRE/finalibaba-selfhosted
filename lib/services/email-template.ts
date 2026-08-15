// 96x96 PNG rendered from public/icon.svg via sharp - embedded as a data URI
// so the email never depends on the app being reachable to load an <img src>
// (self-hosted instances are often only reachable on a private LAN/VPN).
const LOGO_BASE64 =
  "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";

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Table-based layout with inlined styles - the only markup that survives
// consistently across email clients (Gmail/Outlook strip <style> blocks and
// don't support flex/grid). Self-contained (data URI logo, no external
// requests) since a self-hosted instance may not be reachable when the
// recipient reads the email.
export function renderAlertEmailHtml(title: string, body: string): string {
  const safeTitle = escapeHtml(title);
  // Preserve line breaks from the plain-text body (e.g. multi-line sync
  // failure messages) without treating user/bank-provided text as HTML.
  const safeBody = escapeHtml(body).replace(/\n/g, "<br>");

  return `<!DOCTYPE html>
<html lang="fr">
<body style="margin:0;padding:0;background-color:#0b0b10;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0b0b10;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background-color:#13131a;border:1px solid #2a2a38;border-radius:12px;overflow:hidden;">
          <tr>
            <td style="padding:24px 28px;border-bottom:1px solid #2a2a38;">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding-right:12px;">
                    <img src="data:image/png;base64,${LOGO_BASE64}" width="32" height="32" alt="Finalibaba" style="display:block;border-radius:8px;">
                  </td>
                  <td>
                    <span style="color:#f4f4f5;font-size:16px;font-weight:600;">Finalibaba</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:28px;">
              <h1 style="margin:0 0 16px;color:#f4f4f5;font-size:18px;font-weight:600;">${safeTitle}</h1>
              <p style="margin:0;color:#d4d4d8;font-size:14px;line-height:1.6;">${safeBody}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 28px;border-top:1px solid #2a2a38;">
              <p style="margin:0;color:#a1a1aa;font-size:12px;">Envoyé automatiquement par votre instance Finalibaba self-hosted.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
