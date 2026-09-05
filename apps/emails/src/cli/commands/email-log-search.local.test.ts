// Task db244cd4: keep exercising the retained email-log.local.ts registration.
// Its search resolves the canonical API, so a local DB fixture cannot reach it.
// Preserve the four received/sent/folder/no-match regressions over real HTTP.
// Explicit API direction/status distinguish sent rows from received rows; two
// inbound rows must never produce a false-positive sent-search test.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { resetMailDataSource } from "../../lib/mail-data-source.js";
import { startV1Stub, type V1Stub } from "../../test-support/v1-stub.js";
import { registerEmailLogCommands } from "./email-log.local.js";

let stub: V1Stub;
let originalEnv: NodeJS.ProcessEnv;
let originalFetch: typeof fetch;
let originalExitCode: typeof process.exitCode;
let root: string;
let stateRoots: string[];
let messages: Array<Record<string, unknown>>;
let requests: Array<{ direction: string | null; search: string | null; authenticated: boolean }>;
let errors: string[];

beforeAll(async () => { stub = await startV1Stub(); });
afterAll(() => stub.stop());
beforeEach(async () => {
  originalEnv = { ...process.env };
  originalExitCode = process.exitCode;
  root = mkdtempSync(join(tmpdir(), "emails-search-client-"));
  const roots = {
    HOME: "home", XDG_CONFIG_HOME: "config", XDG_DATA_HOME: "data",
    XDG_CACHE_HOME: "cache", XDG_STATE_HOME: "state", HASNA_EMAILS_HOME: "app",
  };
  stateRoots = Object.entries(roots).map(([key, name]) => {
    const path = join(root, name);
    mkdirSync(path);
    process.env[key] = path;
    return path;
  });
  for (const key of ["EMAILS_HOME", "HASNA_HOME", "HASNA_DATA_HOME", "CODEWITH_HOME"]) delete process.env[key];
  await stub.reset();
  stub.applyEnv();
  messages = [];
  requests = [];
  errors = [];
  originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname === "/v1/messages") {
      expect(url.origin).toBe(stub.baseUrl);
      requests.push({
        direction: url.searchParams.get("direction"), search: url.searchParams.get("search"),
        authenticated: new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
          .get("authorization") === `Bearer ${stub.apiKey}`,
      });
    }
    return originalFetch(input, init);
  }) as typeof fetch;
});
afterEach(() => {
  try {
    for (const path of stateRoots) expect(readdirSync(path)).toEqual([]);
  } finally {
    globalThis.fetch = originalFetch;
    stub.clearEnv();
    resetMailDataSource();
    for (const key of Object.keys(process.env)) {
      if (!Object.prototype.hasOwnProperty.call(originalEnv, key)) delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
    process.exitCode = originalExitCode;
    rmSync(root, { recursive: true, force: true });
  }
});

function seedMessage(subject: string, opts: { sent?: boolean } = {}): void {
  const sequence = messages.length + 1;
  messages.push({
    id: `search-fixture-${sequence}`, direction: opts.sent ? "outbound" : "inbound",
    status: opts.sent ? "sent" : "received", from_addr: `sender-${sequence}@example.com`,
    to_addrs: ["me@example.com"], subject, body_text: `body ${sequence}`,
    received_at: `2026-07-${String(sequence).padStart(2, "0")}T00:00:00.000Z`,
    is_read: Boolean(opts.sent), labels: [],
  });
}

async function runSearch(args: string[]) {
  await stub.seed({ messages });
  const program = new Command();
  program.exitOverride();
  let data: unknown;
  const out: string[] = [];
  registerEmailLogCommands(program, (payload, formatted) => {
    data = payload;
    out.push(String(formatted ?? ""));
  });
  const originalExit = process.exit;
  const originalError = console.error;
  errors = [];
  // Commander exitOverride does not intercept handleError's process.exit.
  // Unexpected exits must fail this test, not suppress every subsequent file.
  process.exit = ((code?: string | number | null) => {
    throw new Error(`Search command requested process exit ${code ?? 0}`);
  }) as typeof process.exit;
  console.error = (...values: unknown[]) => { errors.push(values.map(String).join(" ")); };
  try {
    await program.parseAsync(["node", "emails", ...args]);
    expect(errors).toEqual([]);
    return { data, out: out.join("\n") };
  } finally {
    process.exit = originalExit;
    console.error = originalError;
  }
}

function expectApiSearch(query: string, directions: string[]): void {
  expect(requests.length).toBeGreaterThan(0);
  expect(requests.every(request => request.authenticated && request.search === query)).toBe(true);
  expect([...new Set(requests.map(request => request.direction))].sort()).toEqual([...directions].sort());
}

describe("retained search registration uses the canonical API (db244cd4)", () => {
  it("finds a term that exists ONLY in received mail", async () => {
    seedMessage("Your account is past due");
    const { data } = await runSearch(["search", "past due"]);
    expect((data as Array<Record<string, unknown>>).map(row => row.subject)).toEqual(["Your account is past due"]);
    expectApiSearch("past due", ["inbound", "outbound"]);
  });

  it("returns received AND sent matches together", async () => {
    seedMessage("Invoice needle received", { sent: false });
    seedMessage("Invoice needle sent", { sent: true });
    const { data } = await runSearch(["search", "Invoice needle"]);
    expect((data as Array<Record<string, unknown>>).map(row => row.subject).sort()).toEqual([
      "Invoice needle received", "Invoice needle sent",
    ]);
    expectApiSearch("Invoice needle", ["inbound", "outbound"]);
    requests = [];
    const inboxOnly = await runSearch(["search", "Invoice needle", "--folder", "inbox"]);
    expect((inboxOnly.data as Array<Record<string, unknown>>).map(row => row.subject)).toEqual(["Invoice needle received"]);
    expectApiSearch("Invoice needle", ["inbound"]);
  });

  it("narrows to one folder on --folder", async () => {
    seedMessage("Reconciliation needle received", { sent: false });
    seedMessage("Reconciliation needle sent", { sent: true });
    const { data } = await runSearch(["search", "Reconciliation needle", "--folder", "sent"]);
    expect((data as Array<Record<string, unknown>>).map(row => row.subject)).toEqual(["Reconciliation needle sent"]);
    expectApiSearch("Reconciliation needle", ["outbound"]);
  });

  it("names the folders it searched when it finds nothing", async () => {
    seedMessage("Nothing relevant");
    const { data, out } = await runSearch(["search", "no-such-string-anywhere-zzz"]);
    expect(data).toEqual([]);
    expect(out).toContain("inbox");
    expect(out).toContain("sent");
    expectApiSearch("no-such-string-anywhere-zzz", ["inbound", "outbound"]);
  });

  it("rejects client DB settings before mailbox requests without terminating the runner", async () => {
    seedMessage("Still searchable");
    process.env.EMAILS_DB_PATH = ":memory:";
    await expect(runSearch(["search", "Still searchable"])).rejects.toThrow("Search command requested process exit 1");
    expect(requests).toEqual([]);
    expect(errors.join("\n")).toContain("EMAILS_DB_PATH");
    expect(errors.join("\n")).not.toContain(stub.apiKey);
    delete process.env.EMAILS_DB_PATH;
    const { data } = await runSearch(["search", "Still searchable"]);
    expect((data as Array<Record<string, unknown>>).map(row => row.subject)).toEqual(["Still searchable"]);
    expectApiSearch("Still searchable", ["inbound", "outbound"]);
  });
});
