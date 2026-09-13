import { useDefaultTestTimeout } from "../test-preload.js";
useDefaultTestTimeout();
import { expect, test } from "bun:test";
import { createSkillsFetchHandler } from "./app.js";
import { MemorySkillsStore } from "./store.js";
import type { RuntimeService } from "./runtime-api.js";

test("gateway aliases expose runtime capability and enforce API scopes before admission", async () => {
  const store = new MemorySkillsStore();
  store.addApiKey("fixture-runtime-admin");
  store.addApiKey("fixture-runtime-reader", { scopes: ["skills:read"] });
  const fetch = await createSkillsFetchHandler({ store, runtime: null, config: { databaseUrl: "memory:", allowEphemeralStore: true } });
  const call = (path: string, token?: string, method = "GET") => fetch(new Request(`https://skills.example/v1/${path}`, { method, headers: token ? { authorization: `Bearer ${token}` } : {} }));
  try {
    expect((await call("executions/pdf-generate", undefined, "POST")).status).toBe(401);
    expect((await call("executions/pdf-generate", "fixture-runtime-reader", "POST")).status).toBe(403);
    expect((await call("executions/pdf-generate", "fixture-runtime-admin", "POST")).status).toBe(503);
    expect(await (await call("capabilities", "fixture-runtime-reader")).json()).toMatchObject({ cloudExecution: false, profileResolution: true });
    const callback = await call("runtime/run_missing/work");
    expect(callback.status).toBe(404);
    expect(await callback.json()).toMatchObject({ code: "RUNTIME_ROUTE_NOT_FOUND" });
  } finally { await fetch.close(); }
});

test("worker callbacks use scoped runtime auth while other API paths still require API credentials", async () => {
  const store = new MemorySkillsStore();
  store.addApiKey("fixture-runtime-admin");
  const runtime = { store: { job: async () => null } } as unknown as RuntimeService;
  const fetch = await createSkillsFetchHandler({ store, runtime, config: { databaseUrl: "memory:", allowEphemeralStore: true } });
  try {
    const callback = await fetch(new Request("https://skills.example/v1/runtime/run_unknown/work"));
    expect(callback.status).toBe(401);
    expect((await callback.json() as { code: string }).code).not.toBe("AUTH_REQUIRED");
    expect((await fetch(new Request("https://skills.example/v1/skills"))).status).toBe(401);
    const capability = await fetch(new Request("https://skills.example/v1/capabilities", { headers: { authorization: "Bearer fixture-runtime-admin" } }));
    expect(await capability.json()).toMatchObject({ cloudExecution: true, capabilities: expect.arrayContaining(["skills.cloud-execution"]) });
  } finally { await fetch.close(); }
});
