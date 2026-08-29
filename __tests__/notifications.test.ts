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

const { findManyMock, deleteManyMock, sendNotificationMock, setVapidDetailsMock, instanceFindUniqueMock } = vi.hoisted(() => ({
  findManyMock: vi.fn(),
  deleteManyMock: vi.fn(),
  sendNotificationMock: vi.fn(),
  setVapidDetailsMock: vi.fn(),
  // VAPID keys are instance-level as of v2.0 (they identify the server, not
  // a person) and sendWebPush reads them itself rather than taking them as
  // parameters.
  instanceFindUniqueMock: vi.fn(async () => ({ vapidPublicKey: "pub", vapidPrivateKey: "priv" })),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    pushSubscription: { findMany: findManyMock, deleteMany: deleteManyMock },
    userSettings: { upsert: vi.fn(), update: vi.fn() },
    instanceSettings: { findUnique: instanceFindUniqueMock, upsert: vi.fn(), update: vi.fn() },
  },
}));

class MockWebPushError extends Error {
  statusCode: number;
  constructor(statusCode: number) {
    super("mock web-push error");
    this.statusCode = statusCode;
  }
}
vi.mock("web-push", () => ({
  sendNotification: (...args: unknown[]) => sendNotificationMock(...args),
  setVapidDetails: (...args: unknown[]) => setVapidDetailsMock(...args),
  generateVAPIDKeys: vi.fn(),
  WebPushError: MockWebPushError,
}));

const { sendNtfyMessage, sendEmail, sendWebPush, dispatchAlert } = await import("@/lib/services/notifications");

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  sendMailMock.mockReset();
  createTransportMock.mockClear();
  findManyMock.mockReset();
  deleteManyMock.mockReset();
  sendNotificationMock.mockReset();
  setVapidDetailsMock.mockReset();
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
      tags: ["bar_chart"],
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
      {
        ntfyTopicUrl: null,
        ntfyAuthToken: null,
        ntfyEnabled: true,
        alertEmailTo: null,
        smtpHost: null,
        smtpPort: null,
        smtpUser: null,
        smtpPassword: null,
        smtpFrom: null,
        emailAlertsEnabled: true,
        webPushEnabled: false,
        userId: "user-owner",
      },
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
      {
        ntfyTopicUrl: "https://ntfy.sh/x",
        ntfyAuthToken: null,
        ntfyEnabled: true,
        alertEmailTo: null,
        smtpHost: null,
        smtpPort: null,
        smtpUser: null,
        smtpPassword: null,
        smtpFrom: null,
        emailAlertsEnabled: true,
        webPushEnabled: false,
        userId: "user-owner",
      },
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
      {
        ntfyTopicUrl: null,
        ntfyAuthToken: null,
        ntfyEnabled: true,
        alertEmailTo: "moi@example.com",
        smtpHost: null,
        smtpPort: null,
        smtpUser: null,
        smtpPassword: null,
        smtpFrom: null,
        emailAlertsEnabled: true,
        webPushEnabled: false,
        userId: "user-owner",
      },
      "title",
      "body"
    );
    expect(sendMailMock).not.toHaveBeenCalled();

    // Everything required set - must send.
    await dispatchAlert(
      {
        ntfyTopicUrl: null,
        ntfyAuthToken: null,
        ntfyEnabled: true,
        alertEmailTo: "moi@example.com",
        smtpHost: "smtp.example.com",
        smtpPort: 587,
        smtpUser: null,
        smtpPassword: null,
        smtpFrom: "finalibaba@example.com",
        emailAlertsEnabled: true,
        webPushEnabled: false,
        userId: "user-owner",
      },
      "title",
      "body"
    );
    expect(sendMailMock).toHaveBeenCalledTimes(1);
  });

  it("skips ntfy when configured but disabled via ntfyEnabled: false", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await dispatchAlert(
      {
        ntfyTopicUrl: "https://ntfy.sh/x",
        ntfyAuthToken: null,
        ntfyEnabled: false,
        alertEmailTo: null,
        smtpHost: null,
        smtpPort: null,
        smtpUser: null,
        smtpPassword: null,
        smtpFrom: null,
        emailAlertsEnabled: true,
        webPushEnabled: false,
        userId: "user-owner",
      },
      "title",
      "body"
    );

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips email when fully configured but disabled via emailAlertsEnabled: false", async () => {
    sendMailMock.mockResolvedValue({});

    await dispatchAlert(
      {
        ntfyTopicUrl: null,
        ntfyAuthToken: null,
        ntfyEnabled: true,
        alertEmailTo: "moi@example.com",
        smtpHost: "smtp.example.com",
        smtpPort: 587,
        smtpUser: null,
        smtpPassword: null,
        smtpFrom: "finalibaba@example.com",
        emailAlertsEnabled: false,
        webPushEnabled: false,
        userId: "user-owner",
      },
      "title",
      "body"
    );

    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("sends to both channels when both are configured and enabled", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    sendMailMock.mockResolvedValue({});

    await dispatchAlert(
      {
        ntfyTopicUrl: "https://ntfy.sh/x",
        ntfyAuthToken: null,
        ntfyEnabled: true,
        alertEmailTo: "moi@example.com",
        smtpHost: "smtp.example.com",
        smtpPort: 587,
        smtpUser: null,
        smtpPassword: null,
        smtpFrom: "finalibaba@example.com",
        emailAlertsEnabled: true,
        webPushEnabled: false,
        userId: "user-owner",
      },
      "title",
      "body"
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sendMailMock).toHaveBeenCalledTimes(1);
  });
});

