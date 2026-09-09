import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { buildCliFixture } from "./cli-build.fixture.js";
import { useDefaultTestTimeout } from "../test-preload.js";
import { describeRemoteFiles } from "../lib/remote-files.js";

useDefaultTestTimeout();
const installed = process.env.SKILLS_QUOTE_TEST_PACKAGE;
const root = realpathSync(mkdtempSync(join(tmpdir(), "skills-quote-receipt-")));
const binary = installed ? join(installed, "bin/index.js") : join(root, "skills.js");
const mcpBinary = installed ? join(installed, "bin/mcp.js") : join(root, "mcp.js");
const guard = join(root, "guard.js"), receipt = "opaque.quoted-version-A_-unchanged";
const runId = "00000000-0000-4000-8000-000000000001";
beforeAll(async () => {
  if (!installed) {
    await buildCliFixture(resolve(import.meta.dir, "index.tsx"), binary);
    await buildCliFixture(resolve(import.meta.dir, "../mcp/index.ts"), mcpBinary);
  }
  writeFileSync(guard, `const original=globalThis.fetch;globalThis.fetch=(input,init)=>{const u=new URL(input instanceof Request?input.url:String(input));if(u.protocol!=="data:"&&u.origin!==process.env.QA_ORIGIN)throw Error("External request refused");return original(input,init)};`);
});
afterAll(() => rmSync(root, { recursive: true, force: true }));
type Call = { path: string; body: any };
type Mode = "success" | "stale" | "expired" | "malformed" | "files";
async function fixture(action: (origin: string, calls: Call[]) => Promise<void>, mode: Mode = "success", onQuote?: () => void) {
  const calls: Call[] = []; let quotes = 0;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request): Promise<Response> {
    const path = new URL(request.url).pathname, body = request.method === "POST" ? await request.json() : request.method === "PUT" ? new Uint8Array(await request.arrayBuffer()) : null;
    calls.push({ path, body });
    if (path === "/object") { expect(request.headers.has("authorization")).toBe(false); return new Response(null, { status: 200 }); }
    expect(request.headers.get("authorization")).toBe("Bearer owned-quote-key");
    if (path.endsWith("/quote")) {
      quotes++;
      onQuote?.();
      // A second quote would silently select another version at the same cost.
      return Response.json({ skill: "quoted-skill", pricing: { costCredits: 3 }, quoteReceipt: mode === "malformed" ? null : quotes === 1 ? receipt : "opaque.version-B-same-price" });
    }
    if (path.endsWith("/capabilities")) return Response.json({ contractVersion: 1, apiVersion: 1, capabilities: ["runs.submit", "runs.uploads"], billing: { unit: "credits", boundedRunApproval: true } });
    if (path === "/api/v1/runs/quoted-skill") {
      if (mode === "stale" || mode === "expired") return Response.json({ code: mode === "stale" ? "PRIVATE_QUOTE_STALE" : "PRIVATE_QUOTE_EXPIRED", error: "UNTRUSTED_QUOTE_REFUSAL" }, { status: mode === "stale" ? 409 : 410 });
      if (mode === "files" && JSON.stringify((body as any).files) !== JSON.stringify(calls.find(c => c.path.endsWith("/quote"))?.body.files)) return Response.json({ code: "PRIVATE_QUOTE_STALE" }, { status: 409 });
      return Response.json({ id: runId, skill: "quoted-skill", status: mode === "files" ? "queued" : "completed", exitCode: 0 });
    }
    if (path.endsWith("/uploads")) return Response.json({ files: [{ name: "café !'()*.txt", uploadUrl: server.url.origin + "/object" }] });
    if (path.endsWith("/logs") || path.endsWith("/artifacts")) return Response.json([]);
    return Response.json({ code: "NOT_FOUND" }, { status: 404 });
  } });
  try { await action(server.url.origin, calls); }
  finally { await server.stop(true); }
}
function environment(origin: string, home: string) {
  return { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: home, TMPDIR: root, NO_COLOR: "1", TERM: "dumb", SKILLS_TEST_MODE: "1",
    HASNA_HOME: join(home, "hasna"), HASNA_CONFIG_HOME: join(home, "config"), HASNA_SKILLS_DIR: join(home, "data"),
    HASNA_STATION: "quote-receipt-owned-no-keychain", HASNA_SKILLS_API_URL: origin, HASNA_SKILLS_API_KEY_OVERRIDE: "owned-quote-key", QA_ORIGIN: origin };
}
async function cli(origin: string, file?: string) {
  const home = mkdtempSync(join(root, "cli-"));
  const child = Bun.spawn([process.execPath, "--no-env-file", "--preload", guard, binary, "run", "--remote", "--yes", "--json", "--idempotency-key", "approved-receipt", ...(file ? ["--file", file] : []), "quoted-skill", "--literal", "approved input"], {
    cwd: home, env: environment(origin, home), stdin: "ignore", stdout: "pipe", stderr: "pipe",
  });
  const timer = setTimeout(() => child.kill("SIGKILL"), 15000);
  try {
    const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect(stdout.length + stderr.length).toBeLessThan(16000);
    expect(stdout + stderr).not.toContain("owned-quote-key"); expect(stdout + stderr).not.toContain("UNTRUSTED_QUOTE_REFUSAL");
    return { result: JSON.parse(stdout), exitCode };
  } finally { clearTimeout(timer); if (child.exitCode === null) child.kill("SIGKILL"); await child.exited; rmSync(home, { recursive: true, force: true }); }
}

