import { describe, expect, it } from "bun:test";
import { serverBackend, databaseUrlPresent, resolveDbPath, defaultSqlitePath } from "../src/config.js";

describe("config: server backend selection (env contract)", () => {
  it("defaults to sqlite when no DATABASE_URL is set", () => {
    expect(serverBackend({})).toBe("sqlite");
  });

  it("selects postgresql when HASNA_CONTROLS_DATABASE_URL is set", () => {
    expect(serverBackend({ HASNA_CONTROLS_DATABASE_URL: "postgres://x/y" })).toBe("postgresql");
  });

  it("selects postgresql via the _FILE variant", () => {
    expect(serverBackend({ HASNA_CONTROLS_DATABASE_URL_FILE: "/run/secrets/database_url" })).toBe("postgresql");
  });

  it("honors the short alias env prefix", () => {
    expect(serverBackend({ CONTROLS_DATABASE_URL: "postgres://x/y" })).toBe("postgresql");
  });

  it("detects DSN presence without reading the value", () => {
    expect(databaseUrlPresent({})).toBe(false);
    expect(databaseUrlPresent({ HASNA_CONTROLS_DATABASE_URL: "postgres://secret:pw@host/db" })).toBe(true);
  });

  it("resolveDbPath falls back to the canonical default", () => {
    expect(resolveDbPath({})).toBe(defaultSqlitePath());
    expect(resolveDbPath({ HASNA_CONTROLS_DB_PATH: "/tmp/controls-test.db" })).toBe("/tmp/controls-test.db");
  });
});