describe("sendWebPush", () => {
  const sub = { id: "sub1", endpoint: "https://push.example/x", p256dh: "p256dh-key", auth: "auth-key" };

  it("returns false without sending when there are no subscriptions", async () => {
    findManyMock.mockResolvedValueOnce([]);
    const ok = await sendWebPush("user-owner", "title", "body");
    expect(ok).toBe(false);
    expect(sendNotificationMock).not.toHaveBeenCalled();
  });

  it("sends to every subscription and returns true when at least one succeeds", async () => {
    findManyMock.mockResolvedValueOnce([sub]);
    sendNotificationMock.mockResolvedValueOnce({});
    const ok = await sendWebPush("user-owner", "Alerte", "Corps du message");
    expect(ok).toBe(true);
    expect(setVapidDetailsMock).toHaveBeenCalledWith(expect.any(String), "pub", "priv");
    const [subscriptionArg, payload] = sendNotificationMock.mock.calls[0];
    expect(subscriptionArg).toEqual({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } });
    expect(JSON.parse(payload)).toEqual({ title: "Alerte", body: "Corps du message" });
    expect(deleteManyMock).not.toHaveBeenCalled();
  });

  it("prunes a subscription the push service reports as gone (410) instead of treating it as a hard failure", async () => {
    findManyMock.mockResolvedValueOnce([sub]);
    sendNotificationMock.mockRejectedValueOnce(new MockWebPushError(410));
    const ok = await sendWebPush("user-owner", "title", "body");
    expect(ok).toBe(false);
    expect(deleteManyMock).toHaveBeenCalledWith({ where: { id: { in: [sub.id] } } });
  });

  it("logs and does not prune on a non-410/404 error", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    findManyMock.mockResolvedValueOnce([sub]);
    sendNotificationMock.mockRejectedValueOnce(new MockWebPushError(500));
    const ok = await sendWebPush("user-owner", "title", "body");
    expect(ok).toBe(false);
    expect(deleteManyMock).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe("dispatchAlert - web push channel", () => {
  it("dispatches web push when the channel is enabled", async () => {
    findManyMock.mockResolvedValueOnce([{ id: "s1", endpoint: "https://push.example/y", p256dh: "p", auth: "a" }]);
    sendNotificationMock.mockResolvedValueOnce({});

    await dispatchAlert(
      {
        ntfyTopicUrl: null,
        ntfyAuthToken: null,
        ntfyEnabled: true,
        alertEmailTo: null,
        smtpHost: null,
        smtpPort: null,
        smtpUser: null,
        smtpPassword: null,
        smtpFrom: null,
        emailAlertsEnabled: true,
        webPushEnabled: true,
        userId: "user-owner",
      },
      "title",
      "body"
    );

    expect(sendNotificationMock).toHaveBeenCalledTimes(1);
  });

  it("skips web push entirely when webPushEnabled is false", async () => {
    await dispatchAlert(
      {
        ntfyTopicUrl: null,
        ntfyAuthToken: null,
        ntfyEnabled: true,
        alertEmailTo: null,
        smtpHost: null,
        smtpPort: null,
        smtpUser: null,
        smtpPassword: null,
        smtpFrom: null,
        emailAlertsEnabled: true,
        webPushEnabled: false,
        userId: "user-owner",
      },
      "title",
      "body"
    );

    expect(findManyMock).not.toHaveBeenCalled();
    expect(sendNotificationMock).not.toHaveBeenCalled();
  });
});
