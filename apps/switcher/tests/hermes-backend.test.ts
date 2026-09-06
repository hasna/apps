import { test, expect } from "bun:test";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { prepareHarnessLaunch } from "../src/harnesses";
import { createHermesBridge } from "../src/hermes-backend";
import type { HarnessLaunchInput } from "../src/harness-types";

const scratch = process.env.SWITCHER_TEST_ROOT ?? join(homedir(), "Workspace", "scratch", "switcher-tests");

async function fixture(overrides: Partial<HarnessLaunchInput> = {}): Promise<HarnessLaunchInput> {
  await mkdir(scratch, { recursive: true });
  const stateDir = await mkdtemp(join(scratch, "hermes-"));
  return {
    harness: "hermes",
    baseUrl: "https://gateway.example/v1",
    protocol: "openai-chat",
    authStyle: "bearer",
    model: "vendor/model",
    models: [{ id: "vendor/model", name: "Fixture", contextWindow: 64_000, maxOutputTokens: 8_000, supportedParameters: ["tools"] }],
    credential: "fixture-key-never-a-real-key",
    stateDir,
    cwd: stateDir,
    version: "Hermes Agent v0.21.0",
    args: [],
    ...overrides,
  };
}

test("Hermes uses a per-launch config and a stable, isolated resume store", async () => {
  const sessionDir = await mkdtemp(join(scratch, "hermes-session-"));
  const input = await fixture({ sessionDir, args: ["--resume", "fixture-session"] });
  try {
    const prepared = await prepareHarnessLaunch(input);
    const config = JSON.parse(await readFile(prepared.configPaths[0], "utf8"));
    expect(prepared.executable).toBe("hermes");
    expect(prepared.args.slice(0, 4)).toEqual(["--provider", "custom", "--model", input.model]);
    expect(prepared.args.slice(4)).toEqual(["--resume", "fixture-session"]);
    expect(prepared.env.HERMES_HOME).toBe(input.stateDir);
    expect(config.model).toMatchObject({ provider: "custom", default: input.model, api_mode: "chat_completions" });
    expect(config.providers.custom).toMatchObject({ name: "Switcher", key_env: "SWITCHER_HARNESS_API_KEY" });
    expect(JSON.stringify(config)).not.toContain(input.credential);
    expect((await lstat(join(input.stateDir, "state.db"))).isSymbolicLink()).toBe(true);
    expect((await lstat(join(input.stateDir, "sessions"))).isSymbolicLink()).toBe(true);
    await prepared.cleanup?.();
    expect((await readdir(input.stateDir)).sort()).toEqual(["config.yaml", "sessions", "state.db"]);
  } finally {
    await rm(input.stateDir, { recursive: true, force: true });
    await rm(sessionDir, { recursive: true, force: true });
  }
});

test("Hermes bridge keeps the selected catalog, translates native auth and closes active streams", async () => {
  const received: Array<{ path: string; authorization: string | null; key: string | null }> = [];
  let upstreamSignal: AbortSignal | undefined;
  let source: ReadableStreamDefaultController<Uint8Array> | undefined;
  const upstream = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      upstreamSignal = request.signal;
      received.push({ path: new URL(request.url).pathname, authorization: request.headers.get("authorization"), key: request.headers.get("x-api-key") });
      return new Response(new ReadableStream<Uint8Array>({ start(controller) {
        source = controller;
        controller.enqueue(new TextEncoder().encode("data: fixture\\n\\n"));
      } }), { headers: { "content-type": "text/event-stream" } });
    },
  });
  const bridge = createHermesBridge({
    baseUrl: `${upstream.url.origin}/v1`, protocol: "anthropic-messages", authStyle: "x-api-key", model: "vendor/model",
    models: [{ id: "vendor/model", name: "Fixture" }, { id: "second/model", name: "Second" }], credential: "upstream-fixture-key",
  });
  try {
    const headers = { "x-api-key": bridge.token };
    const catalog = await (await fetch(`${bridge.baseUrl}/models`, { headers })).json() as { data: Array<{ id: string }> };
    expect(catalog.data.map(model => model.id)).toEqual(["vendor/model", "second/model"]);
    expect((await fetch(`${bridge.baseUrl}/messages`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ model: "outside/model", messages: [] }) })).status).toBe(403);
    const response = await fetch(`${bridge.baseUrl}/messages`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ model: "vendor/model", messages: [], stream: true }) });
    expect(response.status).toBe(200);
    const reader = response.body?.getReader();
    await reader?.read();
    // The bridge owns active upstream readers. cleanup must abort and close an
    // unfinished stream even when the caller never cancels its reader.
    await bridge.cleanup();
    await expect(fetch(`${bridge.baseUrl}/models`, { headers })).rejects.toThrow();
    expect(received[0]).toMatchObject({ path: "/v1/messages", authorization: null, key: "upstream-fixture-key" });
    expect(upstreamSignal?.aborted).toBe(true);
  } finally {
    try { source?.close(); } catch { /* stream was already cancelled */ }
    await bridge.cleanup();
    await upstream.stop(true);
  }
});

