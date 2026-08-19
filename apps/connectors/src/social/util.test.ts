import { describe, test, expect } from "bun:test";
import { decodeBase64 } from "./util.js";

describe("decodeBase64", () => {
  test("decodes valid base64 back to its bytes", () => {
    const buf = decodeBase64(Buffer.from("hello world").toString("base64"));
    expect(buf.toString("utf8")).toBe("hello world");
  });

  test("decodes binary payloads byte-exactly (not just ASCII)", () => {
    const bytes = new Uint8Array([0, 1, 2, 127, 128, 255, 10]);
    const roundtrip = decodeBase64(Buffer.from(bytes).toString("base64"));
    expect(Buffer.from(roundtrip).equals(Buffer.from(bytes))).toBe(true);
  });

  test("rejects the empty string — a silent empty upload is a data-loss path", () => {
    expect(() => decodeBase64("")).toThrow(
      "media.upload requires a non-empty base64 string in `dataBase64`",
    );
  });

  test("rejects non-string input even when it is falsy or Buffer-like", () => {
    expect(() => decodeBase64(undefined as unknown as string)).toThrow(/non-empty base64/);
    expect(() => decodeBase64(null as unknown as string)).toThrow(/non-empty base64/);
    expect(() => decodeBase64(Buffer.alloc(0) as unknown as string)).toThrow(/non-empty base64/);
  });

  test("whitespace-only input is not rejected (base64 ignores whitespace) — documents the lenient edge", () => {
    // Buffer.from("   ", "base64") is an empty buffer and never throws; only the
    // explicit empty/non-string guards fire. This test pins that boundary so a
    // future hardening change is visible.
    const buf = decodeBase64("   ");
    expect(buf.length).toBe(0);
  });
});