for (const mode of ["success", "stale", "expired", "malformed"] as const) test(`actual CLI preserves confirmed receipt and refuses without requote: ${mode}`, async () => fixture(async (origin, calls) => {
  const result = await cli(origin);
  expect(calls.filter(c => c.path.endsWith("/quote"))).toHaveLength(1);
  const submitted = calls.filter(c => c.path === "/api/v1/runs/quoted-skill");
  expect(submitted).toHaveLength(mode === "malformed" ? 0 : 1);
  if (submitted.length) expect(submitted[0]?.body).toEqual({ input: {}, args: ["--literal", "approved input"], maxCredits: 3, maxCostCents: 3, quoteReceipt: receipt, idempotencyKey: "approved-receipt", files: [] });
  expect(result.exitCode).toBe(mode === "success" ? 0 : 1);
  if (mode === "success") expect(result.result.remoteRun.id).toBe(runId);
  else { expect(result.result.remoteRun).toBeUndefined(); expect(result.result.error).toContain(mode === "malformed" ? "quote receipt" : `HTTP ${mode === "stale" ? 409 : 410}`); }
}, mode));

async function withMcp(origin: string, action: (client: Client) => Promise<void>) {
  const home = mkdtempSync(join(root, "mcp-"));
  const transport = new StdioClientTransport({ command: process.execPath, args: ["--no-env-file", "--preload", guard, mcpBinary], cwd: home, env: { ...environment(origin, home), MCP_STDIO: "1" }, stderr: "pipe" });
  const client = new Client({ name: "owned-quote-receipt", version: "1" });
  try { await client.connect(transport); await action(client); }
  finally { await client.close(); await transport.close(); rmSync(home, { recursive: true, force: true }); }
}
for (const mode of ["success", "stale", "expired"] as const) test(`actual MCP quote-confirm-run preserves receipt and nested input: ${mode}`, async () => fixture(async (origin, calls) => withMcp(origin, async client => {
  const input = { nested: { approved: ["a", "b"] } }, args = ["--literal", "approved input"];
  const quote = await client.callTool({ name: "quote_skill", arguments: { name: "quoted-skill", input, args } });
  expect(quote.isError).not.toBe(true);
  const value = JSON.parse((quote.content as Array<{ text: string }>)[0]!.text);
  expect(value.quoteReceipt).toBe(receipt);
  const result = await client.callTool({ name: "run_skill", arguments: { name: "quoted-skill", remote: true, input, args, maxCredits: 3, quoteReceipt: value.quoteReceipt, idempotency_key: "mcp-approved-receipt" } });
  expect(calls.filter(c => c.path.endsWith("/quote"))).toHaveLength(1);
  const submitted = calls.filter(c => c.path === "/api/v1/runs/quoted-skill");
  expect(submitted).toHaveLength(1);
  expect(submitted[0]?.body).toEqual({ input, args, maxCredits: 3, maxCostCents: 3, quoteReceipt: receipt, idempotencyKey: "mcp-approved-receipt", files: [] });
  expect(result.isError === true).toBe(mode !== "success");
  const serialized = JSON.stringify(result);
  expect(serialized).not.toContain("owned-quote-key"); expect(serialized).not.toContain("UNTRUSTED_QUOTE_REFUSAL");
  if (mode !== "success") { expect(serialized).toContain(`HTTP ${mode === "stale" ? 409 : 410}`); expect(serialized).not.toContain(runId); }
}), mode));

