import { describe, expect, it } from "vitest";
import { clientIpFromHeaders, trustedProxyCountFromEnv, UNKNOWN_CLIENT } from "@/lib/domain/client-ip";

describe("clientIpFromHeaders - nothing trusted (the default)", () => {
  it("ignores X-Forwarded-For, whatever it says", () => {
    expect(clientIpFromHeaders({ "x-forwarded-for": "203.0.113.5" }, 0)).toBe(UNKNOWN_CLIENT);
  });

  it("ignores X-Real-IP too", () => {
    expect(clientIpFromHeaders({ "x-real-ip": "203.0.113.9" }, 0)).toBe(UNKNOWN_CLIENT);
  });

  it("treats a nonsensical proxy count as zero", () => {
    expect(clientIpFromHeaders({ "x-forwarded-for": "203.0.113.5" }, -2)).toBe(UNKNOWN_CLIENT);
    expect(clientIpFromHeaders({ "x-forwarded-for": "203.0.113.5" }, 1.5)).toBe(UNKNOWN_CLIENT);
  });
});

describe("clientIpFromHeaders - behind trusted proxies", () => {
  it("one proxy: the entry it appended, not the one the client wrote first", () => {
    // Client forged "198.51.100.66"; Nginx appended the real peer.
    const headers = { "x-forwarded-for": "198.51.100.66, 203.0.113.5" };
    expect(clientIpFromHeaders(headers, 1)).toBe("203.0.113.5");
  });

  it("a forged prefix cannot change the result, however long", () => {
    const real = "203.0.113.5";
    for (const forged of ["1.1.1.1", "1.1.1.1, 2.2.2.2", "9.9.9.9, 8.8.8.8, 7.7.7.7"]) {
      expect(clientIpFromHeaders({ "x-forwarded-for": `${forged}, ${real}` }, 1)).toBe(real);
    }
  });

  it("two proxies (CDN then Nginx): the client as seen by the outer one", () => {
    // forged, client (added by CDN), CDN edge (added by Nginx)
    const headers = { "x-forwarded-for": "198.51.100.66, 203.0.113.5, 172.70.1.1" };
    expect(clientIpFromHeaders(headers, 2)).toBe("203.0.113.5");
  });

  it("a chain shorter than the proxy count falls back to its first entry", () => {
    expect(clientIpFromHeaders({ "x-forwarded-for": "203.0.113.5" }, 3)).toBe("203.0.113.5");
  });

  it("reads X-Real-IP only when no chain is present", () => {
    expect(clientIpFromHeaders({ "x-real-ip": "203.0.113.9" }, 1)).toBe("203.0.113.9");
    expect(
      clientIpFromHeaders({ "x-forwarded-for": "198.51.100.66, 203.0.113.5", "x-real-ip": "203.0.113.9" }, 1)
    ).toBe("203.0.113.5");
  });

  it("joins a header delivered as an array, in order", () => {
    expect(clientIpFromHeaders({ "x-forwarded-for": ["198.51.100.66", "203.0.113.5"] }, 1)).toBe("203.0.113.5");
  });

  it("accepts IPv6", () => {
    expect(clientIpFromHeaders({ "x-forwarded-for": "2001:db8::1" }, 1)).toBe("2001:db8::1");
  });

  it("refuses a value that is not an address, rather than using it as a bucket key", () => {
    expect(clientIpFromHeaders({ "x-forwarded-for": "not-an-ip" }, 1)).toBe(UNKNOWN_CLIENT);
    expect(clientIpFromHeaders({ "x-forwarded-for": "   " }, 1)).toBe(UNKNOWN_CLIENT);
    expect(clientIpFromHeaders(undefined, 1)).toBe(UNKNOWN_CLIENT);
  });
});

describe("trustedProxyCountFromEnv", () => {
  it.each([
    [undefined, 0],
    ["", 0],
    ["abc", 0],
    ["-1", 0],
    ["0", 0],
    ["1", 1],
    ["2", 2],
  ])("%s -> %s", (raw, expected) => {
    expect(trustedProxyCountFromEnv(raw)).toBe(expected);
  });
});
