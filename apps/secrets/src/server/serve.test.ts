import { describe, it, expect } from "bun:test";
import { createHandler, type ServeDeps } from "./serve.js";

// Regression for `set --ttl` (cloud): the POST /v1/secrets route must accept an
// absolute ISO `expires_at` (what Store-contract clients send) AND stay
// backward-compatible with a `ttl` duration like "30d" (raw API callers).

function makeDeps(capture: { expiresAt?: string | undefined }): ServeDeps {
  const store = {
    async setSecret(
      key: string,
      _value: string,
      type: string,
      label: string | undefined,
      expiresAt: string | undefined,
      _actor: string,
    ) {
      capture.expiresAt = expiresAt;
      return { key, value: "v", type, label, expires_at: expiresAt, created_at: "", updated_at: "" };
    },
  };
  const verifier = {
    async authenticate() {
      return { ok: true as const, principal: { agent: "tester", kid: "k1" } };
    },
  };
  return {
    client: {} as ServeDeps["client"],
    store: store as unknown as ServeDeps["store"],
    verifier: verifier as unknown as ServeDeps["verifier"],
  };
}

function post(body: unknown): Request {
  return new Request("https://secrets.hasna.xyz/v1/secrets", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer x" },
    body: JSON.stringify(body),
  });
}

describe("POST /v1/secrets expiry parsing", () => {
  it("accepts an absolute ISO expires_at and forwards it verbatim", async () => {
    const iso = new Date(Date.now() + 30 * 86_400_000).toISOString();
    const capture: { expiresAt?: string } = {};
    const res = await createHandler(makeDeps(capture))(post({ key: "a/b", value: "v", type: "api_key", expires_at: iso }));
    expect(res.status).toBe(200);
    expect(capture.expiresAt).toBe(iso);
  });

  it("still accepts a ttl duration (backward compat) and resolves it to a future ISO", async () => {
    const capture: { expiresAt?: string } = {};
    const res = await createHandler(makeDeps(capture))(post({ key: "a/b", value: "v", ttl: "30d" }));
    expect(res.status).toBe(200);
    expect(capture.expiresAt).toBeString();
    expect(Date.parse(capture.expiresAt!)).toBeGreaterThan(Date.now());
  });

  it("rejects a malformed expires_at with 400 instead of 500", async () => {
    const capture: { expiresAt?: string } = {};
    const res = await createHandler(makeDeps(capture))(post({ key: "a/b", value: "v", expires_at: "not-a-date" }));
    expect(res.status).toBe(400);
    expect(capture.expiresAt).toBeUndefined();
  });
});
