import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createServer, type AddressInfo, type Socket } from "node:net";
import { useDefaultTestTimeout } from "../test-preload.js";
import { buildCliFixture } from "./cli-build.fixture.js";

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
    await buildCliFixture(entrypoint!, join(scratch, name!));
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
  const sockets = new Set<Socket>();
  // Raw HTTP preserves a malicious reason phrase on the wire. Bun.serve
  // canonicalizes statusText, so it cannot prove that this field is discarded.
  const server = createServer(socket => {
    sockets.add(socket); socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    let bytes = Buffer.alloc(0);
    let handled = false;
    socket.on("data", chunk => {
      if (handled) return;
      bytes = Buffer.concat([bytes, typeof chunk === "string" ? Buffer.from(chunk) : chunk]);
      const separator = bytes.indexOf("\r\n\r\n");
      if (separator < 0) return;
      const headers = bytes.subarray(0, separator).toString();
      const length = Number(headers.match(/\r\ncontent-length:\s*(\d+)/i)?.[1] ?? 0);
      if (bytes.byteLength < separator + 4 + length) return;
      handled = true;
      const [method, path] = headers.split("\r\n")[0]!.split(" ");
      calls.push(`${method} ${path}`);
      if (method === "POST") expect(JSON.parse(bytes.subarray(separator + 4).toString())).toEqual({});
      const value = { code: mode === "unknown" ? canary : code, error: canary, message: canary, detail: canary,
        url: `https://${canary}.example.test`, headers: { authorization: canary } };
      const text = mode === "success" ? JSON.stringify({ url: "https://checkout.example.test/session" })
        : mode === "malformed" ? "{" + canary : JSON.stringify(value);
      const body = mode === "oversized" ? text.padEnd(8 * 1024 + 1, " ") : text;
      const status = mode === "success" ? 200 : mode === "wrong-status" ? 502 : 503;
      socket.write(`HTTP/1.1 ${status} ${canary}\r\nContent-Type: application/json\r\nX-Debug: ${canary}\r\n` +
        `Content-Length: ${Buffer.byteLength(body) + (mode === "stalled" ? 1 : 0)}\r\nConnection: close\r\n\r\n${body}`);
      if (mode !== "stalled") socket.end();
    });
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const env = { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, NO_COLOR: "1", TERM: "dumb",
    HASNA_HOME: join(root, "home"), HASNA_CONFIG_HOME: join(root, "config"), HASNA_SKILLS_DIR: join(root, "data"),
    HASNA_STATION: "safe-error-fixture-no-keychain", HASNA_PROFILE: "safe-error-fixture", SKILLS_TEST_MODE: "1",
    HASNA_SKILLS_API_URL: origin, HASNA_SKILLS_API_KEY_OVERRIDE: "local-fixture-credential",
    QA_ALLOWED_ORIGIN: origin, QA_GUARD_MARKER: join(root, "unexpected-action") };
  try {
    await action({ calls, root, env, setMode(value) { mode = value; } });
    expect(existsSync(env.QA_GUARD_MARKER)).toBe(false);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    rmSync(root, { recursive: true, force: true });
  }
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
