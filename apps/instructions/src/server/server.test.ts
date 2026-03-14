import { describe, test, expect, beforeEach } from "bun:test";
import { Hono } from "hono";
import { getDatabase, resetDatabase } from "../db/database";
import { createConfig } from "../db/configs";
import { createProfile } from "../db/profiles";

// Inline minimal test server to avoid global singleton issues
function makeTestApp() {
  const app = new Hono();
  const { cors } = require("hono/cors");
  const { getConfigStats, listConfigs, getConfig, updateConfig, deleteConfig } = require("../db/configs");
  const { listProfiles, getProfile, createProfile: cp, getProfileConfigs } = require("../db/profiles");
  const { listMachines, registerMachine } = require("../db/machines");

  app.use("*", cors());
  app.get("/health", (c) => c.json({ ok: true, version: "0.1.0" }));
  app.get("/api/stats", (c) => c.json(getConfigStats()));
  app.get("/api/configs", (c) => c.json(listConfigs()));
  app.get("/api/configs/:id", (c) => {
    try { return c.json(getConfig(c.req.param("id"))); }
    catch { return c.json({ error: "Not found" }, 404); }
  });
  app.put("/api/configs/:id", async (c) => {
    try { return c.json(updateConfig(c.req.param("id"), await c.req.json())); }
    catch (e) { return c.json({ error: String(e) }, 422); }
  });
  app.delete("/api/configs/:id", (c) => {
    try { deleteConfig(c.req.param("id")); return c.json({ ok: true }); }
    catch { return c.json({ error: "Not found" }, 404); }
  });
  app.get("/api/profiles", (c) => c.json(listProfiles()));
  app.get("/api/machines", (c) => c.json(listMachines()));
  return app;
}

beforeEach(() => {
  resetDatabase();
  process.env["CONFIGS_DB_PATH"] = ":memory:";
  getDatabase();
});

describe("REST server", () => {
  test("GET /health returns ok", async () => {
    const app = makeTestApp();
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  test("GET /api/stats returns counts", async () => {
    const db = getDatabase();
    createConfig({ name: "X", category: "rules", content: "" }, db);
    const app = makeTestApp();
    const res = await app.request("/api/stats");
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, number>;
    expect(body["total"]).toBe(1);
  });

  test("GET /api/configs returns list", async () => {
    const db = getDatabase();
    createConfig({ name: "C1", category: "rules", content: "" }, db);
    const app = makeTestApp();
    const res = await app.request("/api/configs");
    const body = await res.json() as unknown[];
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(1);
  });

  test("GET /api/configs/:id returns 404 for missing", async () => {
    const app = makeTestApp();
    const res = await app.request("/api/configs/nope");
    expect(res.status).toBe(404);
  });

  test("GET /api/configs/:id returns config", async () => {
    const db = getDatabase();
    const c = createConfig({ name: "C", category: "rules", content: "hi" }, db);
    const app = makeTestApp();
    const res = await app.request(`/api/configs/${c.id}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { id: string };
    expect(body.id).toBe(c.id);
  });

  test("DELETE /api/configs/:id deletes it", async () => {
    const db = getDatabase();
    const c = createConfig({ name: "C", category: "rules", content: "" }, db);
    const app = makeTestApp();
    const res = await app.request(`/api/configs/${c.id}`, { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(listConfigs(undefined, db).length).toBe(0);
  });

  test("GET /api/profiles returns list", async () => {
    const db = getDatabase();
    createProfile({ name: "P" }, db);
    const app = makeTestApp();
    const res = await app.request("/api/profiles");
    const body = await res.json() as unknown[];
    expect(body.length).toBe(1);
  });

  test("GET /api/machines returns list", async () => {
    const app = makeTestApp();
    const res = await app.request("/api/machines");
    expect(res.status).toBe(200);
  });
  test("GET /api/status returns stats with total", async () => {
    const db = getDatabase();
    createConfig({ name: "X", category: "rules", content: "" }, db);
    createConfig({ name: "Y", category: "agent", content: "", is_template: true }, db);
    const app = makeTestApp();
    // Need to add /api/status to test app
    const { getConfigStats } = require("../db/configs");
    app.get("/api/status", (c: any) => {
      const stats = getConfigStats();
      const configs = listConfigs({ kind: "file" });
      let templates = 0;
      for (const cfg of configs) if (cfg.is_template) templates++;
      return c.json({ total: stats["total"] || 0, templates });
    });
    const res = await app.request("/api/status");
    expect(res.status).toBe(200);
    const body = await res.json() as { total: number; templates: number };
    expect(body.total).toBe(2);
    expect(body.templates).toBe(1);
  });

  test("POST /api/configs creates a config", async () => {
    const app = makeTestApp();
    const { createConfig: cc } = require("../db/configs");
    app.post("/api/configs", async (c: any) => {
      try {
        const body = await c.req.json();
        const config = cc({ name: body.name, content: body.content ?? "", category: body.category });
        return c.json(config, 201);
      } catch (e: any) { return c.json({ error: e.message }, 422); }
    });
    const res = await app.request("/api/configs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "New Config", content: "hello", category: "rules" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { slug: string };
    expect(body.slug).toBe("new-config");
  });

  test("PUT /api/configs/:id updates content", async () => {
    const db = getDatabase();
    const c = createConfig({ name: "Updatable", category: "tools", content: "v1" }, db);
    const app = makeTestApp();
    const { updateConfig } = require("../db/configs");
    app.put("/api/configs/:id", async (ctx: any) => {
      try {
        const body = await ctx.req.json();
        return ctx.json(updateConfig(ctx.req.param("id"), body));
      } catch (e: any) { return ctx.json({ error: e.message }, 422); }
    });
    const res = await app.request(`/api/configs/${c.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "v2" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { content: string; version: number };
    expect(body.content).toBe("v2");
    expect(body.version).toBe(2);
  });
});

// Import listConfigs for use in tests
import { listConfigs } from "../db/configs";
