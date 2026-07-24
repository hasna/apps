import { describe, expect, test } from "bun:test";
import {
  createNoteStorage,
  defaultSqlitePath,
  ENV_PREFIX,
  resolveStorageConfig,
} from "./env.js";

describe("resolveStorageConfig", () => {
  test("defaults to local SQLite with no env", () => {
    const config = resolveStorageConfig({});
    expect(config.mode).toBe("local");
    expect(config.sqlitePath).toBe(defaultSqlitePath());
    expect(config.databaseUrl).toBeUndefined();
  });

  test("default sqlite path ends in .db (storage-standard check)", () => {
    expect(defaultSqlitePath().endsWith(".db")).toBe(true);
  });

  test("DATABASE_URL selects self_hosted (server-side)", () => {
    const config = resolveStorageConfig({
      [`${ENV_PREFIX}DATABASE_URL`]: "postgres://localhost/pn",
    });
    expect(config.mode).toBe("self_hosted");
    expect(config.databaseUrl).toBe("postgres://localhost/pn");
  });

  test("API_URL selects self_hosted (client → HTTP) and carries the key", () => {
    const config = resolveStorageConfig({
      [`${ENV_PREFIX}API_URL`]: "https://notes.example/v1",
      [`${ENV_PREFIX}API_KEY`]: "k",
    });
    expect(config.mode).toBe("self_hosted");
    expect(config.apiUrl).toBe("https://notes.example/v1");
    expect(config.apiKey).toBe("k");
  });

  test("explicit STORAGE_MODE wins and cloud is honored", () => {
    const config = resolveStorageConfig({
      [`${ENV_PREFIX}STORAGE_MODE`]: "cloud",
      [`${ENV_PREFIX}API_URL`]: "https://notes.example/v1",
    });
    expect(config.mode).toBe("cloud");
  });

  test("DB_PATH overrides the sqlite path", () => {
    const config = resolveStorageConfig({ [`${ENV_PREFIX}DB_PATH`]: "/tmp/custom.db" });
    expect(config.sqlitePath).toBe("/tmp/custom.db");
  });

  test("blank env values are ignored", () => {
    const config = resolveStorageConfig({ [`${ENV_PREFIX}DATABASE_URL`]: "   " });
    expect(config.mode).toBe("local");
  });
});

describe("createNoteStorage factory", () => {
  test("local mode builds a SQLite backend", async () => {
    const storage = await createNoteStorage({ mode: "local", sqlitePath: ":memory:" });
    try {
      expect(storage.backend).toBe("sqlite");
    } finally {
      await storage.close();
    }
  });

  test("self_hosted without a DATABASE_URL fails closed (no split-brain to SQLite)", async () => {
    await expect(
      createNoteStorage({ mode: "self_hosted", sqlitePath: ":memory:" }),
    ).rejects.toThrow(/DATABASE_URL/);
  });
});
