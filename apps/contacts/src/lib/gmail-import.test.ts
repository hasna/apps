import { describe, test, expect } from "bun:test";
import { parseAddressHeader } from "./gmail-import.js";

describe("parseAddressHeader", () => {
  test("parses Name <email> format", () => {
    const results = parseAddressHeader("Alice Smith <alice@example.com>");
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ name: "Alice Smith", email: "alice@example.com" });
  });

  test("parses bare email", () => {
    const results = parseAddressHeader("bob@example.com");
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ name: "", email: "bob@example.com" });
  });

  test("parses <email> without name", () => {
    const results = parseAddressHeader("<carol@example.com>");
    expect(results).toHaveLength(1);
    expect(results[0]!.email).toBe("carol@example.com");
  });

  test("parses comma-separated addresses", () => {
    const results = parseAddressHeader(
      "Alice <alice@a.com>, Bob <bob@b.com>, carol@c.com"
    );
    expect(results).toHaveLength(3);
    expect(results[0]!.email).toBe("alice@a.com");
    expect(results[1]!.email).toBe("bob@b.com");
    expect(results[2]!.email).toBe("carol@c.com");
  });

  test("strips quotes from name", () => {
    const results = parseAddressHeader('"Dave Jones" <dave@example.com>');
    expect(results[0]!.name).toBe("Dave Jones");
  });

  test("normalizes email to lowercase", () => {
    const results = parseAddressHeader("TEST@EXAMPLE.COM");
    expect(results[0]!.email).toBe("test@example.com");
  });

  test("ignores addresses without @", () => {
    const results = parseAddressHeader("not-an-email");
    expect(results).toHaveLength(0);
  });

  test("handles empty string", () => {
    expect(parseAddressHeader("")).toHaveLength(0);
  });

  test("handles display names with commas inside quotes", () => {
    const results = parseAddressHeader('"Smith, Alice" <alice@example.com>');
    expect(results).toHaveLength(1);
    expect(results[0]!.email).toBe("alice@example.com");
  });
});
