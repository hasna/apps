import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { messageSearchErrorResponse, MessageSearchBusyError, MessageSearchTimeoutError } from "../server/self-hosted/search-admission.js";
import { searchAdmissionFailure } from "./search-admission-error.js";
import { SelfHostedMailDataSource } from "./self-hosted-mail-data-source.js";

// Point the same acceptance at an extracted/installed npm package to test its
// actual bins and public SDK rather than assuming a source build is sufficient.
const installedPackage = process.env.EMAILS_SEARCH_CLIENT_PACKAGE;
const sdk = await import(installedPackage
  ? pathToFileURL(join(installedPackage, "dist/selfhost.js")).href
  : new URL("../selfhost.ts", import.meta.url).href);
const cli = installedPackage ? join(installedPackage, "dist/cli/index.js") : new URL("../cli/index.tsx", import.meta.url).pathname;
const mcp = installedPackage ? join(installedPackage, "dist/mcp/index.js") : new URL("../mcp/index.ts", import.meta.url).pathname;
const home = mkdtempSync(join(tmpdir(), "emails-search-clients-"));
const key = "synthetic-search-client-key";
let status: 200 | 429 | 504 = 429;
let malformed = false;
let legacy = false;
const calls: string[] = [];
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) {
  expect(req.headers.get("x-api-key") ?? req.headers.get("authorization")?.replace(/^Bearer /, "")).toBe(key);
  const path = new URL(req.url).pathname.replace(/^\/api/, "");
  calls.push(`${req.method} ${path}`);
  if (path === "/v1/priority-sender-rules") return Response.json({ items: [] });
  if (status === 200) return Response.json(path.endsWith("/apply")
    ? { filter: { name: "fixture", criteria: {} }, items: [], limit: 1, offset: 0, truncated: false }
    : { messages: [], next_cursor: null });
  const response = messageSearchErrorResponse(status === 429 ? new MessageSearchBusyError() : new MessageSearchTimeoutError())!;
  if (!malformed && !legacy) return response;
  const body = await response.json();
  if (malformed) body.code = "unrelated_failure";
  if (legacy) delete body.retry_after;
  return Response.json(body, { status, headers: response.headers });
} });
const env = () => ({
  PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: home,
  HASNA_STATION: `emails-search-fixture-${crypto.randomUUID()}`,
  HASNA_EMAILS_API_URL: server.url.origin, HASNA_EMAILS_API_KEY_OVERRIDE: key,
  NO_COLOR: "1", AWS_EC2_METADATA_DISABLED: "true",
});
afterAll(() => { server.stop(true); rmSync(home, { recursive: true, force: true }); });

for (const expected of [429, 504] as const) {
  const code = expected === 429 ? "search_busy" : "search_timeout";
  test(`SDK preserves HTTP ${expected}, code and retry hint for message and saved-filter searches`, async () => {
    status = expected;
    for (const prefix of ["", "/api"]) {
      const client = new sdk.EmailsSelfHostClient({ baseUrl: server.url.origin + prefix, apiKey: key });
      for (const operation of [() => client.listMessages({ search: "alpha" }), () => client.applyMailboxFilter("fixture")]) {
        try { await operation(); throw new Error("expected search failure"); }
        catch (error) {
          expect(error).toBeInstanceOf(sdk.ApiError);
          expect(error).toMatchObject({ status: expected, body: { code, retry_after: 5 } });
        }
      }
    }
  });

  test(`CLI and MCP retain actionable HTTP ${expected} search refusals`, async () => {
    status = expected;
    for (const args of [["inbox", "list", "--search", "alpha", "--json"], ["inbox", "list", "--filter", "fixture", "--json"]]) {
      const child = Bun.spawn([process.execPath, "--no-env-file", cli, ...args], { env: env(), stdout: "pipe", stderr: "pipe" });
      const timer = setTimeout(() => child.kill("SIGKILL"), 15_000);
      try {
        const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
        expect(exit, stderr).toBe(1);
        expect(stdout).toBe("");
        expect(JSON.parse(stderr).error).toMatchObject({ status: expected, code, retry_after: 5, retryable: true, fix_commands: [] });
      } finally { clearTimeout(timer); if (child.exitCode === null) child.kill("SIGKILL"); await child.exited; }
    }
    const client = new Client({ name: "search-error-acceptance", version: "1.0.0" });
    const transport = new StdioClientTransport({ command: process.execPath, args: ["--no-env-file", mcp, "--stdio"], env: env(), stderr: "pipe" });
    try {
      await client.connect(transport, { timeout: 15_000 });
      const result = await client.callTool({ name: "apply_mailbox_filter", arguments: { id: "fixture", limit: 1 } }, undefined, { timeout: 15_000 });
      expect(result.isError).toBe(true);
      const text = (result.content as Array<{ type: string; text?: string }>).find(item => item.type === "text")!.text!;
      expect(JSON.parse(text).error).toMatchObject({ status: expected, code, retry_after: 5, retryable: true });
    } finally { await client.close(); await transport.close(); }
    expect(calls).toContain("GET /v1/messages");
    expect(calls).toContain("POST /v1/mailbox-filters/fixture/apply");
  }, 60_000); // Two terminal children plus one MCP transport, each bounded and reaped.
}

test("valid legacy search errors remain readable; malformed search errors still fail closed", async () => {
  const client = new sdk.EmailsSelfHostClient({ baseUrl: server.url.origin, apiKey: key });
  status = 429; legacy = true;
  try { await expect(client.listMessages({ search: "alpha" })).rejects.toMatchObject({ status: 429, body: { code: "search_busy" } }); }
  finally { legacy = false; }
  malformed = true;
  try { await expect(client.listMessages({ search: "alpha" })).rejects.toMatchObject({ name: "SelfHostedWireResponseError" }); }
  finally { malformed = false; }
  status = 200;
  expect(await client.listMessages()).toEqual({ messages: [], next_cursor: null });
  expect((await client.applyMailboxFilter("fixture")).items).toEqual([]);
});

test("only the exact safe search-error envelope grants retry guidance", async () => {
  expect(searchAdmissionFailure("HTTP 429 search_busy")).toBeNull();
  expect(searchAdmissionFailure("Message search failed (HTTP 504; code=search_busy; retry_after=5). Retry after 5 seconds.")).toBeNull();
  const source = new SelfHostedMailDataSource({ baseUrl: server.url.origin, apiKey: key });
  status = 504;
  await expect(source.applyMailboxFilter("fixture")).rejects.toMatchObject({ failure: { status: 504, code: "search_timeout", retry_after: 5 } });
});
