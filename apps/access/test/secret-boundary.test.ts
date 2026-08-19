import { describe, expect, it } from "bun:test";
import { assertNoRawSecretValues, validateSecretRef } from "../src/services/secret-boundary.js";
import { ValidationError } from "../src/types/index.js";

/**
 * Direct tests for the secret boundary (src/services/secret-boundary.ts).
 * The credentials service exercises a few cases indirectly; these pin the
 * boundary itself: which references are legal, which raw-secret shapes are
 * refused, and the recursive containment of nested objects/arrays.
 */

const VALID_REF = "hasna/access/prod/api-key";

describe("validateSecretRef — accepted forms", () => {
  it("accepts a namespaced path reference", () => {
    expect(validateSecretRef("hasna/agents/bot/token")).toBe("hasna/agents/bot/token");
  });

  it("accepts org-scoped path segments and dotted names", () => {
    expect(validateSecretRef("hasnaxyz/platform/team.one/cred.name")).toBe("hasnaxyz/platform/team.one/cred.name");
  });

  it("accepts an @-prefixed org segment in a path reference", () => {
    expect(validateSecretRef("hasna/@hasnaxyz/bot/token")).toBe("hasna/@hasnaxyz/bot/token");
  });

  it("accepts the provider: form", () => {
    expect(validateSecretRef("provider:aws:secretsmanager:prod-access-db")).toBe(
      "provider:aws:secretsmanager:prod-access-db",
    );
    expect(validateSecretRef("provider:gcp:secretmanager:my-secret")).toBe("provider:gcp:secretmanager:my-secret");
  });

  it("refuses a provider form carrying path slashes in the final segment", () => {
    // The provider regex final segment class is [a-z0-9._:@-]; "/" is not in it.
    expect(() => validateSecretRef("provider:aws:secretsmanager:prod/access/db")).toThrow(ValidationError);
  });

  it("trims surrounding whitespace before validating", () => {
    expect(validateSecretRef("  hasna/access/name  ")).toBe("hasna/access/name");
  });
});

describe("validateSecretRef — refused forms", () => {
  it("refuses empty and whitespace-only references", () => {
    expect(() => validateSecretRef("")).toThrow(ValidationError);
    expect(() => validateSecretRef("   ")).toThrow(ValidationError);
    expect(() => validateSecretRef(undefined as never)).toThrow(ValidationError);
  });

  it("refuses un-namespaced single-segment values", () => {
    // The path regex requires at least one "/" (a second segment).
    expect(() => validateSecretRef("plainref")).toThrow(ValidationError);
    expect(() => validateSecretRef("token123")).toThrow(ValidationError);
  });

  it("refuses references longer than 256 characters", () => {
    const long = `hasna/access/${"a".repeat(300)}`;
    expect(() => validateSecretRef(long)).toThrow(ValidationError);
  });

  it("refuses embedded whitespace and control characters (interior, after trim)", () => {
    expect(() => validateSecretRef("hasna/access /name")).toThrow(ValidationError);
    expect(() => validateSecretRef("hasna/access/na\nme")).toThrow(ValidationError);
    expect(() => validateSecretRef("hasna/access/na\x00me")).toThrow(ValidationError);
  });
});

