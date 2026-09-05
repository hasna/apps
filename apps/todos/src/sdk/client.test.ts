import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { TodosClient } from "./client.js";
import { resetConfig } from "../lib/config.js";
import { getJsonContract, validateJsonContract } from "../json-contracts.js";

const originalHome = process.env["HOME"];
const originalTodosApiUrl = process.env["TODOS_API_URL"];
const originalTodosUrl = process.env["TODOS_URL"];
const originalTodosMode = process.env["TODOS_MODE"];
const originalTodosApiKey = process.env["TODOS_API_KEY"];
const originalFetch = globalThis.fetch;

let fakeHome: string;

beforeEach(() => {
  fakeHome = mkdtempSync(join(tmpdir(), "todos-sdk-local-"));
  process.env["HOME"] = fakeHome;
  delete process.env["TODOS_API_URL"];
  delete process.env["TODOS_URL"];
  delete process.env["TODOS_MODE"];
  delete process.env["TODOS_API_KEY"];
  resetConfig();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalHome === undefined) delete process.env["HOME"];
  else process.env["HOME"] = originalHome;
  if (originalTodosApiUrl === undefined) delete process.env["TODOS_API_URL"];
  else process.env["TODOS_API_URL"] = originalTodosApiUrl;
  if (originalTodosUrl === undefined) delete process.env["TODOS_URL"];
  else process.env["TODOS_URL"] = originalTodosUrl;
  if (originalTodosMode === undefined) delete process.env["TODOS_MODE"];
  else process.env["TODOS_MODE"] = originalTodosMode;
  if (originalTodosApiKey === undefined) delete process.env["TODOS_API_KEY"];
  else process.env["TODOS_API_KEY"] = originalTodosApiKey;
  resetConfig();
  rmSync(fakeHome, { recursive: true, force: true });
});

