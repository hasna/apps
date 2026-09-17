import { expect, test } from "bun:test";
import { verifyClientCredential } from "./verify-client-key.js";
const key = "fixture-credential-".repeat(5);
const valid = { app: "trash", version: "0.1.1", listLimit: { default: 20, max: 100 } };
test("deployment acceptance proves anonymous, invalid and exact client authentication", async () => {
  const requests: RequestInit[] = [];
  const result = await verifyClientCredential(key, "0.1.1", async (url, init) => {
    expect(String(url)).toBe("https://api.hasna.com/trash/v1/status");
    expect(init?.redirect).toBe("error"); expect(init?.signal).toBeDefined(); requests.push(init!);
    const auth = new Headers(init?.headers).get("authorization");
    return Response.json(auth === `Bearer ${key}` ? valid : { error: { code: "auth_required" } }, { status: auth === `Bearer ${key}` ? 200 : 401 });
  });
  expect(requests.length).toBe(3); expect(result.authenticated).toBe(true);
  expect(JSON.stringify(result)).not.toContain(key);
});
test("a successful anonymous or invalid request never counts as acceptance", async () => {
  for (const failedStep of [0, 1]) {
    let count = 0;
    await expect(verifyClientCredential(key, "0.1.1", async () => {
      const n = count++; return Response.json(n === failedStep ? valid : { error: { code: "auth_required" } }, { status: n === failedStep ? 200 : 401 });
    })).rejects.toThrow("Client acceptance failed");
    expect(count).toBe(failedStep + 1);
  }
});
test("wrong version, revoked key, oversized and malformed bodies fail without exposing upstream details", async () => {
  for (const response of [Response.json({ ...valid, version: "0.1.0" }), Response.json({ error: { code: "auth_revoked" } }, { status: 401 }), new Response("x".repeat(65537)), new Response("{"), Response.json({ ...valid, app: "other", detail: key })]) {
    let n = 0;
    try {
      await verifyClientCredential(key, "0.1.1", async () => n++ < 2 ? Response.json({ error: { code: "auth_required" } }, { status: 401 }) : response);
      throw new Error("unexpected acceptance");
    } catch (error) { expect(String(error)).toBe("Error: Client acceptance failed."); expect(String(error)).not.toContain(key); }
  }
});
