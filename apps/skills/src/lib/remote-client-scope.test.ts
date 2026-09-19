import { expect, test } from "bun:test";
import { RemoteSkillsClient } from "./remote-client.js";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

test("scope admission projects only the bounded safe response and rejects extra scopes", async () => {
  let calls = 0;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch() {
    calls += 1;
    if (calls === 2) return Response.json({ keyId: "key_target", orgId: "org_dev", scopes: ["skills:read", "skills:publish", "evil:capability"], updated: true });
    return Response.json({ keyId: "key_target", orgId: "org_dev", scopes: ["skills:read", "skills:publish"], updated: true, token: "MUST_NOT_PRINT", nested: { secret: "MUST_NOT_PRINT" } });
  } });
  try {
    const client = new RemoteSkillsClient("fixture", `http://127.0.0.1:${server.port}/api/v1`);
    await expect(client.addSkillPublishScope("key_target", ["skills:read"], "org_dev")).resolves.toEqual({ keyId: "key_target", orgId: "org_dev", scopes: ["skills:read", "skills:publish"], updated: true });
    await expect(client.addSkillPublishScope("key_target/extra", ["skills:read"], "org_dev")).rejects.toThrow("Invalid API key id");
    const extra = new RemoteSkillsClient("fixture", `http://127.0.0.1:${server.port}/api/v1`);
    await expect(extra.addSkillPublishScope("key_target", ["skills:read"], "org_dev")).rejects.toThrow("did not preserve");
  } finally { server.stop(true); }
});

test("scope admission refuses an oversized JSON response before parsing", async () => {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch() {
    return new Response(JSON.stringify({ keyId: "key_target", orgId: "org_dev", scopes: ["skills:read", "skills:publish"], updated: true, padding: "x".repeat(70_000) }), { headers: { "content-type": "application/json" } });
  } });
  try {
    const client = new RemoteSkillsClient("fixture", `http://127.0.0.1:${server.port}/api/v1`);
    await expect(client.addSkillPublishScope("key_target", ["skills:read"], "org_dev")).rejects.toThrow("Invalid API key scope update response");
  } finally { server.stop(true); }
});