describe("TodosClient local API config", () => {
  test("uses local server URL by default", () => {
    const client = new TodosClient();
    expect(client.baseUrl).toBe("http://localhost:19427");
    expect(client.apiKey).toBeNull();
  });

  test("a resolved credential routes at the configured authority, not localhost", () => {
    // The behaviour this replaces: the legacy `TODOS_API_URL` was IGNORED and a
    // legacy key name was the only one read, so an operator with a real hosted
    // configuration silently got the localhost default with a live credential
    // attached. Now the @hasna/contracts chain decides both halves together.
    process.env["HASNA_TODOS_API_URL"] = "https://todos.example";
    process.env["HASNA_TODOS_API_KEY"] = "env-token";
    try {
      const client = new TodosClient();
      expect(client.baseUrl).toBe("https://todos.example");
      expect(client.apiKey).toBe("env-token");
    } finally {
      delete process.env["HASNA_TODOS_API_URL"];
      delete process.env["HASNA_TODOS_API_KEY"];
    }
  });

  test("a credential with no authority resolves the fleet gateway", () => {
    process.env["HASNA_TODOS_API_KEY"] = "env-token";
    try {
      const client = new TodosClient();
      // `/v1` is stripped because this client composes `/api/...` and `/v1/...`
      // itself; exactly one version segment must survive.
      expect(client.baseUrl).toBe("https://api.hasna.com/todos");
      expect(client.apiKey).toBe("env-token");
    } finally {
      delete process.env["HASNA_TODOS_API_KEY"];
    }
  });

  test("the legacy unprefixed key name still works, as a silent fallback", () => {
    process.env["TODOS_API_KEY"] = "legacy-token";
    try {
      const client = new TodosClient();
      expect(client.apiKey).toBe("legacy-token");
    } finally {
      delete process.env["TODOS_API_KEY"];
    }
  });

  test("a credential in ~/.hasna/todos/config/credentials outranks the environment", async () => {
    // The disk tier the CLI and the SDK now share. It sits ABOVE the process
    // env deliberately: a rotation written to disk must beat a stale export in
    // an old shell without waiting for that shell to cycle.
    const file = join(fakeHome, ".hasna", "todos", "config", "credentials");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, "HASNA_TODOS_API_KEY=disk-token\nHASNA_TODOS_API_URL=https://disk.todos.example\n", { mode: 0o600 });
    chmodSync(file, 0o600);
    process.env["HASNA_TODOS_API_KEY"] = "env-token";
    let observedHeaders: HeadersInit | undefined;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      observedHeaders = init?.headers;
      return new Response(JSON.stringify([]), { status: 200 });
    }) as typeof fetch;
    try {
      const client = new TodosClient();
      await client.tasks.list();
      expect(client.baseUrl).toBe("https://disk.todos.example");
      expect(client.apiKey).toBe("disk-token");
      expect((observedHeaders as Record<string, string>)["x-api-key"]).toBe("disk-token");
    } finally {
      delete process.env["HASNA_TODOS_API_KEY"];
    }
  });

  test("a group-readable credential file is refused, never read around", () => {
    const file = join(fakeHome, ".hasna", "todos", "config", "credentials");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, "HASNA_TODOS_API_KEY=disk-token\n");
    chmodSync(file, 0o644);
    // A lower tier IS available here, which is the point: an unsafe file must
    // not be quietly stepped over in favour of the environment. Falling through
    // would authenticate as a different principal than the file names, and the
    // operator would never learn their credential file is unreadable.
    process.env["HASNA_TODOS_API_KEY"] = "env-token";
    try {
      expect(() => new TodosClient()).toThrow(/Refusing unsafe credential/);
    } finally {
      delete process.env["HASNA_TODOS_API_KEY"];
    }
  });

  test("a rotation heals a LIVE client: the credential is re-resolved per request", async () => {
    // `test/setup.ts` sets the local opt-in on this process, and a configured
    // ENVIRONMENT is what outranks it — the disk tier alone does not. Declaring
    // a decoy env key routes hosted; the disk tier still outranks it.
    process.env["HASNA_TODOS_API_KEY"] = "env-token";

    // The README and the 2026-09-04 ruling both promise resolution on every
    // call, not once at process start. A long-lived agent holds one client for
    // hours; if the key it snapshotted at startup were the key it kept sending,
    // every rotation would take an agent restart to land — the exact staleness
    // the fresh-per-call chain exists to remove.
    const file = join(fakeHome, ".hasna", "todos", "config", "credentials");
    mkdirSync(dirname(file), { recursive: true });
    const write = (token: string) => {
      writeFileSync(file, `HASNA_TODOS_API_KEY=${token}\nHASNA_TODOS_API_URL=https://disk.todos.example\n`, { mode: 0o600 });
      chmodSync(file, 0o600);
    };
    const sent: (string | undefined)[] = [];
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      sent.push((init?.headers as Record<string, string> | undefined)?.["x-api-key"]);
      return new Response(JSON.stringify([]), { status: 200 });
    }) as typeof fetch;

    write("token-before-rotation");
    const client = new TodosClient();
    await client.tasks.list();

    write("token-after-rotation");
    await client.tasks.list();

    expect(sent).toEqual(["token-before-rotation", "token-after-rotation"]);
    // The property agrees with what the wire saw; it is not a stale snapshot.
    expect(client.apiKey).toBe("token-after-rotation");
    delete process.env["HASNA_TODOS_API_KEY"];
  });

  test("an explicit apiKey is a pin: it is never re-resolved away", async () => {
    // `test/setup.ts` sets the local opt-in on this process, and a configured
    // ENVIRONMENT is what outranks it — the disk tier alone does not. Declaring
    // a decoy env key routes hosted; the disk tier still outranks it.
    process.env["HASNA_TODOS_API_KEY"] = "env-token";

    const file = join(fakeHome, ".hasna", "todos", "config", "credentials");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, "HASNA_TODOS_API_KEY=disk-token\nHASNA_TODOS_API_URL=https://disk.todos.example\n", { mode: 0o600 });
    chmodSync(file, 0o600);
    const sent: (string | undefined)[] = [];
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      sent.push((init?.headers as Record<string, string> | undefined)?.["x-api-key"]);
      return new Response(JSON.stringify([]), { status: 200 });
    }) as typeof fetch;

    const client = new TodosClient({ apiKey: "option-token" });
    await client.tasks.list();

    expect(sent).toEqual(["option-token"]);
    expect(client.apiKey).toBe("option-token");
    delete process.env["HASNA_TODOS_API_KEY"];
  });

  test("a credential that stops resolving mid-flight does not break a working client", async () => {
    // `test/setup.ts` sets the local opt-in on this process, and a configured
    // ENVIRONMENT is what outranks it — the disk tier alone does not. Declaring
    // a decoy env key routes hosted; the disk tier still outranks it.
    process.env["HASNA_TODOS_API_KEY"] = "env-token";

    // A transient unreadable store must not convert a live client into a
    // failing one; the request still carries the credential it was built with,
    // and a genuinely dead key surfaces as the server's 401.
    const file = join(fakeHome, ".hasna", "todos", "config", "credentials");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, "HASNA_TODOS_API_KEY=disk-token\nHASNA_TODOS_API_URL=https://disk.todos.example\n", { mode: 0o600 });
    chmodSync(file, 0o600);
    const sent: (string | undefined)[] = [];
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      sent.push((init?.headers as Record<string, string> | undefined)?.["x-api-key"]);
      return new Response(JSON.stringify([]), { status: 200 });
    }) as typeof fetch;

    const client = new TodosClient();
    await client.tasks.list();
    // Make the file unsafe: the chain now REFUSES rather than resolving.
    chmodSync(file, 0o644);
    await client.tasks.list();

    expect(sent).toEqual(["disk-token", "disk-token"]);
    delete process.env["HASNA_TODOS_API_KEY"];
  });

  test("constructor options are tier 1 and outrank every resolved tier", () => {
    process.env["HASNA_TODOS_API_URL"] = "https://env.todos.example";
    process.env["HASNA_TODOS_API_KEY"] = "env-token";
    try {
      const client = new TodosClient({ baseUrl: "http://localhost:19428/", apiKey: "option-token" });
      expect(client.baseUrl).toBe("http://localhost:19428");
      expect(client.apiKey).toBe("option-token");
    } finally {
      delete process.env["HASNA_TODOS_API_URL"];
      delete process.env["HASNA_TODOS_API_KEY"];
    }
  });

  // M8: a 4-byte JSON body (`true`) must parse to the value, not be dropped.
  test("does not drop a 4-byte `true` response body as null", async () => {
    globalThis.fetch = (async () =>
      new Response("true", { status: 200, headers: { "content-length": "4" } })) as typeof fetch;
    const client = new TodosClient({ baseUrl: "http://localhost:19427", apiKey: "k" });
    const result = await client._get<boolean>("/api/some-boolean");
    expect(result).toBe(true);
  });

  test("still returns null for a genuinely empty body", async () => {
    globalThis.fetch = (async () =>
      new Response("", { status: 200, headers: { "content-length": "0" } })) as typeof fetch;
    const client = new TodosClient({ baseUrl: "http://localhost:19427", apiKey: "k" });
    const result = await client._get<unknown>("/api/empty");
    expect(result).toBeNull();
  });

  test("exposes typed local PR-group state and bounded history resources", async () => {
    const paths: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname;
      paths.push(path);
      if (path.endsWith("/events")) {
        return Response.json({
          history: {
            schema_version: 1,
            authoritative: true,
            authority: "local",
            group_id: "prg_test",
            events: [],
            count: 0,
            has_more: false,
            next_sequence: null,
          },
        });
      }
      return Response.json({
        view: {
          schema_version: 1,
          authoritative: true,
          authority: "local",
          group: { id: "prg_test" },
          attempts: [],
          latest_event: null,
          review_receipts: [],
          conditional_merge_receipts: [],
          cleanup_eligible: false,
          adapters: {
            work_runs: [],
            evidence_refs: [],
            proof_bundle: {},
            decision_envelope: {},
          },
          diagnostics: {
            event_count: 0,
            attempts_omitted: false,
            receipt_history_complete: true,
            projection_limits: {},
          },
        },
      });
    }) as typeof fetch;
    const client = new TodosClient({ baseUrl: "http://localhost:19427" });
    expect((await client.prGroups.get("prg_test")).group.id).toBe("prg_test");
    expect((await client.prGroups.events("prg_test", { limit: 25 })).events).toEqual([]);
    expect(paths).toEqual([
      "/api/pr-groups/prg_test",
      "/api/pr-groups/prg_test/events",
    ]);
  });

  test("publishes and validates the stable PR-group JSON projection contract", () => {
    const contract = getJsonContract("pr_group_state_view");
    expect(contract).toMatchObject({
      id: "pr_group_state_view",
      stability: "stable",
      surfaces: expect.arrayContaining(["cli", "api", "sdk"]),
      additionalProperties: false,
    });
    expect(validateJsonContract("pr_group_state_view", {
      schema_version: 1,
      authoritative: true,
      authority: "local",
      group: {},
      attempts: [],
      latest_event: null,
      review_receipts: [],
      conditional_merge_receipts: [],
      merge_receipts: [],
      cleanup_receipts: [],
      cleanup_eligible: false,
      adapters: {},
      diagnostics: {},
    })).toMatchObject({ ok: true });
  });

  // M9: subscribe() must send auth headers (x-api-key), not a bare fetch.
  test("subscribe() sends the api key header", async () => {
    let observedHeaders: Record<string, string> = {};
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      observedHeaders = (init?.headers as Record<string, string>) ?? {};
      // Empty SSE stream that closes immediately.
      const body = new ReadableStream({ start(controller) { controller.close(); } });
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
    }) as typeof fetch;
    const client = new TodosClient({ baseUrl: "http://localhost:19427", apiKey: "sekret" });
    // Drain the generator (closes immediately).
    for await (const _ of client.tasks.subscribe({ agentId: "a" })) { /* no events */ }
    expect(observedHeaders["x-api-key"]).toBe("sekret");
  });
});
