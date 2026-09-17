import { describe, expect, test } from "bun:test";
import { GeneratedInstructionsV1Client, InstructionsV1Client as PublicInstructionsV1Client } from "./index.js";
import { InstructionsV1Client } from "./v1-client.js";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("InstructionsV1Client mixed-version compatibility", () => {
  test("exports the compatibility facade as the public InstructionsV1Client", () => {
    const client = new PublicInstructionsV1Client({
      baseUrl: "https://api.hasna.com/instructions",
      fetch: (async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse({ configs: [], count: 0 })) as typeof fetch,
    });

    expect(client).toBeInstanceOf(InstructionsV1Client);
    expect(client).toBeInstanceOf(GeneratedInstructionsV1Client);
  });

  test("normalizes production 0.5 legacy config/profile/machine arrays into bounded envelopes", async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/configs")) {
        return jsonResponse({ configs: [
          { id: "c1", name: "One", slug: "one", content: "private", target_path: "/private" },
          { id: "c2", name: "Two", slug: "two", content: "private-2", target_path: "/private-2" },
        ], count: 2 });
      }
      if (url.pathname.endsWith("/profiles")) {
        return jsonResponse({ profiles: [{ id: "p1", name: "Default", slug: "default", variables: { secret: true } }], count: 1 });
      }
      if (url.pathname.endsWith("/machines")) {
        return jsonResponse({ machines: [{ id: "m1", hostname: "station06", os: "darwin", arch: "arm64", last_applied_at: null, created_at: "" }], count: 1 });
      }
      throw new Error(`unexpected URL ${url}`);
    }) as typeof fetch;
    const client = new InstructionsV1Client({ baseUrl: "https://api.hasna.com/instructions", fetch: fetchImpl });

    const configs = await client.listConfigs({ limit: 1, cursor: 1 });
    expect(configs).toMatchObject({ total: 2, limit: 1, cursor: 1, complete: true, source_bounded: false });
    expect(configs.items.map((item) => item.id)).toEqual(["c2"]);

    const identities = await client.listConfigs({ view: "identity", limit: 100, cursor: 0 });
    expect(identities.items.map((item) => item.id)).toEqual(["c1", "c2"]);
    expect(JSON.stringify(identities)).not.toContain("private");
    expect(JSON.stringify(identities)).not.toContain("target_path");

    expect(await client.listProfiles({ limit: 100, cursor: 0 })).toMatchObject({ total: 1, complete: true, source_bounded: false });
    expect(await client.listMachines({ limit: 100, cursor: 0 })).toMatchObject({ total: 1, complete: true, source_bounded: false });
  });

  test("preserves the pre-0.7 positional RequestInit forms for snapshot methods", async () => {
    const calls: Array<{ url: URL; init?: RequestInit }> = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      calls.push({ url, init });
      if (init?.method === "GET") return jsonResponse({ snapshots: [], count: 0 });
      return new Response(JSON.stringify({ snapshot: { id: "s1", config_id: "c1", content: "", version: 1, created_at: "" } }), { status: 201 });
    }) as typeof fetch;
    const client = new InstructionsV1Client({ baseUrl: "https://api.hasna.com/instructions", fetch: fetchImpl });
    const legacyInit = { headers: { "x-legacy-init": "present" } } satisfies RequestInit;

    await client.listSnapshots("c1", legacyInit);
    await client.createSnapshot("c1", legacyInit);

    expect(calls[0]?.url.searchParams.has("headers")).toBe(false);
    expect(new Headers(calls[0]?.init?.headers).get("x-legacy-init")).toBe("present");
    expect(new Headers(calls[1]?.init?.headers).get("x-legacy-init")).toBe("present");
    expect(calls[1]?.init?.body).toBeUndefined();
  });
  test("preserves positional RequestInit and normalizes legacy binding collections", async () => {
    const calls: Array<{ url: URL; init?: RequestInit }> = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      calls.push({ url, init });
      if (url.pathname.endsWith("/bindings")) return jsonResponse({ bindings: [{ profile_id: "p1", config_id: "c1", sort_order: 0, binding: {} }] });
      return jsonResponse({ assets: [{ profile_id: "p1", source_config_id: "c1", sort_order: 0, binding: { assetKey: "skill" } }] });
    }) as typeof fetch;
    const client = new InstructionsV1Client({ baseUrl: "https://api.hasna.com/instructions", fetch: fetchImpl });
    const legacyInit = { headers: { "x-legacy-init": "present" } } satisfies RequestInit;

    const bindings = await client.getProfileConfigBindings("p1", legacyInit);
    const assets = await client.getProfileAssetBindings("p1", legacyInit);

    expect(bindings).toMatchObject({ total: 1, complete: true, source_bounded: false });
    expect(assets).toMatchObject({ total: 1, complete: true, source_bounded: false });
    for (const call of calls) {
      expect(call.url.searchParams.has("headers")).toBe(false);
      expect(new Headers(call.init?.headers).get("x-legacy-init")).toBe("present");
    }
  });

  test("exposes every newly documented route through the compatibility facade", async () => {
    const calls: Array<{ url: URL; init?: RequestInit }> = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      calls.push({ url, init });
      if (url.pathname.endsWith("/snapshots/prune")) return jsonResponse({ pruned: 3 });
      if (url.pathname.includes("/snapshots/")) {
        return jsonResponse({ snapshot: { id: "s1", config_id: "c1", content: "content", version: 7, created_at: "" } });
      }
      if (url.pathname.startsWith("/instructions/v1/snapshots/")) {
        return jsonResponse({ snapshot: { id: "snapshot/id", config_id: "c1", content: "content", version: 7, created_at: "" } });
      }
      if (url.pathname.endsWith("/machines/applied")) return jsonResponse({ updated: true });
      if (url.pathname.endsWith("/feedback")) return new Response(JSON.stringify({ ok: true }), { status: 201 });
      return jsonResponse({ profile: { id: "p1", name: "Default", slug: "default" } });
    }) as typeof fetch;
    const client = new InstructionsV1Client({ baseUrl: "https://api.hasna.com/instructions", fetch: fetchImpl });

    await client.updateProfile("profile/id", { description: null });
    await client.putProfile("profile/id", { variables: { theme: "dark" } });
    await client.getSnapshotByVersion("config/id", 7);
    await client.pruneSnapshots("config/id", { keep: 4 });
    await client.getSnapshot("snapshot/id");
    await client.markMachineApplied({ hostname: "station06" });
    await client.createFeedback({ message: "Useful", category: "docs", version: "0.7.0" });

    expect(calls.map(({ url, init }) => [init?.method, url.pathname])).toEqual([
      ["PATCH", "/instructions/v1/profiles/profile%2Fid"],
      ["PUT", "/instructions/v1/profiles/profile%2Fid"],
      ["GET", "/instructions/v1/configs/config%2Fid/snapshots/7"],
      ["POST", "/instructions/v1/configs/config%2Fid/snapshots/prune"],
      ["GET", "/instructions/v1/snapshots/snapshot%2Fid"],
      ["POST", "/instructions/v1/machines/applied"],
      ["POST", "/instructions/v1/feedback"],
    ]);
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ description: null });
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({ variables: { theme: "dark" } });
    expect(JSON.parse(String(calls[3]?.init?.body))).toEqual({ keep: 4 });
    expect(JSON.parse(String(calls[5]?.init?.body))).toEqual({ hostname: "station06" });
    expect(JSON.parse(String(calls[6]?.init?.body))).toEqual({
      message: "Useful",
      category: "docs",
      version: "0.7.0",
    });
  });

});