test("Hermes maps all native protocol routes and auth styles without changing the catalog", async () => {
  const requests: Array<{ path: string; authorization: string | null; key: string | null }> = [];
  const upstream = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      requests.push({
        path: new URL(request.url).pathname,
        authorization: request.headers.get("authorization"),
        key: request.headers.get("x-api-key"),
      });
      return Response.json({ ok: true });
    },
  });
  const cases = [
    { protocol: "anthropic-messages" as const, authStyle: "x-api-key" as const, path: "/v1/messages" },
    { protocol: "openai-responses" as const, authStyle: "bearer" as const, path: "/v1/responses" },
    { protocol: "openai-chat" as const, authStyle: "x-api-key" as const, path: "/v1/chat/completions" },
  ];
  try {
    for (const item of cases) {
      const bridge = createHermesBridge({
        baseUrl: `${upstream.url.origin}/v1`, protocol: item.protocol, authStyle: item.authStyle,
        model: "nested/provider/model", models: [{ id: "nested/provider/model", name: "Nested" }], credential: "protocol-fixture-key",
      });
      try {
        const headers = item.protocol === "anthropic-messages" ? { "x-api-key": bridge.token } : { authorization: `Bearer ${bridge.token}` };
        const catalog = await (await fetch(`${bridge.baseUrl}/models`, { headers })).json() as { data: Array<{ id: string }> };
        expect(catalog.data.map(model => model.id)).toEqual(["nested/provider/model"]);
        const response = await fetch(`${bridge.baseUrl}${item.path.slice(3)}`, {
          method: "POST", headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({ model: "nested/provider/model", messages: [] }),
        });
        expect(response.status).toBe(200);
        const wrongHeader = item.protocol === "anthropic-messages" ? { authorization: `Bearer ${bridge.token}` } : { "x-api-key": bridge.token };
        expect((await fetch(`${bridge.baseUrl}/models`, { headers: wrongHeader })).status).toBe(401);
      } finally {
        await bridge.cleanup();
      }
    }
  } finally {
    await upstream.stop(true);
  }
  expect(requests).toEqual([
    { path: "/v1/messages", authorization: null, key: "protocol-fixture-key" },
    { path: "/v1/responses", authorization: "Bearer protocol-fixture-key", key: null },
    { path: "/v1/chat/completions", authorization: null, key: "protocol-fixture-key" },
  ]);
});

test("Hermes bridges auth styles and rejects case-colliding catalogs and routing overrides", async () => {
  const input = await fixture();
  try {
    const translated = await prepareHarnessLaunch({ ...input, protocol: "openai-chat", authStyle: "x-api-key" });
    try { expect(translated.warnings.join(" ")).toContain("translates the selected credential"); }
    finally { await translated.cleanup?.(); }
    await expect(prepareHarnessLaunch({ ...input, args: ["--provider", "openrouter"] })).rejects.toThrow("reserved");
    await expect(prepareHarnessLaunch({ ...input, args: ["--model=outside/model"] })).rejects.toThrow("reserved");
    await expect(prepareHarnessLaunch({ ...input, args: ["--config", "model.provider=openrouter"] })).rejects.toThrow("reserved");
    await expect(prepareHarnessLaunch({ ...input, models: [{ id: "Vendor/Model", name: "One" }, { id: "vendor/model", name: "Two" }] })).rejects.toThrow("letter case");
  } finally { await rm(input.stateDir, { recursive: true, force: true }); }
});
