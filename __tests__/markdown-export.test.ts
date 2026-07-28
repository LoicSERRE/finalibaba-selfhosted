import { describe, expect, it } from "vitest";
import { fmt, sign } from "@/lib/markdown-export";

describe("fmt", () => {
  it("formats cents as euros with 0 decimals by default", () => {
    const out = fmt(123_456);
    expect(out).toContain("1");
    expect(out).toContain("235"); // rounds 1234.56 -> 1235
    expect(out).toContain("€");
  });

  it("respects the decimals parameter", () => {
    expect(fmt(123_456, 2)).toContain("234,56");
  });

  it("renders negative amounts with a leading minus", () => {
    expect(fmt(-5000, 0)).toContain("-50");
  });
});

describe("sign", () => {
  it("returns '+' for positive numbers and 0", () => {
    expect(sign(5)).toBe("+");
    expect(sign(0)).toBe("+");
  });

  it("returns an empty string for negative numbers (the minus comes from the number itself)", () => {
    expect(sign(-5)).toBe("");
  });
});
