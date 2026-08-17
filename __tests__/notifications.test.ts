import { afterEach, describe, expect, it, vi } from "vitest";

const sendMailMock = vi.fn();
// Typed explicitly via vi.fn's generic (rather than inferred from the
// implementation's own parameter list) so createTransportMock.mock.calls
// still indexes as accepting arbitrary args below, without needing an
// unused parameter in the implementation itself just to carry that type.
const createTransportMock = vi.fn<(...args: unknown[]) => { sendMail: typeof sendMailMock }>(() => ({
  sendMail: sendMailMock,
}));
vi.mock("nodemailer", () => ({
  default: { createTransport: (...args: unknown[]) => createTransportMock(...args) },
}));

const { sendNtfyMessage, sendEmail, dispatchAlert } = await import("@/lib/services/notifications");

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  sendMailMock.mockReset();
  createTransportMock.mockClear();
});

describe("sendNtfyMessage", () => {
  it("POSTs JSON to the server root, with topic/title/message as body fields", async () => {
    // Not the simple API (POST straight to the topic URL, title as a
    // `Title` header) - that header approach breaks for accented titles,
    // since HTTP header values must be Latin-1 and alert titles are
    // French/user-entered. The JSON API's fields are plain JSON strings,
    // UTF-8-safe with no encoding workaround needed. Confirmed the hard way
    // while building this.
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    const ok = await sendNtfyMessage("https://ntfy.sh/mon-sujet", "Patrimoine net : seuil dépassé", "Passé au-dessus de 100 000 €.");

    expect(ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://ntfy.sh");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      topic: "mon-sujet",
      title: "Patrimoine net : seuil dépassé",
      message: "Passé au-dessus de 100 000 €.",
    });
  });

  it("returns false (not throw) on a non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    expect(await sendNtfyMessage("https://ntfy.sh/x", "title", "body")).toBe(false);
  });

  it("returns false (not throw) when fetch itself rejects", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    expect(await sendNtfyMessage("https://ntfy.sh/x", "title", "body")).toBe(false);
  });

  it("sends an Authorization header when an auth token is given - for a self-hosted ntfy server with auth-default-access=deny-all", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await sendNtfyMessage("https://ntfy.example.com/x", "title", "body", "tk_abc123");

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers).toEqual({ "Content-Type": "application/json", Authorization: "Bearer tk_abc123" });
  });

  it("omits the Authorization header entirely when no token is given (the public ntfy.sh case)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await sendNtfyMessage("https://ntfy.sh/x", "title", "body");

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
  });

  it("includes icon and click only when APP_URL is configured - both need a URL ntfy can actually fetch", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await sendNtfyMessage("https://ntfy.sh/x", "title", "body");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty("icon");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty("click");

    vi.stubEnv("APP_URL", "https://finalibaba.example.com/");
    await sendNtfyMessage("https://ntfy.sh/x", "title", "body");
    const payload = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(payload.icon).toBe("https://finalibaba.example.com/icon");
    expect(payload.click).toBe("https://finalibaba.example.com");
  });
});

describe("sendEmail", () => {
  it("uses secure=true only for port 465, not for 587/25/other STARTTLS ports", async () => {
    sendMailMock.mockResolvedValue({});
    await sendEmail({ host: "smtp.example.com", port: 465, user: null, password: null, from: "a@b.com", to: "c@d.com" }, "s", "t");
    expect(createTransportMock.mock.calls[0][0]).toMatchObject({ port: 465, secure: true });

    await sendEmail({ host: "smtp.example.com", port: 587, user: null, password: null, from: "a@b.com", to: "c@d.com" }, "s", "t");
    expect(createTransportMock.mock.calls[1][0]).toMatchObject({ port: 587, secure: false });
  });

  it("omits auth entirely when no user is configured, rather than sending an empty-string user", async () => {
    sendMailMock.mockResolvedValue({});
    await sendEmail({ host: "h", port: 587, user: null, password: null, from: "a@b.com", to: "c@d.com" }, "s", "t");
    expect((createTransportMock.mock.calls[0][0] as Record<string, unknown>).auth).toBeUndefined();
  });

  it("passes from/to/subject/text through to sendMail", async () => {
    sendMailMock.mockResolvedValue({});
    await sendEmail(
      { host: "h", port: 587, user: "u", password: "p", from: "finalibaba@example.com", to: "moi@example.com" },
      "Alerte",
      "corps du message"
    );
    expect(sendMailMock).toHaveBeenCalledWith({
      from: "finalibaba@example.com",
      to: "moi@example.com",
      subject: "Alerte",
      text: "corps du message",
    });
  });

  it("returns false (not throw) when sendMail rejects", async () => {
    sendMailMock.mockRejectedValue(new Error("SMTP connection refused"));
    const ok = await sendEmail({ host: "h", port: 587, user: null, password: null, from: "a@b.com", to: "c@d.com" }, "s", "t");
    expect(ok).toBe(false);
  });
});

describe("dispatchAlert", () => {
  it("sends to no channel when nothing is configured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await dispatchAlert(
      { ntfyTopicUrl: null, ntfyAuthToken: null, alertEmailTo: null, smtpHost: null, smtpPort: null, smtpUser: null, smtpPassword: null, smtpFrom: null },
      "title",
      "body"
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("sends to ntfy only when only ntfy is configured", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    sendMailMock.mockResolvedValue({});

    await dispatchAlert(
      { ntfyTopicUrl: "https://ntfy.sh/x", ntfyAuthToken: null, alertEmailTo: null, smtpHost: null, smtpPort: null, smtpUser: null, smtpPassword: null, smtpFrom: null },
      "title",
      "body"
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("requires alertEmailTo AND smtpHost AND smtpPort AND smtpFrom before sending email - a partially-filled form must not silently attempt a broken send", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    sendMailMock.mockResolvedValue({});

    // Only alertEmailTo set, no SMTP host - must not attempt to send.
    await dispatchAlert(
      { ntfyTopicUrl: null, ntfyAuthToken: null, alertEmailTo: "moi@example.com", smtpHost: null, smtpPort: null, smtpUser: null, smtpPassword: null, smtpFrom: null },
      "title",
      "body"
    );
    expect(sendMailMock).not.toHaveBeenCalled();

    // Everything required set - must send.
    await dispatchAlert(
      {
        ntfyTopicUrl: null,
        ntfyAuthToken: null,
        alertEmailTo: "moi@example.com",
        smtpHost: "smtp.example.com",
        smtpPort: 587,
        smtpUser: null,
        smtpPassword: null,
        smtpFrom: "finalibaba@example.com",
      },
      "title",
      "body"
    );
    expect(sendMailMock).toHaveBeenCalledTimes(1);
  });
});
