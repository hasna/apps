import { describe, expect, test } from "bun:test";
import {
  ROUTE_ADMISSION_GATES,
  displayControlPlaneUrl,
  loopControlPlaneConfig,
  resolveRuntimeConfig,
  runtimeStorage,
  runtimeStorageBackend,
} from "./runtime-config.js";

describe("runtime config contract", () => {
  test("defaults to sqlite file authority", () => {
    const config = resolveRuntimeConfig({});
    expect(config.storage).toBe("sqlite");
    expect(config.connection).toBe("file");
    expect(config.apiUrl).toBeUndefined();
    expect(config.apiUrlPresent).toBe(false);
    expect(config.apiKeyPresent).toBe(false);
    expect(config.databaseUrlPresent).toBe(false);

    const presence = loopControlPlaneConfig({});
    expect(presence.apiUrlPresent).toBe(false);
    expect(presence.apiKeyPresent).toBe(false);
    expect(presence.databaseUrlPresent).toBe(false);
  });

  test("treats blank env as unset", () => {
    const config = resolveRuntimeConfig({
      HASNA_LOOPS_API_URL: "",
      HASNA_LOOPS_DATABASE_URL: "",
    });
    expect(config.storage).toBe("sqlite");
    expect(config.connection).toBe("file");
  });

  test("resolves an api connection only when both URL and key are present", () => {
    const config = resolveRuntimeConfig({
      HASNA_LOOPS_API_URL: "https://loops.example.test",
      HASNA_LOOPS_API_KEY: "key",
    });
    expect(config.connection).toBe("api");
    expect(config.apiUrl).toBe("https://loops.example.test");
    expect(config.apiUrlPresent).toBe(true);
    expect(config.apiKeyPresent).toBe(true);
    expect(config.storage).toBe("sqlite");
    expect(config.databaseUrlPresent).toBe(false);

    const presence = loopControlPlaneConfig({
      HASNA_LOOPS_API_URL: "https://loops.example.test",
      HASNA_LOOPS_API_KEY: "key",
    });
    expect(presence.apiUrlPresent).toBe(true);
    expect(presence.apiKeyPresent).toBe(true);
  });

  test("fails closed for every partial api configuration, naming the missing variable", () => {
    for (const env of [
      { HASNA_LOOPS_API_URL: "https://loops.example.test" },
      { HASNA_LOOPS_API_KEY: "key" },
      { HASNA_LOOPS_API_URL: "https://loops.example.test", HASNA_LOOPS_DATABASE_URL: "postgres://loops.example.test/openloops" },
      { HASNA_LOOPS_API_KEY: "key", HASNA_LOOPS_DATABASE_URL: "postgres://loops.example.test/openloops" },
    ]) {
      expect(() => resolveRuntimeConfig(env)).toThrow("requires both");
    }
    expect(() => resolveRuntimeConfig({ HASNA_LOOPS_API_URL: "https://loops.example.test" })).toThrow(
      "HASNA_LOOPS_API_KEY",
    );
    expect(() => resolveRuntimeConfig({ HASNA_LOOPS_API_KEY: "key" })).toThrow("HASNA_LOOPS_API_URL");
  });

  test("reports database url presence as server-side postgres storage without switching the connection", () => {
    const env = { HASNA_LOOPS_DATABASE_URL: "postgres://loops.example.test/openloops" };
    const config = resolveRuntimeConfig(env);
    expect(config.storage).toBe("postgresql");
    expect(config.databaseUrlPresent).toBe(true);
    expect(config.connection).toBe("file");
    expect(config.apiUrlPresent).toBe(false);

    const presence = loopControlPlaneConfig(env);
    expect(presence.databaseUrlPresent).toBe(true);
    expect(presence.apiUrlPresent).toBe(false);

    expect(runtimeStorage(env)).toBe("postgresql");
    expect(runtimeStorageBackend(env)).toBe("postgres");
    expect(runtimeStorage({})).toBe("sqlite");
    expect(runtimeStorageBackend({})).toBe("sqlite");
  });

  test("scrubs credential-bearing control-plane urls for display", () => {
    expect(
      displayControlPlaneUrl("https://user:fake-password@loops.example.test/api?token=fake-token&ok=true#frag"),
    ).toBe("https://loops.example.test/api");
    expect(displayControlPlaneUrl("https://loops.example.test")).toBe("https://loops.example.test");
    expect(displayControlPlaneUrl("https://loops.example.test/")).toBe("https://loops.example.test");
    expect(displayControlPlaneUrl("not a url")).toBe("[invalid-url]");
    expect(displayControlPlaneUrl(undefined)).toBeUndefined();
    expect(displayControlPlaneUrl("")).toBeUndefined();
  });

  test("keeps the route admission gate list stable", () => {
    expect([...ROUTE_ADMISSION_GATES]).toEqual([
      "max_dispatch",
      "max_active",
      "max_active_per_project",
      "max_active_per_project_group",
      "max_active_scope",
      "max_per_profile",
    ]);
  });
});