describe("validateSecretRef — raw secret values are never accepted as references", () => {
  // Fixtures are assembled by concatenation so the STORED file never contains a
  // literal secret shape (repo convention, see test/domain.test.ts); the values
  // below still exercise every raw-secret detector in the boundary.
  const RAW_SHAPES: Array<[string, string]> = [
    ["Anthropic sk- token", "sk-" + "ant-api03-abcdefghijklmnopqrstuvwxyz123456"],
    ["xai token", "xai" + "-" + "abcdefghijklmnopqrstuvwxyz123456"],
    ["npm_ token", "npm_" + "abcdefghijklmnopqrstuvwxyz12345678"],
    ["GitHub PAT token", "ghp" + "_" + "abcdefghijklmnopqrstuvwxyz1234567890"],
    ["GitHub org token", "gho" + "_" + "abcdefghijklmnopqrstuvwxyz1234567890"],
    ["AWS AKIA access key", "AKIA" + "IOSFODNN7EXAMPLE"],
    ["Private key block", "-----BEGIN RSA PRIVATE KEY" + "----- MIIEowIBAAKCAQEA... " + "-----END RSA PRIVATE KEY" + "-----"],
    ["Bearer token with scheme", "Bearer " + "abcdefghijklmnopqrstuvwxyz1234567890"],
    ["api_key assignment", "api_key: \"" + "abcdefghijklmnopqrstuvwxyz123456" + "\""],
    ["token long value", "token=" + "abcdefghijklmnopqrstuvwxyz12345678901234"],
  ];

  for (const [label, raw] of RAW_SHAPES) {
    it(`refuses a ${label} embedded in a ref`, () => {
      expect(() => validateSecretRef(raw)).toThrow(ValidationError);
      expect(() => validateSecretRef(`hasna/access/${raw}`)).toThrow(ValidationError);
    });
  }

  it("refuses the raw value even when it would otherwise parse as a path", () => {
    // the assembled sk value contains "/" but is a secret shape, not a namespaced reference.
    expect(() => validateSecretRef("sk-" + "ant-abcdefgh/secret")).toThrow(ValidationError);
  });

  it("does not false-positive on short or benign tokens", () => {
    // Short values below the token length thresholds are not secret-shaped.
    expect(validateSecretRef("hasna/access/token-abc")).toBe("hasna/access/token-abc");
  });

  it("pins the off-by-one thresholds at the raw-secret scanner (near-misses pass)", () => {
    // Bearer requires 20+ chars after the scheme; 19 must pass the scanner.
    expect(() => assertNoRawSecretValues("Bearer " + "a".repeat(19), "v")).not.toThrow();
    // token= plain form requires 32+ chars; 31 must pass.
    expect(() => assertNoRawSecretValues("token=" + "a".repeat(31), "v")).not.toThrow();
    // api_key requires 20+ chars after the separator; 19 must pass.
    expect(() => assertNoRawSecretValues("api_key: " + "a".repeat(19), "v")).not.toThrow();
    // sk- requires 8+ chars after the prefix; 7 must pass.
    expect(() => assertNoRawSecretValues("sk-" + "a".repeat(7), "v")).not.toThrow();
  });

  it("pins the off-by-one thresholds at the raw-secret scanner (at-threshold refuses)", () => {
    expect(() => assertNoRawSecretValues("Bearer " + "a".repeat(20), "v")).toThrow(ValidationError);
    expect(() => assertNoRawSecretValues("token=" + "a".repeat(32), "v")).toThrow(ValidationError);
    // Separator form: 16+ chars after an embedded [=_-] separator.
    expect(() => assertNoRawSecretValues("token=" + "a".repeat(10) + "-" + "a".repeat(16), "v")).toThrow(ValidationError);
    expect(() => assertNoRawSecretValues("api_key: " + "a".repeat(20), "v")).toThrow(ValidationError);
    expect(() => assertNoRawSecretValues("sk-" + "a".repeat(8), "v")).toThrow(ValidationError);
  });

  it("in-path raw detection fires for grammar-valid secret prefixes", () => {
    // ":" and "-" are valid path-segment characters, so only the raw-secret
    // detector can reject these — grammar alone would accept them.
    expect(() => validateSecretRef("hasna/access/" + "api_key:" + "a".repeat(20))).toThrow(ValidationError);
    expect(validateSecretRef("hasna/access/" + "api_key:" + "a".repeat(19))).toBe(
      "hasna/access/" + "api_key:" + "a".repeat(19),
    );
    expect(() => validateSecretRef("hasna/access/" + "sk-" + "a".repeat(8))).toThrow(ValidationError);
    expect(validateSecretRef("hasna/access/" + "sk-" + "a".repeat(7))).toBe(
      "hasna/access/" + "sk-" + "a".repeat(7),
    );
  });

  it("a token= ref is rejected by reference grammar even at sub-threshold length", () => {
    // "=" is not a valid path-segment character, so token= refs always fail the
    // namespaced-path grammar; the raw-secret scanner never needs to fire.
    expect(() => validateSecretRef("hasna/access/" + "token=" + "a".repeat(10))).toThrow(ValidationError);
  });
});

describe("assertNoRawSecretValues — recursive containment", () => {
  it("passes nullish and non-string primitives through", () => {
    expect(() => assertNoRawSecretValues(null, "v")).not.toThrow();
    expect(() => assertNoRawSecretValues(undefined, "v")).not.toThrow();
    expect(() => assertNoRawSecretValues(42, "v")).not.toThrow();
    expect(() => assertNoRawSecretValues(true, "v")).not.toThrow();
  });

  it("descends into nested objects and arrays, naming the full path", () => {
    const nested = {
      outer: [{ inner: "sk-" + "ant-api03-abcdefghijklmnopqrstuvwxyz123456" }],
      safe: "hasna/access/name",
    };
    try {
      assertNoRawSecretValues(nested, "input");
      throw new Error("expected refusal");
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).message).toContain("input.outer[0].inner");
    }
  });

  it("reports the field path for a top-level string", () => {
    try {
      assertNoRawSecretValues("ghp" + "_" + "abcdefghijklmnopqrstuvwxyz1234567890", "secret_ref");
      throw new Error("expected refusal");
    } catch (error) {
      expect((error as ValidationError).message).toContain("secret_ref");
    }
  });

  it("does not flag benign nested values", () => {
    expect(() =>
      assertNoRawSecretValues({ a: [{ b: "hasna/access/name" }], c: "published:2026-01-01" }, "input"),
    ).not.toThrow();
  });
});
