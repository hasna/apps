import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();
const scratch = mkdtempSync(join(tmpdir(), "skills-safe-errors-"));
const cliBinary = join(scratch, "skills.js");
const mcpBinary = join(scratch, "mcp.js");
const guard = join(scratch, "guard.js");
const canary = "SERVER_CONTROLLED_CANARY";
const code = "SUBSCRIPTION_CHECKOUT_UNAVAILABLE";
const guidance = "Subscription checkout is unavailable on the configured Skills server. " +
  "Use skills credits packs to view credit packs, or skills billing portal to manage an existing subscription.";

beforeAll(async () => {
  for (const [entrypoint, name] of [[resolve(import.meta.dir, "index.tsx"), "skills.js"],
    [resolve(import.meta.dir, "../mcp/index.ts"), "mcp.js"]]) {
    const result = await Bun.build({ entrypoints: [entrypoint!], outdir: scratch, naming: name, target: "bun" });
    expect(result.success).toBe(true);
  }
  writeFileSync(guard, `
    import { writeFileSync } from "node:fs";
    const refuse = () => { writeFileSync(process.env.QA_GUARD_MARKER, "attempt"); throw Error("Unexpected external action"); };
    const request = globalThis.fetch;
    globalThis.fetch = (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.protocol !== "data:" && url.origin !== process.env.QA_ALLOWED_ORIGIN) return refuse();
      return request(input, init);
    };
    const childProcess = require("node:child_process");
    for (const name of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync"]) childProcess[name] = refuse;
    Bun.spawn = refuse; Bun.spawnSync = refuse;
  `);
});
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

type Mode = "recognized" | "unknown" | "malformed" | "oversized" | "stalled" | "wrong-status" | "success";
async function fixture(action: (context: {
  calls: string[]; root: string; env: Record<string, string>; setMode: (mode: Mode) => void;
}) => Promise<void>) {
  const root = mkdtempSync(join(scratch, "consumer-"));
  const calls: string[] = [];
  let mode: Mode = "recognized";
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    calls.push(`${request.method} ${new URL(request.url).pathname}`);
    if (request.method === "POST") expect(await request.json()).toEqual({});
    if (mode === "success") return Response.json({ url: "https://checkout.example.test/session" });
    const value = { code: mode === "unknown" ? canary : code, error: canary, message: canary, detail: canary,
      url: `https://${canary}.example.test`, headers: { authorization: canary } };
    const text = mode === "malformed" ? "{" + canary : JSON.stringify(value);
    const body = mode === "stalled" ? new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
    } }) : mode === "oversized" ? text.padEnd(8 * 1024 + 1, " ") : text;
    return new Response(body, { status: mode === "wrong-status" ? 502 : 503, statusText: canary,
      headers: { "content-type": "application/json", "x-debug": canary } });
  } });
  const env = { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, NO_COLOR: "1", TERM: "dumb",
    HASNA_HOME: join(root, "home"), HASNA_CONFIG_HOME: join(root, "config"), HASNA_SKILLS_DIR: join(root, "data"),
    HASNA_STATION: "safe-error-fixture-no-keychain", HASNA_PROFILE: "safe-error-fixture", SKILLS_TEST_MODE: "1",
    HASNA_SKILLS_API_URL: server.url.origin, HASNA_SKILLS_API_KEY_OVERRIDE: "local-fixture-credential",
    QA_ALLOWED_ORIGIN: server.url.origin, QA_GUARD_MARKER: join(root, "unexpected-action") };
  try {
    await action({ calls, root, env, setMode(value) { mode = value; } });
    expect(existsSync(env.QA_GUARD_MARKER)).toBe(false);
  } finally { server.stop(true); rmSync(root, { recursive: true, force: true }); }
}

async function cli(args: string[], root: string, env: Record<string, string>) {
  const child = Bun.spawn([process.execPath, "--no-env-file", "--preload", guard, cliBinary, ...args], {
    cwd: root, env, stdin: "ignore", stdout: "pipe", stderr: "pipe",
  });
  const deadline = setTimeout(() => child.kill("SIGKILL"), 8_000);
  try {
    const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect(stdout + stderr).not.toContain(canary);
    expect(stdout + stderr).not.toContain("local-fixture-credential");
    return { stdout, stderr, exitCode };
  } finally { clearTimeout(deadline); }
}

test("built CLI reports fixed checkout guidance in human/JSON modes with one POST and no browser", async () => {
  await fixture(async ({ calls, root, env }) => {
    for (const json of [false, true]) {
      const result = await cli(["billing", "checkout", ...(json ? ["--json"] : [])], root, env);
      expect(result.exitCode).toBe(1);
      if (json) {
        expect(JSON.parse(result.stdout)).toEqual({ error: guidance, code, status: 503 });
        expect(result.stderr).toBe("");
      } else {
        expect(result.stderr.trim()).toBe(guidance);
        expect(result.stdout).toBe("");
      }
    }
    expect(calls).toEqual(Array(2).fill("POST /api/v1/billing/checkout"));
  });
});

