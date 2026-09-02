import { describe, expect, test } from "bun:test";
import {
  resolveServerDataBackend,
  serverDataBackendEnvKeys,
  envToken,
  SERVER_DATA_BACKENDS,
} from "../src";

describe("server data backend", () => {
  test("enum is postgresql only", () => {
    expect(SERVER_DATA_BACKENDS).toEqual(["postgresql"]);
  });

  test("derives canonical and alias database URL keys", () => {
    expect(envToken("todos")).toBe("TODOS");
    expect(envToken("mailery")).toBe("MAILERY");
    expect(serverDataBackendEnvKeys("todos")).toEqual({
      databaseUrlKeys: ["HASNA_TODOS_DATABASE_URL", "TODOS_DATABASE_URL"],
    });
  });

  test("fails closed with no database URL", () => {
    expect(() => resolveServerDataBackend("todos", {})).toThrow(/DATABASE_URL.*required/);
  });

  test("canonical or alias database URL selects postgresql without exposing it", () => {
    const canonical = resolveServerDataBackend("todos", {
      HASNA_TODOS_DATABASE_URL: "postgres://fixture.invalid/todos",
    });
    expect(canonical).toEqual({
      backend: "postgresql",
      source: "HASNA_TODOS_DATABASE_URL",
      databaseUrlPresent: true,
      databaseUrlSource: "HASNA_TODOS_DATABASE_URL",
    });
    expect(JSON.stringify(canonical)).not.toContain("fixture.invalid");

    expect(
      resolveServerDataBackend("todos", {
        TODOS_DATABASE_URL: "postgres://fixture.invalid/todos",
      }),
    ).toMatchObject({
      backend: "postgresql",
      source: "TODOS_DATABASE_URL",
      databaseUrlSource: "TODOS_DATABASE_URL",
    });
  });

  test("every legacy mode variable is inert; DATABASE_URL is the only selector", () => {
    for (const key of [
      "HASNA_TODOS_STORAGE_MODE",
      "HASNA_TODOS_MODE",
      "TODOS_STORAGE_MODE",
      "TODOS_MODE",
    ]) {
      for (const value of ["cloud", "", "   "]) {
        expect(() => resolveServerDataBackend("todos", { [key]: value }), `${key} must be inert`).toThrow(/DATABASE_URL/);
        expect(
          resolveServerDataBackend("todos", {
            [key]: value,
            HASNA_TODOS_DATABASE_URL: "postgres://user@host/db",
          }).backend,
        ).toBe("postgresql");
      }
    }
  });
});
