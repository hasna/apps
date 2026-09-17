import { describe, expect, test } from "bun:test";
import {
  HttpInputError,
  MAX_REQUEST_BODY_BYTES,
  MAX_SEARCH_QUERY_CHARS,
  boundedSearchQuery,
  readJson,
} from "./v1";

describe("Instructions API input bounds", () => {
  test("reads valid bounded JSON and preserves empty-body semantics", async () => {
    await expect(readJson(new Request("http://local/v1", { method: "POST" }))).resolves.toEqual({});
    await expect(readJson(new Request("http://local/v1", { method: "POST", body: JSON.stringify({ ok: true }) }))).resolves.toEqual({ ok: true });
    await expect(readJson(new Request("http://local/v1", { method: "POST", body: "{" }))).resolves.toBeNull();
  });

  test("rejects both declared and streaming bodies over 1 MiB", async () => {
    const declared = new Request("http://local/v1", {
      method: "POST",
      headers: { "content-length": String(MAX_REQUEST_BODY_BYTES + 1) },
      body: "{}",
    });
    await expect(readJson(declared)).rejects.toMatchObject({ status: 413, code: "REQUEST_BODY_TOO_LARGE" });

    const bytes = new Uint8Array(MAX_REQUEST_BODY_BYTES + 1).fill(0x20);
    const streaming = new Request("http://local/v1", { method: "POST", body: bytes });
    streaming.headers.delete("content-length");
    await expect(readJson(streaming)).rejects.toBeInstanceOf(HttpInputError);
  });

  test("caps search before it reaches PostgreSQL", () => {
    expect(boundedSearchQuery(null)).toBeUndefined();
    expect(boundedSearchQuery("rules")).toBe("rules");
    expect(() => boundedSearchQuery("x".repeat(MAX_SEARCH_QUERY_CHARS + 1))).toThrow("search query exceeds");
  });
});
