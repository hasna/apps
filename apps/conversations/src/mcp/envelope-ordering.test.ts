/**
 * The disclosed ordering on every MCP envelope, asserted against the rows the
 * envelope actually returned.
 *
 * This file exists because the first version of this change shipped a
 * disclosure that LIED on this surface, and nothing caught it. The CLI-side
 * ordering tests were strong — mutation-checked, both directions, real row
 * order — but they exercise the CLI, and `src/mcp/compact.ts` is a SECOND,
 * parallel implementation. Nothing in the suite touched an MCP envelope at all,
 * so a descriptor computed separately from the query was free to disagree with
 * it. Measured over a live stdio session before this fix:
 *
 *     read_messages{latest:3}   disclosed created_at asc   returned ids 6,5,4
 *     get_pinned_messages       disclosed created_at asc   returned ids 5,4,3
 *
 * Replacing silence with a false statement is worse than the silence it
 * replaced: on `main` these envelopes carried no ordering field, so a reader
 * had no warrant to trust the row order. A wrong `sort` grants exactly that
 * warrant, on the affordance ("give me the newest N") that every consequence in
 * todos 4b213553 came from.
 *
 * So each assertion below checks the disclosure against reality rather than
 * against a constant. A test that asserted `sort === "created_at"` would have
 * passed on the broken code — that is precisely what the broken code said.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const TEST_DB = join(tmpdir(), `conversations-envelope-order-${Date.now()}.db`);
let client: Client;

interface Envelope {
  sort?: string;
  direction?: string;
  [key: string]: unknown;
}

function payloadOf(result: unknown): Envelope {
  const text = ((result as { content: Array<{ text: string }> }).content[0]).text;
  return JSON.parse(text) as Envelope;
}

async function call(name: string, args: Record<string, unknown> = {}): Promise<Envelope> {
  return payloadOf(await client.callTool({ name, arguments: args }));
}

/**
 * Assert that `values` really are ordered the way `envelope` claims.
 *
 * Ties are allowed (non-strict), because `created_at` has millisecond
 * resolution and relevance scores genuinely tie; a strict check would fail on
 * correct data. Direction is what this catches, and direction is what was
 * wrong.
 */
function expectOrderedAs(envelope: Envelope, values: Array<string | number>): void {
  expect(envelope.direction === "asc" || envelope.direction === "desc").toBe(true);
  const sorted = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (envelope.direction === "desc") sorted.reverse();
  expect(values).toEqual(sorted);
}

/**
 * ISOLATION, and why this fixture is written defensively.
 *
 * The first version of this file connected to the MODULE SINGLETON `server`
 * exported by ./index.js and seeded presence with the `register_agent` tool.
 * Both are shared-state mutations, and together they turned CI red while every
 * local run stayed green:
 *
 *   - The MCP identity chain is explicit -> CONVERSATIONS_AGENT_ID ->
 *     getSessionAgent(server) -> installation identity (./identity.ts). The
 *     `register_agent` handler calls setSessionAgent() on the server it is
 *     registered against, and session state is keyed by McpServer instance
 *     (a WeakMap in ./channel.ts). Registering on the singleton therefore left
 *     a session agent that every later test sharing that singleton inherited —
 *     so the seven "refuses to attribute when `from` is omitted" guards in
 *     index.test.ts stopped refusing and returned isError: undefined.
 *   - `register_agent` additionally seeds the machine identity file when none
 *     exists (updateCachedAutoName -> persistIdentity), so on a fresh runner it
 *     WRITES to $HOME. A test must not do that.
 *
 * It reproduced only on CI because it depends on file execution order — the
 * contamination is invisible when index.test.ts happens to run first, which is
 * what happened locally. A local green could not discriminate, which is why the
 * fix was validated against CI rather than against this machine.
 *
 * So: a private server instance, presence seeded through `heartbeat` with an
 * explicit `from` (which writes no identity file), and every environment
 * variable restored on the way out.
 */
