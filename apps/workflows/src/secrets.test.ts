/**
 * Regression tests for the secrets write-gate (slice C).
 */
import { describe, expect, test } from "bun:test";
import { assertNoSecrets, redactDeep, scanForSecrets, SecretsGateError } from "./secrets.js";

describe("scanForSecrets", () => {
  test("flags nothing on clean payloads", () => {
    expect(scanForSecrets({ summary: "all green", exitCode: 0 })).toEqual([]);
    expect(scanForSecrets("plain text output")).toEqual([]);
    expect(scanForSecrets(42)).toEqual([]);
  });

  test("flags credential-shaped values recursively with paths", () => {
    const findings = scanForSecrets({
      output: "build failed",
      extra: { key: `${["sk","ant"].join("-")}-abcdef1234567890` },
    });
    expect(findings.length).toBe(1);
    expect(findings[0].path).toBe("$.extra.key");
    expect(findings[0].detector).toBeTruthy();
  });

  test("flags credential values in a plain string", () => {
    expect(scanForSecrets(`token is ${["npm", "_"].join("")}abcdefghijklmnopqrstuvwxyz0123 end`).length).toBe(1);
    expect(scanForSecrets(`key ${["ghp", "_"].join("")}abcdefghijklmnopqrstuvwxyz0123 end`).length).toBe(1);
  });

  test("flags the quoted-key shape (token/apiKey/client_secret fields)", () => {
    const findings = scanForSecrets({ apiKey: "whatever-value", token: "x", client_secret: "y" });
    const detectors = findings.map((f) => f.detector);
    expect(detectors).toContain("credential_key_field");
  });

  test("does not flag the word token in prose", () => {
    expect(scanForSecrets("the auth token was refreshed by the daemon")).toEqual([]);
  });

  test("does not flag short placeholder-ish values", () => {
    expect(scanForSecrets({ apiKey: "REPLACE_ME" })).toEqual([]);
  });
});

describe("assertNoSecrets", () => {
  test("throws SecretsGateError naming the path when a secret shape is present", () => {
    let threw: unknown = null;
    try {
      assertNoSecrets({ out: `${["sk","ant"].join("-")}-abcdef1234567890` }, "node output");
    } catch (err) {
      threw = err;
    }
    expect(threw).toBeInstanceOf(SecretsGateError);
    expect(String(threw)).toContain("node output");
    expect(String(threw)).toContain("$.out");
    expect(String(threw)).not.toContain("sk-ant");
  });

  test("passes silently on clean payloads", () => {
    expect(() => assertNoSecrets({ out: "clean" }, "node output")).not.toThrow();
  });
});

describe("redactDeep", () => {
  test("replaces credential values with a marker, preserving structure", () => {
    const redacted = redactDeep({ a: `${["sk","ant"].join("-")}-abcdef1234567890`, b: [`${["npm","_"].join("")}abcdefghijklmnopqrstuvwxyz0123`], c: "keep" });
    expect(JSON.stringify(redacted)).toContain("REDACTED");
    expect(redacted.c).toBe("keep");
    expect(JSON.stringify(redacted)).not.toContain("abcdef1234567890");
  });

  test("leaves clean payloads untouched", () => {
    expect(redactDeep({ ok: true, out: "fine" })).toEqual({ ok: true, out: "fine" });
  });
});
