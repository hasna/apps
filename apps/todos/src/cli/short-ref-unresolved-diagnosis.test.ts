import { afterEach, describe, expect, test } from "bun:test";
import {
  cloudResolveTaskRef,
  getTodosCloudClient,
  resetTodosCloudClient,
} from "./cloud-router.js";

/**
 * Regression for task 0deeffb7 (A9-00143).
 *
 * MEASURED against the live authority https://todos.hasna.xyz on 2026-08-08 with
 * @hasna/todos 0.15.12, controlled on ONE row so the identifier form was the only
 * variable:
 *
 *   todos show 0deeffb7-1019-46e1-a426-93beba588cb5   rc=0, task returned
 *   todos show A9-00143            (the SAME row)     rc=1, "Task not found: A9-00143"
 *
 * The row exists. The CLI already implements server-side short-reference
 * resolution and the postgres adapter implements `resolveRef` case-insensitively,
 * so the miss comes from the DEPLOYED authority predating that capability — it
 * answers `GET /v1/tasks/<short-ref>` with 404.
 *
 * The defect fixed here is what the CLI then SAYS. "Task not found" asserts that
 * the task does not exist, which is a stronger claim than the CLI can support: a
 * 404 on a short reference is returned both by an authority that has no such task
 * AND by an authority that cannot resolve that identifier form at all. The two are
 * indistinguishable in the response, so the message must not pick one. Reading it
 * as absence is the natural reading and it is how an agent concludes a live row
 * was deleted.
 *
 * A full UUID never reaches this path — `cloudResolveTaskRef` short-circuits it
 * with no round trip — so the diagnosis can only ever attach to a short reference.
 */
const CLOUD_ENV = {
  HASNA_TODOS_STORAGE_MODE: "self_hosted",
  HASNA_TODOS_API_URL: "https://todos.example.com",
  HASNA_TODOS_API_KEY: "hasna_todos_test_key",
};

type Call = { url: string; method: string };
let previousFetch: typeof globalThis.fetch | undefined;

function installFetch(handler: (call: Call) => { status?: number; body?: unknown }): Call[] {
  previousFetch ??= globalThis.fetch;
  const calls: Call[] = [];
  (globalThis as any).fetch = async (input: any, init: any = {}) => {
    const call: Call = { url: String(input), method: (init.method || "GET").toUpperCase() };
    calls.push(call);
    const { status = 200, body } = handler(call);
    return new Response(body === undefined ? "" : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
  return calls;
}

afterEach(() => {
  if (previousFetch) globalThis.fetch = previousFetch;
  previousFetch = undefined;
  resetTodosCloudClient();
});

describe("an unresolved SHORT reference is not reported as a missing task", () => {
  test("a 404 on a short id names the unsupported-resolution possibility instead of asserting absence", async () => {
    const calls = installFetch((call) => {
      if (new URL(call.url).pathname === "/v1/tasks/a9-00143") {
        return { status: 404, body: { error: "task not found" } };
      }
      throw new Error(`unexpected request: ${call.url}`);
    });
    const client = getTodosCloudClient(CLOUD_ENV)!;
    const resolution = cloudResolveTaskRef(client, "A9-00143");

    // The reference is still named, so the message stays greppable and specific.
    await expect(resolution).rejects.toThrow("A9-00143");
    // The load-bearing assertion: the CLI must surface that a 404 on a short
    // reference is ALSO what an authority without short-reference resolution
    // returns, rather than claiming the task is absent.
    await expect(resolution).rejects.toThrow(/short reference/i);
    await expect(resolution).rejects.toThrow(/full task UUID/i);
    // Still ONE bounded request — the diagnosis must not reintroduce paging.
    expect(calls.map((call) => new URL(call.url).pathname)).toEqual(["/v1/tasks/a9-00143"]);
  });

  test("an authority that answers with an UNRELATED task is reported as a mismatch, not as resolution", async () => {
    installFetch((call) => {
      if (new URL(call.url).pathname === "/v1/tasks/ope2-00125") {
        return { body: { task: { id: "abc00000-0000-4000-8000-000000000002", short_id: "OTHER-99999" } } };
      }
      throw new Error(`unexpected request: ${call.url}`);
    });
    const client = getTodosCloudClient(CLOUD_ENV)!;
    const resolution = cloudResolveTaskRef(client, "OPE2-00125");
    await expect(resolution).rejects.toThrow("OPE2-00125");
    // A returned-but-mismatched task is a DIFFERENT condition from a 404 and must
    // not borrow the unsupported-resolution diagnosis: the authority did resolve
    // something, it just did not match.
    await expect(resolution).rejects.not.toThrow(/short reference/i);
  });

  test("NEGATIVE CONTROL: a full UUID never reaches the diagnosis and issues no request", async () => {
    const calls = installFetch(() => {
      throw new Error("a full UUID must not issue any request");
    });
    const client = getTodosCloudClient(CLOUD_ENV)!;
    const uuid = "0deeffb7-1019-46e1-a426-93beba588cb5";
    await expect(cloudResolveTaskRef(client, uuid)).resolves.toBe(uuid);
    expect(calls).toHaveLength(0);
  });

  test("POSITIVE CONTROL: a capable authority still resolves the short id to the same task", async () => {
    const id = "0deeffb7-1019-46e1-a426-93beba588cb5";
    installFetch((call) => {
      if (new URL(call.url).pathname === "/v1/tasks/a9-00143") {
        return { body: { task: { id, short_id: "A9-00143" } } };
      }
      throw new Error(`unexpected request: ${call.url}`);
    });
    const client = getTodosCloudClient(CLOUD_ENV)!;
    // Same row, both identifier forms — the property the live measurement broke.
    await expect(cloudResolveTaskRef(client, "A9-00143")).resolves.toBe(id);
  });
});
