import { describe, expect, it } from "vitest";
import {
  assertId,
  assertIds,
  assertOptionalId,
  isInvalidActionInput,
  InvalidActionInputError,
} from "@/lib/domain/action-input";

// A Server Action argument typed `string` can arrive as any JSON value, and an
// object passed into a Prisma `where` becomes a filter operator rather than a
// value (the audited operator-injection class). These narrow every id-shaped
// argument to a real string before it can reach a query.

describe("assertId", () => {
  it("returns the trimmed string for a valid id", () => {
    expect(assertId("abc123")).toBe("abc123");
    expect(assertId("  abc  ")).toBe("abc");
  });

  it("rejects a Prisma operator object - the injection payload", () => {
    for (const payload of [{ not: "x" }, { in: ["a", "b"] }, { contains: "" }, { gt: 0 }]) {
      expect(() => assertId(payload)).toThrow(InvalidActionInputError);
    }
  });

  it("rejects every other non-string shape", () => {
    for (const bad of [null, undefined, 1, true, [], ["a"], {}, () => "x"]) {
      expect(() => assertId(bad)).toThrow(InvalidActionInputError);
    }
  });

  it("rejects an empty / whitespace / over-long string", () => {
    expect(() => assertId("")).toThrow();
    expect(() => assertId("   ")).toThrow();
    expect(() => assertId("x".repeat(257))).toThrow();
  });

  it("throws the same opaque message so a probe can't tell a type from a forbidden id", () => {
    expect(() => assertId({ not: "x" })).toThrow("Invalid request.");
  });
});

describe("assertOptionalId", () => {
  it("passes empty values through as null", () => {
    expect(assertOptionalId(null)).toBeNull();
    expect(assertOptionalId(undefined)).toBeNull();
    expect(assertOptionalId("")).toBeNull();
  });

  it("validates a provided value and rejects an object", () => {
    expect(assertOptionalId("abc")).toBe("abc");
    expect(() => assertOptionalId({ not: "x" })).toThrow(InvalidActionInputError);
  });
});

describe("assertIds", () => {
  it("validates and dedupes an array of ids", () => {
    expect(assertIds(["a", "b", "a"])).toEqual(["a", "b"]);
  });

  it("rejects a non-array, and an array hiding an operator object", () => {
    expect(() => assertIds("a")).toThrow(InvalidActionInputError);
    expect(() => assertIds(["a", { not: "x" }])).toThrow(InvalidActionInputError);
  });
});

describe("isInvalidActionInput", () => {
  it("recognises only its own error", () => {
    expect(isInvalidActionInput(new InvalidActionInputError())).toBe(true);
    expect(isInvalidActionInput(new Error("other"))).toBe(false);
  });
});
