import { describe, expect, test } from "bun:test";
import fastUri from "../../vendor/fast-uri/index.js";

describe("bundled fast-uri authority parsing", () => {
  test("rejects literal authority backslashes without rejecting encoded data", () => {
    expect(fastUri.parse("https://attacker.example\\@allowed.example").error).toBe(
      "URI authority must not contain a literal backslash.",
    );
    expect(fastUri.parse("https://attacker.example%5C@allowed.example").error).toBeUndefined();
    expect(fastUri.parse("https://allowed.example/?x=\\value#z\\w").error).toBeUndefined();
  });
});
