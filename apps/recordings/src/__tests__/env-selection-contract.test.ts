import { describe, expect, test } from "bun:test";
import { resolveTransport, resolveStorageClient } from "../http/client.js";
import { resolveDataBackend, isPostgresBackendEnabled } from "../server/cloud-config.js";

const APP = "recordings";

// The two-backend selection contract. There is exactly one selection mechanism
// per role, and it is the environment:
//   - client: the presence of BOTH HASNA_<APP>_API_URL and HASNA_<APP>_API_KEY
//     selects the hosted HTTP store; any other environment reads the on-box
//     SQLite file. A partial setup fails closed.
//   - server: the presence of a PostgreSQL DSN selects the postgresql backend;
//     anything else serves from SQLite.
// No variable carries a placement word, and no word selects a backend.

describe("client env-selection contract", () => {
  test("no hosted env -> on-box sqlite, not misconfigured", () => {
    const r = resolveTransport(APP, {});
    expect(r.transport).toBe("sqlite");
    expect(r.misconfigured).toBe(false);
    expect(r.baseUrl).toBeNull();
  });

  test("API_URL + API_KEY both present -> hosted http", () => {
    const r = resolveTransport(APP, {
      HASNA_RECORDINGS_API_URL: "https://api.example.com",
      HASNA_RECORDINGS_API_KEY: "test-key",
    });
    expect(r.transport).toBe("http");
    expect(r.misconfigured).toBe(false);
    expect(r.baseUrl).toBe("https://api.example.com/v1");
  });

  test("API_URL alone -> fail closed (never silently local)", () => {
    const r = resolveTransport(APP, { HASNA_RECORDINGS_API_URL: "https://api.example.com" });
    expect(r.transport).toBe("sqlite");
    expect(r.misconfigured).toBe(true);
    expect(r.warning).toContain("HASNA_RECORDINGS_API_KEY");
    expect(() => resolveStorageClient(APP, { HASNA_RECORDINGS_API_URL: "https://api.example.com" })).toThrow();
  });

  test("API_KEY alone -> fail closed (never silently local)", () => {
    const r = resolveTransport(APP, { HASNA_RECORDINGS_API_KEY: "test-key" });
    expect(r.transport).toBe("sqlite");
    expect(r.misconfigured).toBe(true);
    expect(r.warning).toContain("HASNA_RECORDINGS_API_URL");
  });

  test("unprefixed RECORDINGS_API_KEY alone -> on-box sqlite, not misconfigured (OpenAI transcription key only)", () => {
    const r = resolveTransport(APP, { RECORDINGS_API_KEY: "test-key" });
    expect(r.transport).toBe("sqlite");
    expect(r.misconfigured).toBe(false);
    expect(() => resolveStorageClient(APP, { RECORDINGS_API_KEY: "test-key" })).not.toThrow();
  });

  test("unprefixed API_URL + API_KEY forms do NOT select the hosted store (not the hosted contract)", () => {
    const r = resolveTransport(APP, {
      RECORDINGS_API_URL: "https://api.example.com",
      RECORDINGS_API_KEY: "test-key",
    });
    expect(r.transport).toBe("sqlite");
    expect(r.misconfigured).toBe(false);
    expect(r.baseUrl).toBeNull();
  });

  test("HASNA_RECORDINGS_CLIENT_STORE=sqlite overrides auto http (patch-compatible)", () => {
    const r = resolveTransport(APP, {
      HASNA_RECORDINGS_CLIENT_STORE: "sqlite",
      HASNA_RECORDINGS_API_URL: "https://api.example.com",
      HASNA_RECORDINGS_API_KEY: "test-key",
    });
    expect(r.transport).toBe("sqlite");
    expect(r.misconfigured).toBe(false);
    expect(r.baseUrl).toBeNull();
  });

  test("HASNA_RECORDINGS_CLIENT_STORE=http with URL+key -> hosted http", () => {
    const r = resolveTransport(APP, {
      HASNA_RECORDINGS_CLIENT_STORE: "http",
      HASNA_RECORDINGS_API_URL: "https://api.example.com",
      HASNA_RECORDINGS_API_KEY: "test-key",
    });
    expect(r.transport).toBe("http");
    expect(r.misconfigured).toBe(false);
    expect(r.baseUrl).toBe("https://api.example.com/v1");
  });

  test("HASNA_RECORDINGS_CLIENT_STORE=http without a key -> fail closed", () => {
    const r = resolveTransport(APP, {
      HASNA_RECORDINGS_CLIENT_STORE: "http",
      HASNA_RECORDINGS_API_URL: "https://api.example.com",
    });
    expect(r.transport).toBe("sqlite");
    expect(r.misconfigured).toBe(true);
    expect(() => resolveStorageClient(APP, {
      HASNA_RECORDINGS_CLIENT_STORE: "http",
      HASNA_RECORDINGS_API_URL: "https://api.example.com",
    })).toThrow();
  });

  test("unknown HASNA_RECORDINGS_CLIENT_STORE value -> throws", () => {
    expect(() => resolveTransport(APP, { HASNA_RECORDINGS_CLIENT_STORE: "bogus" })).toThrow(/Unknown client store/);
  });
});

describe("server env-selection contract", () => {
  test("no DSN -> sqlite backend", () => {
    expect(resolveDataBackend({})).toBe("sqlite");
    expect(isPostgresBackendEnabled({})).toBe(false);
  });

  test("a DSN -> postgresql backend", () => {
    expect(resolveDataBackend({ HASNA_RECORDINGS_DATABASE_URL: "postgres://host/db" })).toBe("postgresql");
    expect(isPostgresBackendEnabled({ HASNA_RECORDINGS_DATABASE_URL: "postgres://host/db" })).toBe(true);
  });

  test("the unprefixed and bare DSN forms select the postgresql backend too", () => {
    expect(resolveDataBackend({ RECORDINGS_DATABASE_URL: "postgres://host/db" })).toBe("postgresql");
    expect(resolveDataBackend({ DATABASE_URL: "postgres://host/db" })).toBe("postgresql");
  });
});
