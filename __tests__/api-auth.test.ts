import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

// The gate on every app/api/v1/* route. What matters here beyond accept/reject
// is that it returns the key's OWNER: since v2.0 each route scopes its queries
// by that userId, and before it existed an API key read the entire instance
// regardless of who minted it.

const { findUniqueMock, updateMock } = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
  updateMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: { apiKey: { findUnique: findUniqueMock, update: updateMock } },
}));

import { authenticateApiKey } from "@/lib/services/api-auth";

const reqWith = (headers: Record<string, string>) =>
  ({ headers: { get: (k: string) => headers[k.toLowerCase()] ?? null } }) as unknown as NextRequest;

beforeEach(() => {
  findUniqueMock.mockReset();
  updateMock.mockReset().mockResolvedValue({});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("authenticateApiKey", () => {
  it("resolves the key and returns its owner", async () => {
    findUniqueMock.mockResolvedValue({ id: "key-1", userId: "user-b" });

    await expect(authenticateApiKey(reqWith({ authorization: "Bearer fnlb_abc" }))).resolves.toEqual({
      id: "key-1",
      userId: "user-b",
    });
    expect(findUniqueMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { token: "fnlb_abc" } })
    );
  });

  it("records lastUsedAt without making the caller wait on it", async () => {
    findUniqueMock.mockResolvedValue({ id: "key-1", userId: "user-b" });

    await authenticateApiKey(reqWith({ authorization: "Bearer fnlb_abc" }));

    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "key-1" } })
    );
  });

  it("still authenticates when the lastUsedAt write fails", async () => {
    // Fire-and-forget by design: bookkeeping must never fail the real request.
    findUniqueMock.mockResolvedValue({ id: "key-1", userId: "user-b" });
    updateMock.mockRejectedValue(new Error("db down"));

    await expect(
      authenticateApiKey(reqWith({ authorization: "Bearer fnlb_abc" }))
    ).resolves.toMatchObject({ userId: "user-b" });
  });

  it("rejects an unknown token", async () => {
    findUniqueMock.mockResolvedValue(null);

    await expect(authenticateApiKey(reqWith({ authorization: "Bearer nope" }))).resolves.toBeNull();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it.each([
    ["no header", {}],
    ["empty bearer", { authorization: "Bearer " }],
    ["wrong scheme", { authorization: "Basic fnlb_abc" }],
    ["bare token, no scheme", { authorization: "fnlb_abc" }],
  ])("rejects %s without hitting the database", async (_label, headers) => {
    await expect(authenticateApiKey(reqWith(headers))).resolves.toBeNull();
    expect(findUniqueMock).not.toHaveBeenCalled();
  });
});
