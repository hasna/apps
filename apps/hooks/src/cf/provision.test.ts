import { describe, expect, test } from "bun:test";
import { provisionCloudflareResources, type ProvisionResult } from "./provision.js";

function mockFetch(handlers: Record<string, (init?: RequestInit) => { status: number; body: unknown }>): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    for (const [pattern, handler] of Object.entries(handlers)) {
      if (url.includes(pattern)) {
        const { status, body } = handler(init);
        return new Response(JSON.stringify(body), { status });
      }
    }
    return new Response(JSON.stringify({ success: false, errors: ["unexpected call"] }), { status: 500 });
  }) as unknown as typeof fetch;
}

const AUTH_FIXTURE = "fixture-value-for-tests-only";

describe("cf provisioning dry-run", () => {
  test("returns the plan without calling the API", async () => {
    let calls = 0;
    const fetchFn = (async () => {
      calls += 1;
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const result = await provisionCloudflareResources({
      token: AUTH_FIXTURE,
      accountId: "acct",
      databaseName: "hooks-registry",
      bucketName: "hooks-registry-artifacts",
      dryRun: true,
      fetchFn,
    });
    expect(calls).toBe(0);
    expect(result.d1DatabaseId).toBeNull();
    expect(result.commands.length).toBeGreaterThan(0);
    expect(result.commands.some((c) => c.includes("wrangler deploy"))).toBe(true);
  });
});

describe("cf provisioning via API", () => {
  test("creates D1 database and R2 bucket when missing", async () => {
    const calls: string[] = [];
    const fetchFn = mockFetch({
      "/d1/database?name=hooks-registry": () => ({ status: 200, body: { success: true, result: [] } }),
      "/r2/buckets/hooks-registry-artifacts": () => {
        calls.push("r2-create");
        return { status: 200, body: { success: true, result: { name: "hooks-registry-artifacts" } } };
      },
      "/d1/database": (init) => {
        calls.push("d1-create");
        expect(JSON.parse(String(init?.body))).toEqual({ name: "hooks-registry" });
        return { status: 200, body: { success: true, result: { id: "d1-new-id" } } };
      },
      "/r2/buckets": () => ({ status: 200, body: { success: true, result: { buckets: [{ name: "other-bucket" }] } } }),
    });
    const result = await provisionCloudflareResources({
      token: AUTH_FIXTURE,
      accountId: "acct",
      databaseName: "hooks-registry",
      bucketName: "hooks-registry-artifacts",
      dryRun: false,
      fetchFn,
    });
    expect(calls).toEqual(["d1-create", "r2-create"]);
    expect(result.d1Created).toBe(true);
    expect(result.d1DatabaseId).toBe("d1-new-id");
    expect(result.r2Created).toBe(true);
    expect(result.r2BucketExists).toBe(false);
  });

  test("reuses existing D1 database and R2 bucket", async () => {
    const fetchFn = mockFetch({
      "/d1/database?name=hooks-registry": () => ({ status: 200, body: { success: true, result: [{ id: "d1-existing" }] } }),
      "/r2/buckets": () => ({ status: 200, body: { success: true, result: { buckets: [{ name: "hooks-registry-artifacts" }] } } }),
    });
    const result = await provisionCloudflareResources({
      token: AUTH_FIXTURE,
      accountId: "acct",
      databaseName: "hooks-registry",
      bucketName: "hooks-registry-artifacts",
      dryRun: false,
      fetchFn,
    });
    expect(result.d1Exists).toBe(true);
    expect(result.d1Created).toBe(false);
    expect(result.d1DatabaseId).toBe("d1-existing");
    expect(result.r2BucketExists).toBe(true);
    expect(result.r2Created).toBe(false);
  });

  test("throws with a clear error when the API fails", async () => {
    const fetchFn = mockFetch({
      "/d1/database?name=hooks-registry": () => ({ status: 403, body: { success: false, errors: [{ message: "forbidden" }] } }),
    });
    await expect(
      provisionCloudflareResources({
        token: AUTH_FIXTURE,
        accountId: "acct",
        databaseName: "hooks-registry",
        bucketName: "hooks-registry-artifacts",
        dryRun: false,
        fetchFn,
      }),
    ).rejects.toThrow(/failed to list D1 databases/);
  });

  test("result shape is stable for consumers", () => {
    const result: ProvisionResult = {
      d1DatabaseId: null,
      d1Created: false,
      d1Exists: false,
      r2BucketExists: false,
      r2Created: false,
      commands: [],
    };
    expect(Object.keys(result).sort()).toEqual(["commands", "d1Created", "d1DatabaseId", "d1Exists", "r2BucketExists", "r2Created"]);
  });
});
