import { describe, it, expect } from "bun:test";
import { formatTokens } from "./economy.js";

describe("formatTokens", () => {
  it("formats small numbers", () => {
    expect(formatTokens(42)).toBe("42");
  });

  it("formats thousands", () => {
    expect(formatTokens(1500)).toBe("1.5K");
  });

  it("formats millions", () => {
    expect(formatTokens(2500000)).toBe("2.5M");
  });
});
