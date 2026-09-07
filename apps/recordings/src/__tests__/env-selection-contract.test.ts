import { describe, expect, test } from "bun:test";
import {
  getRecordingsTransportStatus,
  resolveRecordingsCloudClient,
  resolveRecordingsTransport,
} from "../http/client.js";
import { resolveDataBackend, isPostgresBackendEnabled } from "../server/cloud-config.js";

const APP = "recordings";

// The two-backend selection contract. There is exactly one selection mechanism
// per role:
//   - client: the @hasna/contracts resolver decides — a resolved credential
//     (Keychain, ~/.hasna/recordings/config/credentials, or the canonical
//     HASNA_RECORDINGS_API_KEY) selects the hosted HTTP store, with the
//     authority following HASNA_RECORDINGS_API_URL, the Keychain api-url item,
//     the credentials file, or the fleet gateway default. An environment from
//     which NOTHING resolves FAILS CLOSED with a REMOTE_API_* error — the
//     on-box SQLite file is never a silent default and is read only via the
//     explicit HASNA_RECORDINGS_LOCAL=1 opt-in. The unprefixed
//     RECORDINGS_API_URL / RECORDINGS_API_KEY spellings are carved out: the
//     key is this package's OpenAI transcription-key override and configures no
//     store.
//   - server: the presence of a PostgreSQL DSN selects the postgresql backend;
//     anything else serves from SQLite.
// No variable carries a placement word, and no word selects a backend: the
// *_MODE / *_STORAGE_MODE / *_CLIENT_STORE switches are gone.

describe("client env-selection contract", () => {
  test("no hosted env and no opt-in -> fails closed, never silently local", () => {
    expect(() => resolveRecordingsTransport({})).toThrow(/REMOTE_API_CONFIG_MISSING/);
    expect(() => resolveRecordingsCloudClient({})).toThrow(/REMOTE_API_CONFIG_MISSING/);
    const status = getRecordingsTransportStatus({});
    expect(status.ok).toBe(false);
    expect(status.local_fallback).toBe(false);
    expect(status.issues.join(" ")).toContain("HASNA_RECORDINGS_API_KEY");
    expect(status.issues.join(" ")).toContain("HASNA_RECORDINGS_LOCAL=1");
  });

  test("explicit HASNA_RECORDINGS_LOCAL=1 opts in to the on-box file with no hosted env", () => {
    const r = resolveRecordingsTransport({ HASNA_RECORDINGS_LOCAL: "1" });
    expect(r.transport).toBe("sqlite");
    expect(r.selected).toBe(false);
    expect(r.source).toBe("local-opt-in");
    expect(r.authority).toBeNull();
  });

  test("API_URL + API_KEY both present -> hosted http", () => {
    const r = resolveRecordingsTransport({
      HASNA_RECORDINGS_API_URL: "https://api.example.com",
      HASNA_RECORDINGS_API_KEY: "test-key",
    });
    expect(r.transport).toBe("http");
    expect(r.selected).toBe(true);
    expect(r.authority!.baseUrl).toBe("https://api.example.com/v1");
  });

  test("API_KEY alone -> the fleet gateway, never a half-configured refusal", () => {
    const r = resolveRecordingsTransport({ HASNA_RECORDINGS_API_KEY: "test-key" });
    expect(r.transport).toBe("http");
    expect(r.authority!.baseUrl).toBe("https://api.hasna.com/recordings/v1");
    expect(r.authority!.apiUrlSource).toBe("default");
  });

  test("API_URL alone with no credential anywhere -> fail closed (never silently local)", () => {
    expect(() => resolveRecordingsTransport({ HASNA_RECORDINGS_API_URL: "https://api.example.com" })).toThrow(
      /REMOTE_API_CONFIG_MISSING|no API key could be resolved/,
    );
    expect(() => resolveRecordingsCloudClient({ HASNA_RECORDINGS_API_URL: "https://api.example.com" })).toThrow();
  });

  test("unprefixed RECORDINGS_API_KEY alone -> fails closed (it is the OpenAI transcription key, not a transport signal)", () => {
    // The unprefixed key is the legacy OpenAI transcription-key override
    // (src/lib/config.ts, credential-seam waiver), never a client-transport
    // signal: it configures no store and never reaches the resolver, so the
    // client fails closed like any other empty environment.
    expect(() => resolveRecordingsTransport({ RECORDINGS_API_KEY: "test-key" })).toThrow(
      /REMOTE_API_CONFIG_MISSING/,
    );
    // Beside the local opt-in it stays local (the workstation shape).
    expect(resolveRecordingsTransport({ RECORDINGS_API_KEY: "test-key", HASNA_RECORDINGS_LOCAL: "1" }).transport)
      .toBe("sqlite");
  });

  test("unprefixed API_URL + API_KEY forms do NOT select the hosted store -> fails closed (not the hosted contract)", () => {
    // Neither unprefixed form is part of the hosted contract: both are carved
    // out of the resolver environment, so they configure nothing and the
    // client fails closed naming the canonical variable it actually needs.
    expect(() => resolveRecordingsTransport({
      RECORDINGS_API_URL: "https://api.example.com",
      RECORDINGS_API_KEY: "test-key",
    })).toThrow(/REMOTE_API_CONFIG_MISSING/);
    expect(() => resolveRecordingsCloudClient({
      RECORDINGS_API_URL: "https://api.example.com",
      RECORDINGS_API_KEY: "test-key",
    })).toThrow(/REMOTE_API_CONFIG_MISSING/);
  });

  test("HASNA_RECORDINGS_LOCAL=1 does not outrank a configured authority", () => {
    const r = resolveRecordingsTransport({
      HASNA_RECORDINGS_LOCAL: "1",
      HASNA_RECORDINGS_API_URL: "https://api.example.com",
      HASNA_RECORDINGS_API_KEY: "test-key",
    });
    expect(r.transport).toBe("http");
    expect(r.authority!.baseUrl).toBe("https://api.example.com/v1");
  });

  test("the old HASNA_RECORDINGS_CLIENT_STORE switch selects nothing any more", () => {
    // The store-switch axis is retired: a leftover variable is inert (the
    // resolver does not read it), so the store is decided by what resolves.
    expect(() => resolveRecordingsTransport({ HASNA_RECORDINGS_CLIENT_STORE: "http" })).toThrow(
      /REMOTE_API_CONFIG_MISSING/,
    );
    expect(() => resolveRecordingsTransport({ HASNA_RECORDINGS_CLIENT_STORE: "bogus" })).toThrow(
      /REMOTE_API_CONFIG_MISSING/,
    );
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