test("built CLI keeps unknown/malformed/oversized/stalled/wrong-status responses generic and bounded", async () => {
  await fixture(async ({ calls, root, env, setMode }) => {
    for (const mode of ["unknown", "malformed", "oversized", "stalled", "wrong-status"] as const) {
      setMode(mode);
      const start = performance.now();
      const result = await cli(["billing", "checkout", "--json"], root, env);
      expect(performance.now() - start).toBeLessThan(5_000);
      expect(result.exitCode).toBe(1);
      expect(JSON.parse(result.stdout)).toEqual({ error: `Remote request to /api/v1/billing/checkout failed: HTTP ${mode === "wrong-status" ? 502 : 503}` });
      expect(result.stderr).toBe("");
    }
    expect(calls).toEqual(Array(5).fill("POST /api/v1/billing/checkout"));
  });
});

test("built CLI retains generic errors on the portal route and old-server checkout success", async () => {
  await fixture(async ({ calls, root, env, setMode }) => {
    const portal = await cli(["billing", "portal", "--json"], root, env);
    expect(portal.exitCode).toBe(1);
    expect(JSON.parse(portal.stdout)).toEqual({ error: "Remote request to /api/v1/billing/portal failed: HTTP 503" });
    setMode("success");
    for (const json of [false, true]) {
      const result = await cli(["billing", "checkout", ...(json ? ["--json"] : [])], root, env);
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({ url: "https://checkout.example.test/session" });
      expect(result.stderr).toBe("");
    }
    expect(calls).toEqual(["POST /api/v1/billing/portal", ...Array(2).fill("POST /api/v1/billing/checkout")]);
  });
});

test("built MCP returns the same fixed capability guidance without exposing server text", async () => {
  await fixture(async ({ calls, root, env, setMode }) => {
    const child = Bun.spawn([process.execPath, "--no-env-file", "--preload", guard, mcpBinary, "--stdio"], {
      cwd: root, env: { ...env, MCP_STDIO: "1" }, stdin: "pipe", stdout: "pipe", stderr: "pipe",
    });
    const stderr = new Response(child.stderr).text();
    const pending = new Map<number, (reply: any) => void>();
    const output = (async () => {
      let buffer = "";
      const decoder = new TextDecoder();
      for await (const chunk of child.stdout) {
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split("\n"); buffer = lines.pop()!;
        for (const line of lines) {
          if (!line.trim()) continue;
          const reply = JSON.parse(line);
          pending.get(reply.id)?.(reply);
        }
      }
    })();
    const request = (id: number, method: string, params: object) => new Promise<any>((resolve, reject) => {
      const deadline = setTimeout(() => { pending.delete(id); reject(new Error("MCP fixture response deadline exceeded")); }, 5_000);
      pending.set(id, reply => { clearTimeout(deadline); pending.delete(id); resolve(reply); });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
    try {
      const initialized = await request(1, "initialize", { protocolVersion: "2025-03-26", capabilities: {},
        clientInfo: { name: "safe-error-fixture", version: "1.0.0" } });
      expect(initialized.error).toBeUndefined();
      expect(initialized.result.protocolVersion).toBe("2025-03-26");
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
      const response = await request(2, "tools/call", { name: "create_billing_checkout", arguments: {} });
      expect(response.error).toBeUndefined();
      const result = response.result;
      expect(result.isError).toBe(true);
      expect(result.content).toEqual([{ type: "text", text: JSON.stringify({ code, message: guidance, status: 503 }) }]);
      setMode("unknown");
      const genericResponse = await request(3, "tools/call", { name: "create_billing_checkout", arguments: {} });
      expect(genericResponse.error).toBeUndefined();
      const generic = genericResponse.result;
      expect(generic.isError).toBe(true);
      expect(generic.content).toEqual([{ type: "text", text: JSON.stringify({ code: "REMOTE_REQUEST_FAILED",
        message: "Remote request to /api/v1/billing/checkout failed: HTTP 503" }) }]);
      expect(JSON.stringify([result, generic])).not.toContain(canary);
      expect(calls).toEqual(Array(2).fill("POST /api/v1/billing/checkout"));
    } finally {
      child.stdin.end(); child.kill("SIGTERM");
      const forceStop = setTimeout(() => child.kill("SIGKILL"), 500);
      try { await child.exited; await output; expect(await stderr).not.toContain(canary); }
      finally { clearTimeout(forceStop); }
    }
  });
});
