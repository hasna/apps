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
let malformed: Record<string, unknown> | null = null;
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
  if (malformed) return Response.json(malformed, { status, headers: response.headers });
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

for (const legacyMode of [false, true]) for (const expected of [429, 504] as const) {
  const code = expected === 429 ? "search_busy" : "search_timeout";
  test(`SDK preserves ${legacyMode ? "legacy " : ""}HTTP ${expected}, code and retry hint for message and saved-filter searches`, async () => {
    status = expected; legacy = legacyMode;
    for (const prefix of ["", "/api"]) {
      const client = new sdk.EmailsSelfHostClient({ baseUrl: server.url.origin + prefix, apiKey: key });
      for (const [path, operation] of [["GET /v1/messages", () => client.listMessages({ search: "alpha" })], ["POST /v1/mailbox-filters/fixture/apply", () => client.applyMailboxFilter("fixture")]] as const) {
        const before = calls.filter(call => call === path).length;
        try { await operation(); throw new Error("expected search failure"); }
        catch (error) {
          expect(error).toBeInstanceOf(sdk.ApiError);
          expect(error).toMatchObject({ status: expected, body: legacyMode ? { code } : { code, retry_after: 5 } });
          expect(calls.filter(call => call === path)).toHaveLength(before + 1);
        }
      }
    }
  });

  test(`CLI and MCP retain actionable ${legacyMode ? "legacy " : ""}HTTP ${expected} search refusals`, async () => {
    status = expected; legacy = legacyMode;
    for (const args of [["inbox", "list", "--search", "alpha", "--json"], ["inbox", "list", "--filter", "fixture", "--json"]]) {
      const path = args.includes("--filter") ? "POST /v1/mailbox-filters/fixture/apply" : "GET /v1/messages";
      const before = calls.filter(call => call === path).length;
      const child = Bun.spawn([process.execPath, "--no-env-file", cli, ...args], { env: env(), stdout: "pipe", stderr: "pipe" });
      const timer = setTimeout(() => child.kill("SIGKILL"), 15_000);
      try {
        const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
        expect(exit, stderr).toBe(1);
        expect(stdout).toBe("");
        expect(calls.filter(call => call === path)).toHaveLength(before + 1);
        expect(JSON.parse(stderr).error).toMatchObject({ status: expected, code, retry_after: 5, retryable: true, fix_commands: [] });
      } finally { clearTimeout(timer); if (child.exitCode === null) child.kill("SIGKILL"); await child.exited; }
    }
    const client = new Client({ name: "search-error-acceptance", version: "1.0.0" });
    const transport = new StdioClientTransport({ command: process.execPath, args: ["--no-env-file", mcp, "--stdio"], env: env(), stderr: "pipe" });
    try {
      await client.connect(transport, { timeout: 15_000 });
      const before = calls.filter(call => call === "POST /v1/mailbox-filters/fixture/apply").length;
      const result = await client.callTool({ name: "apply_mailbox_filter", arguments: { id: "fixture", limit: 1 } }, undefined, { timeout: 15_000 });
      expect(result.isError).toBe(true);
      expect(calls.filter(call => call === "POST /v1/mailbox-filters/fixture/apply")).toHaveLength(before + 1);
      const text = (result.content as Array<{ type: string; text?: string }>).find(item => item.type === "text")!.text!;
      expect(JSON.parse(text).error).toMatchObject({ status: expected, code, retry_after: 5, retryable: true });
    } finally { await client.close(); await transport.close(); }
    expect(calls).toContain("GET /v1/messages");
    expect(calls).toContain("POST /v1/mailbox-filters/fixture/apply");
  }, 60_000); // Two terminal children plus one MCP transport, each bounded and reaped.
}

test("generic middleware failures and mismatched search status/code remain protocol refusals without retries", async () => {
  const client = new sdk.EmailsSelfHostClient({ baseUrl: server.url.origin, apiKey: key });
  legacy = false;
  for (const expected of [429, 504] as const) {
    status = expected;
    for (const body of [
      { error: "Generic gateway failure" },
      { error: "Too many requests", code: "rate_limited", retry_after: 60 },
      { error: "Message search is busy; retry later.", code: expected === 429 ? "search_timeout" : "search_busy" },
      { error: expected === 429 ? "Message search is busy; retry later." : "Message search exceeded its time limit.", code: expected === 429 ? "search_busy" : "search_timeout", retry_after: -1 },
    ]) {
      malformed = body;
      for (const [path, operation] of [["GET /v1/messages", () => client.listMessages({ search: "alpha" })], ["POST /v1/mailbox-filters/fixture/apply", () => client.applyMailboxFilter("fixture")]] as const) {
        const before = calls.filter(call => call === path).length;
        try { await operation(); throw new Error("expected protocol refusal"); }
        catch (error) {
          expect(error).toMatchObject({ name: "SelfHostedWireResponseError" });
          expect(searchAdmissionFailure(error)).toBeNull();
        }
        expect(calls.filter(call => call === path)).toHaveLength(before + 1);
      }
    }
  }
  malformed = null; status = 200;
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