test("actual MCP auto-quote malformed response and malformed explicit receipt cannot submit", async () => fixture(async (origin, calls) => withMcp(origin, async client => {
  const response = await client.callTool({ name: "run_skill", arguments: { name: "quoted-skill", remote: true, maxCredits: 3 } });
  expect(response.isError).toBe(true); expect(JSON.stringify(response)).toContain("quote receipt");
  for (const value of [null, "", "x".repeat(4097), "é".repeat(2049)]) {
    try {
      const rejected = await client.callTool({ name: "run_skill", arguments: { name: "quoted-skill", remote: true, maxCredits: 3, quoteReceipt: value } });
      expect(rejected.isError).toBe(true);
    } catch (error) { expect(String(error)).toContain("Invalid"); }
  }
  expect(calls.map(c => c.path)).toEqual(["/api/v1/skills/quoted-skill/quote"]);
}), "malformed"));

test("actual CLI quotes owned file descriptors before confirmation and uploads original bytes despite source change", async () => {
  const file = join(root, "café !'()*.txt"), bytes = new TextEncoder().encode("approved file bytes");
  writeFileSync(file, bytes);
  const descriptors = describeRemoteFiles([{ name: "café !'()*.txt", bytes }]);
  await fixture(async (origin, calls) => {
    const result = await cli(origin, file); expect(result.exitCode).toBe(0);
    expect(calls.filter(c => c.path.endsWith("/quote"))).toHaveLength(1);
    const quoted = calls.find(c => c.path.endsWith("/quote"))!.body;
    expect(quoted.files).toEqual(descriptors);
    const submitted = calls.find(c => c.path === "/api/v1/runs/quoted-skill")!.body;
    expect(submitted).toEqual({ ...quoted, quoteReceipt: receipt, maxCredits: 3, maxCostCents: 3, idempotencyKey: "approved-receipt" });
    expect(calls.find(c => c.path.endsWith("/uploads"))?.body).toEqual({ files: descriptors });
    expect(calls.find(c => c.path === "/object")?.body).toEqual(bytes);
  }, "files", () => writeFileSync(file, "changed after quote"));
});

for (const changed of [false, true]) test(`actual MCP file approval binds quoted descriptors before admission and PUT: changed=${changed}`, async () => fixture(async (origin, calls) => withMcp(origin, async client => {
  const bytes = new TextEncoder().encode("approved file bytes"), files = [{ name: "café !'()*.txt", base64: Buffer.from(bytes).toString("base64"), contentType: "text/plain" }];
  const quoted = await client.callTool({ name: "quote_skill", arguments: { name: "quoted-skill", input: { approved: true }, files } });
  expect(quoted.isError).not.toBe(true);
  const value = JSON.parse((quoted.content as Array<{ text: string }>)[0]!.text);
  const descriptors = describeRemoteFiles([{ name: "café !'()*.txt", bytes, contentType: "text/plain" }]);
  expect(calls.find(c => c.path.endsWith("/quote"))?.body.files).toEqual(descriptors);
  if (changed) files[0]!.base64 = Buffer.from("changed file bytes").toString("base64");
  const result = await client.callTool({ name: "run_skill", arguments: { name: "quoted-skill", remote: true, input: { approved: true }, maxCredits: 3, quoteReceipt: value.quoteReceipt, files } });
  expect(result.isError === true).toBe(changed);
  expect(calls.filter(c => c.path.endsWith("/quote"))).toHaveLength(1);
  expect(calls.filter(c => c.path === "/api/v1/runs/quoted-skill")).toHaveLength(1);
  expect(calls.find(c => c.path === "/api/v1/runs/quoted-skill")?.body.quoteReceipt).toBe(receipt);
  expect(calls.filter(c => c.path.endsWith("/uploads"))).toHaveLength(changed ? 0 : 1);
  expect(calls.filter(c => c.path === "/object")).toHaveLength(changed ? 0 : 1);
  if (!changed) { expect(calls.find(c => c.path.endsWith("/uploads"))?.body).toEqual({ files: descriptors }); expect(calls.find(c => c.path === "/object")?.body).toEqual(bytes); }
  else expect(JSON.stringify(result)).toContain("HTTP 409");
}), "files"));
