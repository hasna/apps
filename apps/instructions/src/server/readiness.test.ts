import { afterEach, describe, expect, test } from "bun:test";

const saved = {
  app: process.env.HASNA_INSTRUCTIONS_DATABASE_URL,
  alias: process.env.INSTRUCTIONS_DATABASE_URL,
  generic: process.env.DATABASE_URL,
};

afterEach(() => {
  for (const [key, value] of Object.entries({
    HASNA_INSTRUCTIONS_DATABASE_URL: saved.app,
    INSTRUCTIONS_DATABASE_URL: saved.alias,
    DATABASE_URL: saved.generic,
  })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("instructions-serve fail-closed readiness", () => {
  test("liveness stays public but readiness refuses an unconfigured API backend", async () => {
    delete process.env.HASNA_INSTRUCTIONS_DATABASE_URL;
    delete process.env.INSTRUCTIONS_DATABASE_URL;
    delete process.env.DATABASE_URL;
    const { app, serviceBackend } = await import("./index");

    expect(serviceBackend()).toBe("unconfigured");
    const health = await app.request("/health");
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ status: "ok", backend: "unconfigured", name: "instructions" });

    const ready = await app.request("/ready");
    expect(ready.status).toBe(503);
    expect(await ready.json()).toEqual({
      status: "unavailable",
      version: expect.any(String),
      backend: "unconfigured",
      code: "SERVER_BACKEND_UNCONFIGURED",
    });
  });

  test("the authenticated API cannot become a local SQLite fallback", async () => {
    delete process.env.HASNA_INSTRUCTIONS_DATABASE_URL;
    delete process.env.INSTRUCTIONS_DATABASE_URL;
    delete process.env.DATABASE_URL;
    const { app } = await import("./index");
    const response = await app.request("/v1/configs", { headers: { "x-api-key": "not-a-real-key" } });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Instructions API is unavailable", code: "API_AUTH_UNCONFIGURED" });
  });
});
