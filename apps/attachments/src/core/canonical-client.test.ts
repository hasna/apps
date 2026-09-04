import { describe, expect, test } from "bun:test";
import { resolveAttachmentsV1 } from "./cloud-v1";
import { resolveServerDatabase } from "../serve/database";
import { AttachmentsApiClient } from "../../sdk/src/generated";
import * as publicApi from "../index";

const valid = { HASNA_ATTACHMENTS_API_URL: "https://attachments.example.test", HASNA_ATTACHMENTS_API_KEY: "test-only-key" };
describe("canonical HTTPS boundary", () => {
  test("public exports cannot construct local databases or services", () => {
    for (const name of ["LocalStore", "LocalObjectStore", "AttachmentsDB", "createApp", "startServer", "uploadFile", "createObjectStore", "S3Client"]) expect(name in publicApi).toBe(false);
    expect(() => publicApi.resolveStore({})).toThrow();
    expect(() => publicApi.resolveStore(valid, { forceLocal: true })).toThrow();
  });
  test("server requires validated PostgreSQL, never SQLite or a mode", () => {
    for (const env of [{}, { HASNA_ATTACHMENTS_DATABASE_URL: "sqlite:local.db" }, { HASNA_ATTACHMENTS_DATABASE_URL: " " }, { HASNA_ATTACHMENTS_DATABASE_URL: "postgres://host/db", ATTACHMENTS_DATABASE_URL: "postgres://other/db" }, { HASNA_ATTACHMENTS_STORAGE_MODE: "local", HASNA_ATTACHMENTS_DATABASE_URL: "postgres://host/db" }]) expect(() => resolveServerDatabase(env)).toThrow();
    expect(resolveServerDatabase({ HASNA_ATTACHMENTS_DATABASE_URL: "postgresql://host/db" })).toBe("postgresql://host/db");
  });
  test("generated SDK requires credentials and refuses auth overrides or redirects", async () => {
    expect(() => new AttachmentsApiClient({ baseUrl: "http://localhost", apiKey: "test-key" })).toThrow();
    expect(() => new AttachmentsApiClient({ baseUrl: "https://example.test", apiKey: "" })).toThrow();
    expect(() => new AttachmentsApiClient({ baseUrl: "https://example.test", apiKey: "test-key", headers: { Authorization: "conflict" } })).toThrow();
    const client = new AttachmentsApiClient({ baseUrl: "https://example.test", apiKey: "test-key", fetch: (async (_url, init) => {
      expect(init?.redirect).toBe("error");
      expect(new Headers(init?.headers).get("authorization")).toBe(null);
      expect(new Headers(init?.headers).get("x-api-key")).toBe("test-key");
      return Response.json([]);
    }) as typeof fetch });
    expect(JSON.stringify(client)).not.toContain("test-key");
    await client.listAttachments(undefined, { redirect: "follow" });
  });
  for (const env of [{}, { HASNA_ATTACHMENTS_API_URL: valid.HASNA_ATTACHMENTS_API_URL }, { ...valid, HASNA_ATTACHMENTS_API_KEY: " " }, { ...valid, HASNA_ATTACHMENTS_API_URL: "http://localhost:3000" }, { ...valid, ATTACHMENTS_API_KEY: "conflict" }, { ...valid, HASNA_ATTACHMENTS_STORAGE_MODE: "local" }, { ...valid, HASNA_ATTACHMENTS_DATABASE_URL: "postgres://example/db" }]) {
    test("rejects absent, partial, insecure, conflicting, or retired configuration", () => {
      expect(() => resolveAttachmentsV1(env)).toThrow();
    });
  }
  test("authenticated requests disable redirects and never replay bodies", async () => {
    let calls = 0;
    const resolved = resolveAttachmentsV1(valid, { fetchImpl: (async (_url, init) => {
      calls++;
      expect(init?.redirect).toBe("error");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-only-key");
      return new Response("redirect", { status: 307, headers: { location: "https://other.example.test" } });
    }) as typeof fetch });
    await expect(resolved.store!.uploadBuffer("test.txt", new Uint8Array([1]))).rejects.toThrow();
    expect(calls).toBe(1);
  });
});
