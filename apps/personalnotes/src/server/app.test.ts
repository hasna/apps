import { describe, expect, test } from "bun:test";
import { resolveConfig } from "../lib/config.js";
import { SqliteAuthStorage } from "../lib/storage/sqlite.js";
import { createApp } from "./app.js";

async function harness() {
  const storage = new SqliteAuthStorage({ path: ":memory:" });
  await storage.migrate();
  const app = createApp({ storage, config: resolveConfig({ sqlitePath: ":memory:", superAdminEmail: "andrei@hasna.com" }) });
  const call = (method: string, path: string, opts: { body?: unknown; token?: string } = {}) => {
    const headers: Record<string, string> = {};
    if (opts.body !== undefined) headers["content-type"] = "application/json";
    if (opts.token) headers.authorization = `Bearer ${opts.token}`;
    return app.fetch(
      new Request(`http://local${path}`, {
        method,
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      }),
    );
  };
  const body = async (res: Response): Promise<any> => res.json();
  return { app, call, body };
}

describe("HTTP surface", () => {
  test("health/version/ready probes", async () => {
    const { call, body } = await harness();
    expect((await body(await call("GET", "/health"))).status).toBe("ok");
    expect((await body(await call("GET", "/version"))).service).toBe("personalnotes");
    const ready = await call("GET", "/ready");
    expect(ready.status).toBe(200);
    expect((await body(ready)).status).toBe("ready");
  });

  test("register -> me -> logout flow over HTTP", async () => {
    const { call, body } = await harness();
    const reg = await call("POST", "/v1/auth/register", { body: { email: "http@x.com", password: "supersecret1" } });
    expect(reg.status).toBe(201);
    const regBody = await body(reg);
    const token = regBody.token as string;

    const me = await call("GET", "/v1/auth/me", { token });
    expect(me.status).toBe(200);
    expect((await body(me)).email).toBe("http@x.com");

    const out = await call("POST", "/v1/auth/logout", { token });
    expect(out.status).toBe(200);

    const meAfter = await call("GET", "/v1/auth/me", { token });
    expect(meAfter.status).toBe(401);
  });

  test("login with wrong password returns 401", async () => {
    const { call, body } = await harness();
    await call("POST", "/v1/auth/register", { body: { email: "l@x.com", password: "supersecret1" } });
    const bad = await call("POST", "/v1/auth/login", { body: { email: "l@x.com", password: "nope-nope-1" } });
    expect(bad.status).toBe(401);
    expect((await body(bad)).error).toBe("invalid_credentials");
  });

  test("missing token on protected route returns 401", async () => {
    const { call } = await harness();
    const me = await call("GET", "/v1/auth/me");
    expect(me.status).toBe(401);
  });

  test("non-admin hitting /v1/admin/tenants returns 403; super admin gets 200", async () => {
    const { call, body } = await harness();
    const normal = await body(await call("POST", "/v1/auth/register", { body: { email: "n@x.com", password: "supersecret1" } }));
    const forbidden = await call("GET", "/v1/admin/tenants", { token: normal.token });
    expect(forbidden.status).toBe(403);

    const sa = await body(await call("POST", "/v1/auth/register", { body: { email: "andrei@hasna.com", password: "supersecret1" } }));
    const ok = await call("GET", "/v1/admin/tenants", { token: sa.token });
    expect(ok.status).toBe(200);
    expect(((await body(ok)).tenants as unknown[]).length).toBe(2);
  });

  test("malformed JSON body returns 400", async () => {
    const { app } = await harness();
    const res = await app.fetch(
      new Request("http://local/v1/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{not json",
      }),
    );
    expect(res.status).toBe(400);
  });

  test("unknown route returns 404", async () => {
    const { call } = await harness();
    expect((await call("GET", "/v1/nope")).status).toBe(404);
  });
});
