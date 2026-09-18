import { describe, expect, test } from "bun:test";
import { ApiStore } from "./api-store.js";
import type { FilesStorageClient } from "./client-types.js";

function store(response: Response, requested: string[] = []) {
  // This operation must use only the authenticated raw-response transport.
  return new ApiStore({} as FilesStorageClient, async (path) => {
    requested.push(path);
    return response;
  });
}

describe("hosted download completeness", () => {
  test("reports byte counts for complete responses and legacy responses with unknown size", async () => {
    for (const headers of [{ "x-files-size": "3" }, {}]) {
      const chunks: Uint8Array[] = [];
      const result = await store(new Response("abc", { headers })).downloadFileContent("f_one", (chunk) => {
        chunks.push(chunk);
      });
      expect(result).toEqual({ truncated: false, totalBytes: "x-files-size" in headers ? 3 : undefined, bytesRead: 3 });
      expect(Buffer.concat(chunks).toString()).toBe("abc");
    }
  });

  test("preserves an explicitly requested bounded read and its truncation receipt", async () => {
    const requested: string[] = [];
    const result = await store(new Response("abc", {
      headers: { "x-files-size": "10", "x-files-truncated": "1" },
    }), requested).downloadFileContent("f_one", () => {}, { max_bytes: 3 });
    expect(result).toEqual({ truncated: true, totalBytes: 10, bytesRead: 3 });
    expect(requested).toEqual(["/files/f_one/content?max_bytes=3"]);
  });

  test("rejects an unsolicited HTTP partial response even without the custom truncation header", async () => {
    let writes = 0;
    await expect(store(new Response("abc", { status: 206 })).downloadFileContent("f_one", () => { writes++; }))
      .rejects.toThrow("truncated");
    expect(writes).toBe(0);
  });

  test("preserves bounded consumers that cap legacy servers ignoring max_bytes", async () => {
    const chunks: Uint8Array[] = [];
    const result = await store(new Response("abcd", { headers: { "x-files-size": "4" } }))
      .downloadFileContent("f_one", (chunk) => { chunks.push(chunk); }, { max_bytes: 3 });
    expect(result).toEqual({ truncated: false, totalBytes: 4, bytesRead: 4 });
    expect(Buffer.concat(chunks).toString()).toBe("abcd");
  });

  test.each(["", "-1", "1.5", "Infinity", "9007199254740992"])("rejects malformed object size %s", async (size) => {
    await expect(store(new Response("abc", { headers: { "x-files-size": size } }))
      .downloadFileContent("f_one", () => {})).rejects.toThrow("invalid size metadata");
  });

  test("cancels the upstream body when the destination write fails", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array([1, 2, 3])); },
      cancel() { cancelled = true; },
    });
    await expect(store(new Response(body)).downloadFileContent("f_one", () => {
      throw new Error("fixture output failure");
    })).rejects.toThrow("fixture output failure");
    expect(cancelled).toBe(true);
    expect(body.locked).toBe(false);
  });

  test.each([NaN, Infinity, -1, 0, 0.5])("rejects invalid requested bounds before fetching: %s", async (max_bytes) => {
    const requested: string[] = [];
    await expect(store(new Response("abc"), requested).downloadFileContent("f_one", () => {}, { max_bytes }))
      .rejects.toThrow("positive safe integer");
    expect(requested).toEqual([]);
  });
});