const savedEnv: Record<string, string | undefined> = {};
function setEnv(key: string, value: string | undefined): void {
  if (!(key in savedEnv)) savedEnv[key] = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

beforeAll(async () => {
  setEnv("CONVERSATIONS_DB_PATH", TEST_DB);
  setEnv("CONVERSATIONS_AGENT_ID", "envelope-reader");
  setEnv("CONVERSATIONS_USE_MACHINE_IDENTITY", undefined);

  const { closeDb } = await import("../lib/db.js");
  closeDb();

  // buildServer(), never the exported singleton: session identity is keyed by
  // McpServer instance, so a private instance cannot leak into another file.
  const { buildServer } = await import("./index.js");
  const server = buildServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "envelope-order-test", version: "1.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  await call("create_channel", { name: "env-alpha" });
  await call("create_channel", { name: "env-bravo" });
  await call("create_channel", { name: "env-charlie" });

  // Six DMs, sent one at a time so created_at and id both increase strictly.
  for (let i = 1; i <= 6; i++) {
    await call("send_message", { to: "envelope-reader", from: "envelope-writer", content: `env-dm-${i}` });
  }
  for (let i = 1; i <= 4; i++) {
    await call("send_to_channel", { channel: "env-alpha", from: "envelope-writer", content: `env-chan-${i}` });
  }
});

afterAll(async () => {
  await client.close();
  const { closeDb } = await import("../lib/db.js");
  closeDb();

  const { _resetAutoName } = await import("../lib/identity.js");
  _resetAutoName();
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  for (const suffix of ["", "-wal", "-shm"]) {
    try { unlinkSync(`${TEST_DB}${suffix}`); } catch {}
  }
});

describe("MCP envelopes disclose the ordering they actually returned", () => {
  /**
   * The P1. `latest: N` overrides `order` to DESC inside readMessages, so a
   * descriptor derived from `args.order` alone states the opposite of what ran.
   */
  test("read_messages{latest} discloses desc AND returns descending ids", async () => {
    const envelope = await call("read_messages", { to: "envelope-reader", latest: 3, mark_read: false });
    const ids = (envelope.messages as Array<{ id: number }>).map((m) => m.id);

    expect(ids.length).toBeGreaterThan(1);
    expect(envelope.sort).toBe("created_at");
    expect(envelope.direction).toBe("desc");
    expectOrderedAs(envelope, ids);

    // The assertion that fails on the pre-fix code: it disclosed "asc" here.
    expect(ids[0]).toBeGreaterThan(ids[ids.length - 1]);
  });

  test("read_messages without latest discloses asc AND returns ascending ids", async () => {
    const envelope = await call("read_messages", { to: "envelope-reader", limit: 3, mark_read: false });
    const ids = (envelope.messages as Array<{ id: number }>).map((m) => m.id);

    expect(envelope.sort).toBe("created_at");
    expect(envelope.direction).toBe("asc");
    expectOrderedAs(envelope, ids);
    expect(ids[0]).toBeLessThan(ids[ids.length - 1]);
  });

  test("read_channel discloses the direction it returned, with and without latest", async () => {
    const ascending = await call("read_channel", { channel: "env-alpha", limit: 3, mark_read: false });
    const ascendingIds = (ascending.messages as Array<{ id: number }>).map((m) => m.id);
    expect(ascending.direction).toBe("asc");
    expectOrderedAs(ascending, ascendingIds);

    const newest = await call("read_channel", { channel: "env-alpha", latest: 3, mark_read: false });
    const newestIds = (newest.messages as Array<{ id: number }>).map((m) => m.id);
    expect(newest.direction).toBe("desc");
    expectOrderedAs(newest, newestIds);

    // The two windows must genuinely differ, or neither assertion proves
    // anything: with a window smaller than the cap, "oldest N" and "newest N"
    // are the same N rows and a wrong descriptor survives.
    expect(newestIds).not.toEqual(ascendingIds);
  });

  /**
   * The second P1: this tool routes through the shared message envelope but
   * queries a different table order — pinned_at DESC. The pre-fix code
   * disclosed the message descriptor, wrong in FIELD and DIRECTION.
   */
  test("get_pinned_messages discloses pinned_at desc AND returns pin order reversed", async () => {
    const dms = await call("read_messages", { to: "envelope-reader", limit: 6, mark_read: false });
    const ids = (dms.messages as Array<{ id: number }>).map((m) => m.id);

    // Pin in an order that is NEITHER created_at ascending nor descending, so
    // the expected result can be confused with no other ordering. Pinning
    // simply "backwards" is not enough: pinned_at DESC over reverse-pinned rows
    // reproduces created_at ASC exactly, and the test would then pass against
    // the very descriptor it is meant to reject.
    const pinOrder = [ids[2], ids[0], ids[1]];
    for (const id of pinOrder) {
      await call("pin_message", { id });
    }

    const envelope = await call("get_pinned_messages", {});
    const returned = (envelope.messages as Array<{ id: number }>).map((m) => m.id);

    expect(envelope.sort).toBe("pinned_at");
    expect(envelope.direction).toBe("desc");

    // Most recently pinned first — the reverse of the order they were pinned in.
    expect(returned).toEqual([...pinOrder].reverse());
    // And distinguishable from BOTH message orderings, so neither the old
    // wrong descriptor nor its opposite could satisfy this assertion.
    expect(returned).not.toEqual([...returned].sort((a, b) => a - b));
    expect(returned).not.toEqual([...returned].sort((a, b) => b - a));
  });

  test("get_blockers discloses created_at asc AND returns oldest blocker first", async () => {
    for (let i = 1; i <= 3; i++) {
      await call("send_message", {
        to: "envelope-reader",
        from: "envelope-writer",
        content: `env-blocker-${i}`,
        blocking: true,
      });
    }

    const envelope = await call("get_blockers", { from: "envelope-reader" });
    const ids = (envelope.messages as Array<{ id: number }>).map((m) => m.id);

    expect(envelope.sort).toBe("created_at");
    expect(envelope.direction).toBe("asc");
    expectOrderedAs(envelope, ids);
  });

  /**
   * KNOWN-WEAK, deliberately left weak, and filed as `35709a95`.
   *
   * This assertion cannot currently fail on a broken query order, and hardening
   * it is NOT a test-only change — the attempt surfaced a real defect in the
   * search disclosure that needs a design decision, so it is filed rather than
   * rushed into the last remediation cycle.
   *
   * The weakness: it searches `env-dm`, whose matches are the six seeded DMs.
   * The pinned test above pins three of them and `pinnedBoost` lifts exactly
   * those, so scores come back [120,120,120,100,100] against ids [1,2,3,4,5] —
   * descending score coincides exactly with ascending id, and forcing the query
   * to `created_at ASC` changes nothing observable.
   *
   * What hardening revealed: seed three matches with DIFFERENT priorities and
   * the rows come back with relevance_score ASCENDING ([50,100,1000]) while the
   * envelope discloses `relevance desc`. That is not a fixture problem. The SQL
   * orders by `ORDER BY rank` — raw BM25 — while `relevance_score` is computed
   * afterwards in JS with priority/pinned/blocking boosts the ordering never
   * saw. The rows are therefore genuinely not in the order of the score the
   * payload exposes, and the LIKE fallback is worse: it orders by
   * `created_at DESC` and returns `relevance_score: 0` for every row while the
   * descriptor still claims `relevance desc`.
   *
   * Deciding what `sort` should say there is a design call, not a one-liner.
   * See `35709a95`.
   */
  test("search_messages discloses relevance desc and returns non-increasing scores", async () => {
    const envelope = await call("search_messages", { query: "env-dm", limit: 5 });
    const results = envelope.results as Array<{ relevance_score: number }>;

    expect(results.length).toBeGreaterThan(0);
    expect(envelope.sort).toBe("relevance");
    expect(envelope.direction).toBe("desc");
    expectOrderedAs(envelope, results.map((r) => r.relevance_score));
  });

  test("list_channels discloses name asc AND returns alphabetical names", async () => {
    const envelope = await call("list_channels", {});
    const names = (envelope.channels as Array<{ name: string }>).map((c) => c.name);

    expect(names.length).toBeGreaterThan(1);
    expect(envelope.sort).toBe("name");
    expect(envelope.direction).toBe("asc");
    expectOrderedAs(envelope, names);
  });

  test("list_agents discloses last_seen_at desc AND returns newest-seen first", async () => {
    // Presence rows exist only for agents that registered; sending a message
    // does not create one, so an unseeded list_agents returns zero rows and
    // every ordering assertion over it would pass vacuously.
    //
    // Seeded with `heartbeat` and an explicit `from` rather than
    // `register_agent`: register_agent seeds the machine identity FILE when
    // none exists, so on a fresh runner it writes to $HOME. heartbeat creates
    // the presence row this test needs and nothing else.
    await call("heartbeat", { from: "env-agent-older" });
    await Bun.sleep(15);
    await call("heartbeat", { from: "env-agent-newer" });

    const envelope = await call("list_agents", {});
    const seen = (envelope.agents as Array<{ last_seen_at: string }>).map((a) => a.last_seen_at);

    expect(seen.length).toBeGreaterThan(1);
    expect(envelope.sort).toBe("last_seen_at");
    expect(envelope.direction).toBe("desc");
    expectOrderedAs(envelope, seen);

    const names = (envelope.agents as Array<{ agent: string }>).map((a) => a.agent);
    expect(names.indexOf("env-agent-newer")).toBeLessThan(names.indexOf("env-agent-older"));
  });

  test("list_projects discloses name asc AND returns alphabetical names", async () => {
    await call("create_project", { name: "env-zeta-project" });
    await call("create_project", { name: "env-alpha-project" });

    const envelope = await call("list_projects", {});
    const names = (envelope.projects as Array<{ name: string }>).map((p) => p.name);

    expect(names.length).toBeGreaterThan(1);
    expect(envelope.sort).toBe("name");
    expect(envelope.direction).toBe("asc");
    expectOrderedAs(envelope, names);
  });

  test("list_sessions discloses last_message_at desc AND returns most recent first", async () => {
    const envelope = await call("list_sessions", {});
    const stamps = (envelope.sessions as Array<{ last_message_at: string }>).map((s) => s.last_message_at);

    expect(stamps.length).toBeGreaterThan(0);
    expect(envelope.sort).toBe("last_message_at");
    expect(envelope.direction).toBe("desc");
    expectOrderedAs(envelope, stamps);
  });
});
