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
  for (const env of [{}, { HASNA_ATTACHMENTS_API_URL: valid.HASNA_ATTACHMENTS_API_URL }, { ...valid, HASNA_ATTACHMENTS_API_KEY: " " }, { ...valid, HASNA_ATTACHMENTS_API_URL: "http://attachments.example.test:3000" }, { ...valid, ATTACHMENTS_API_KEY: "conflict" }]) {
    test("rejects absent, partial, insecure, or conflicting configuration", () => {
      expect(() => resolveAttachmentsV1(env)).toThrow();
    });
  }
  test("exact loopback HTTP is the shared resolver's bounded dev allowance, never a local store", () => {
    // The @hasna/contracts URL contract permits http ONLY for exact loopback
    // authorities (localhost / 127.0.0.1 / [::1]) — a development allowance,
    // not a local-data fallback. The client still resolves a real credential
    // and drives the authenticated HTTP client.
    const resolved = resolveAttachmentsV1({ ...valid, HASNA_ATTACHMENTS_API_URL: "http://localhost:3000" }, {
      fetchImpl: (async () => Response.json([])) as unknown as typeof fetch,
    });
    expect(resolved.transport).toBe("cloud-http");
  });
  test("retired mode selectors and client database URLs are inert, never a local route", () => {
    for (const extra of [
      { HASNA_ATTACHMENTS_STORAGE_MODE: "local" },
      { HASNA_ATTACHMENTS_MODE: "local" },
      { HASNA_ATTACHMENTS_DATABASE_URL: "postgres://example/db" },
      { ATTACHMENTS_DATABASE_URL: "postgres://example/db" },
      { HASNA_ATTACHMENTS_DB_PATH: "/tmp/attachments.db" },
    ]) {
      const resolved = resolveAttachmentsV1({ ...valid, ...extra }, {
        fetchImpl: (async () => Response.json([])) as unknown as typeof fetch,
      });
      expect(resolved.transport).toBe("cloud-http");
      if (resolved.transport === "cloud-http") expect(resolved.store.baseUrl).toBe("https://attachments.example.test/v1");
    }
  });
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
