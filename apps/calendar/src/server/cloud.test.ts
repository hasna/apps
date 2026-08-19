import { afterEach, describe, test, expect } from "bun:test";
import {
  hasHostedDatabase,
  resolveBackend,
  resolveCloudDatabaseUrl,
  resolveSigningSecret,
  getCloudVerifier,
  closeCloud,
  schemaStatements,
} from "./cloud.js";

describe("hosted-database selection", () => {
  test("the HASNA_CALENDAR_DATABASE_URL spelling selects the postgres backend", () => {
    expect(hasHostedDatabase({ HASNA_CALENDAR_DATABASE_URL: "postgres://u:p@h/db" })).toBe(true);
    expect(resolveBackend({ HASNA_CALENDAR_DATABASE_URL: "postgres://u:p@h/db" })).toBe("postgres");
  });

  test("the CALENDAR_DATABASE_URL spelling selects the postgres backend too", () => {
    expect(hasHostedDatabase({ CALENDAR_DATABASE_URL: "postgres://u:p@h/db" })).toBe(true);
    expect(resolveBackend({ CALENDAR_DATABASE_URL: "postgres://u:p@h/db" })).toBe("postgres");
  });

  test("no app-scoped URL means sqlite, even with a generic DATABASE_URL set", () => {
    expect(hasHostedDatabase({ DATABASE_URL: "postgres://u:p@h/db" })).toBe(false);
    expect(resolveBackend({ DATABASE_URL: "postgres://u:p@h/db" })).toBe("sqlite");
  });

  test("an empty-string URL is not a backend signal", () => {
    expect(hasHostedDatabase({ HASNA_CALENDAR_DATABASE_URL: "" })).toBe(false);
    expect(hasHostedDatabase({ HASNA_CALENDAR_DATABASE_URL: "", CALENDAR_DATABASE_URL: "" })).toBe(false);
    expect(resolveBackend({ HASNA_CALENDAR_DATABASE_URL: "" })).toBe("sqlite");
  });

  test("a whitespace-only URL is treated as set (no trimming — documented quirk)", () => {
    // resolveHostedDatabaseUrl does not trim, so a whitespace-only value counts
    // as configured. Assert the actual contract so a future trim fix is caught.
    expect(hasHostedDatabase({ CALENDAR_DATABASE_URL: "   " })).toBe(true);
    expect(resolveBackend({ CALENDAR_DATABASE_URL: "   " })).toBe("postgres");
  });

  test("an empty env is sqlite", () => {
    expect(hasHostedDatabase({})).toBe(false);
    expect(resolveBackend({})).toBe("sqlite");
  });
});

describe("resolveCloudDatabaseUrl", () => {
  test("HASNA_CALENDAR_DATABASE_URL wins over CALENDAR_DATABASE_URL", () => {
    expect(resolveCloudDatabaseUrl({
      HASNA_CALENDAR_DATABASE_URL: "postgres://a",
      CALENDAR_DATABASE_URL: "postgres://b",
    })).toBe("postgres://a");
  });

  test("generic DATABASE_URL is ignored unless explicitly opted in", () => {
    expect(resolveCloudDatabaseUrl({ DATABASE_URL: "postgres://g" })).toBeUndefined();
    expect(resolveCloudDatabaseUrl({ DATABASE_URL: "postgres://g" }, { includeGenericDatabaseUrl: true })).toBe("postgres://g");
  });

  test("app-scoped URL wins over the opted-in generic one", () => {
    expect(resolveCloudDatabaseUrl(
      { HASNA_CALENDAR_DATABASE_URL: "postgres://a", DATABASE_URL: "postgres://g" },
      { includeGenericDatabaseUrl: true },
    )).toBe("postgres://a");
  });
});

describe("resolveSigningSecret", () => {
  test("priority order: HASNA_CALENDAR_ > HASNA_ > generic", () => {
    expect(resolveSigningSecret({
      HASNA_CALENDAR_API_SIGNING_KEY: "scoped",
      HASNA_API_SIGNING_KEY: "generic-hasna",
      API_KEY_SIGNING_SECRET: "legacy",
    })).toBe("scoped");
    expect(resolveSigningSecret({ HASNA_API_SIGNING_KEY: "generic-hasna", API_KEY_SIGNING_SECRET: "legacy" })).toBe("generic-hasna");
    expect(resolveSigningSecret({ API_KEY_SIGNING_SECRET: "legacy" })).toBe("legacy");
  });

  test("no secret configured resolves to undefined (the verifier must fail closed)", () => {
    expect(resolveSigningSecret({})).toBeUndefined();
  });
});

describe("getCloudVerifier fail-closed behavior", () => {
  afterEach(() => closeCloud());

  test("throws a clear error when no signing secret is configured", () => {
    expect(() => getCloudVerifier()).toThrow(/signing secret/);
  });
});

describe("schemaStatements", () => {
  test("splits the committed migration into non-empty statements without comment lines", () => {
    const statements = schemaStatements();
    expect(statements.length).toBeGreaterThan(0);
    for (const stmt of statements) {
      expect(stmt.trim().length).toBeGreaterThan(0);
      expect(stmt).not.toMatch(/^\s*--/);
    }
  });

  test("the schema contains the core relational tables", () => {
    const sql = schemaStatements().join("\n");
    for (const table of ["orgs", "agents", "org_memberships", "calendars", "events", "event_attendees", "availability"]) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
  });
});
