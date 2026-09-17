import { expect, test } from "bun:test";
import { verifyClientCredential } from "./verify-client-key.js";
import { randomBytes } from "node:crypto";
import { mintApiKey } from "@hasna/contracts/auth";
import { createTrashHandler } from "../../src/api/service.js";
import { VERSION } from "../../src/version.js";
const key = "fixture-credential-".repeat(5);
const valid = { app: "trash", version: "0.1.1", listLimit: { default: 20, max: 100 } };
test("deployment verifier accepts the real handler's Contracts authentication responses", async () => {
  const signingSecret = randomBytes(32);
  const minted = mintApiKey({ app: "trash", signingSecret, tid: "fixture", agent: "deploy-probe", scopes: ["trash:read"] });
  const store = {
    authQueryClient: () => ({ get: async () => ({ kid: minted.kid, scopes: ["trash:read"], revoked_at: null, expires_at: null }) }),
    stationForKey: async () => null,
  };
  const handler = createTrashHandler(store as any, {} as any, { signingSecret });
  const codes: Array<string | null> = [];
  const result = await verifyClientCredential(minted.token, VERSION, async (url, init) => {
    const response = await handler(new Request(url.replace("/trash/v1/", "/v1/"), init));
    codes.push((await response.clone().json() as any).error?.code ?? null);
    return response;
  });
  expect(codes).toEqual(["missing_token", "malformed", null]);
  expect(result.authenticated).toBe(true);
});
test("deployment acceptance proves anonymous, invalid and exact client authentication", async () => {
  const requests: RequestInit[] = [];
  const result = await verifyClientCredential(key, "0.1.1", async (url, init) => {
    expect(String(url)).toBe("https://api.hasna.com/trash/v1/status");
    expect(init?.redirect).toBe("error"); expect(init?.signal).toBeDefined(); requests.push(init!);
    const auth = new Headers(init?.headers).get("authorization");
    return Response.json(auth === `Bearer ${key}` ? valid : { error: { code: auth === null ? "missing_token" : "malformed" } }, { status: auth === `Bearer ${key}` ? 200 : 401 });
  });
  expect(requests.length).toBe(3); expect(result.authenticated).toBe(true);
  expect(JSON.stringify(result)).not.toContain(key);
});
test("a successful anonymous or invalid request never counts as acceptance", async () => {
  for (const failedStep of [0, 1]) {
    let count = 0;
    await expect(verifyClientCredential(key, "0.1.1", async () => {
      const n = count++; return Response.json(n === failedStep ? valid : { error: { code: n === 0 ? "missing_token" : "malformed" } }, { status: n === failedStep ? 200 : 401 });
    })).rejects.toThrow("Client acceptance failed");
    expect(count).toBe(failedStep + 1);
  }
});
test("wrong version, revoked key, oversized and malformed bodies fail without exposing upstream details", async () => {
  for (const response of [Response.json({ ...valid, version: "0.1.0" }), Response.json({ error: { code: "auth_revoked" } }, { status: 401 }), new Response("x".repeat(65537)), new Response("{"), Response.json({ ...valid, app: "other", detail: key })]) {
    let n = 0;
    try {
      await verifyClientCredential(key, "0.1.1", async () => { const step = n++; return step < 2 ? Response.json({ error: { code: step === 0 ? "missing_token" : "malformed" } }, { status: 401 }) : response; });
      throw new Error("unexpected acceptance");
    } catch (error) { expect(String(error)).toBe("Error: Client acceptance failed."); expect(String(error)).not.toContain(key); }
  }
});
