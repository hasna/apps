import { describe, test, expect } from "bun:test";
import { ApiStore } from "./api-store.js";
import type { HasnaStorageClient } from "../contracts-client/storage.js";

// A minimal fake HasnaStorageClient whose transport returns whatever the test
// queues, so we can assert ApiStore normalizes raw API rows into the client
// contract without any network or sqlite.
function fakeClient(getBody: unknown): HasnaStorageClient {
  const transport = {
    baseUrl: "https://conversations.hasna.xyz/v1",
    // Only the verbs ApiStore's project methods touch are needed here.
    get: async () => getBody,
    post: async () => getBody,
    patch: async () => getBody,
    del: async () => undefined,
  } as unknown as HasnaStorageClient["transport"];
  return {
    name: "conversations",
    baseUrl: "https://conversations.hasna.xyz/v1",
    transport,
  } as unknown as HasnaStorageClient;
}

describe("ApiStore project normalization", () => {
  test("getProject coerces raw JSON-text tags into a string[] (regression: tags=null crash)", async () => {
    // Server returns a raw row: tags as null (the shape that crashed `project get`).
    const store = new ApiStore(fakeClient({ project: { id: "p1", name: "acme", tags: null, channel_count: 3 } }));
    const p = (await store.getProject("p1")) as unknown as { tags: string[]; channel_count: number };
    expect(Array.isArray(p.tags)).toBe(true);
    expect(p.tags.length).toBe(0);
    expect(p.channel_count).toBe(3);
    // The exact expression that used to throw must now be safe.
    expect(() => (p.tags.length > 0 ? p.tags.join(", ") : "")).not.toThrow();
  });

  test("getProject parses tags stored as a JSON string", async () => {
    const store = new ApiStore(fakeClient({ project: { id: "p2", name: "beta", tags: '["a","b"]' } }));
    const p = (await store.getProject("p2")) as unknown as { tags: string[]; channel_count: number };
    expect(p.tags).toEqual(["a", "b"]);
    expect(p.channel_count).toBe(0);
  });

  test("listProjects normalizes every row", async () => {
    const store = new ApiStore(
      fakeClient({ projects: [{ id: "p1", name: "a", tags: null }, { id: "p2", name: "b", tags: '["x"]', channel_count: 2 }] }),
    );
    const rows = (await store.listProjects()) as unknown as Array<{ tags: string[]; channel_count: number }>;
    expect(rows).toHaveLength(2);
    expect(rows[0].tags).toEqual([]);
    expect(rows[1].tags).toEqual(["x"]);
    expect(rows[1].channel_count).toBe(2);
  });

  test("getProject returns null when the API has no project", async () => {
    const store = new ApiStore(fakeClient({ project: null }));
    expect(await store.getProject("missing")).toBeNull();
  });
});
