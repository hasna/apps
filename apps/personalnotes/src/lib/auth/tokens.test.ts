import { describe, expect, test } from "bun:test";
import { extractBearer, generateToken, hashToken, safeHashEqual, tokenKindOf } from "./tokens.js";

describe("token helpers", () => {
  test("session tokens carry the pn_sess_ prefix, api tokens carry pn_", () => {
    const session = generateToken("session");
    const api = generateToken("api");
    expect(session.token.startsWith("pn_sess_")).toBe(true);
    expect(api.token.startsWith("pn_")).toBe(true);
    expect(api.token.startsWith("pn_sess_")).toBe(false);
  });

  test("tokenKindOf classifies by prefix", () => {
    expect(tokenKindOf(generateToken("session").token)).toBe("session");
    expect(tokenKindOf(generateToken("api").token)).toBe("api");
    expect(tokenKindOf("nope")).toBeNull();
  });

  test("hashToken is deterministic and hides the plaintext", () => {
    const { token, tokenHash } = generateToken("api");
    expect(hashToken(token)).toBe(tokenHash);
    expect(tokenHash).not.toContain(token);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("tokens are unique across calls", () => {
    const a = generateToken("session").token;
    const b = generateToken("session").token;
    expect(a).not.toBe(b);
  });

  test("safeHashEqual compares digests", () => {
    const h = hashToken("x");
    expect(safeHashEqual(h, h)).toBe(true);
    expect(safeHashEqual(h, hashToken("y"))).toBe(false);
  });

  test("extractBearer reads Authorization and X-Api-Key", () => {
    expect(extractBearer(new Headers({ authorization: "Bearer abc" }))).toBe("abc");
    expect(extractBearer(new Headers({ "x-api-key": "pn_key" }))).toBe("pn_key");
    expect(extractBearer(new Headers())).toBeNull();
  });
});
