import { describe, expect, test } from "bun:test";
import { resolveConfig } from "../config.js";
import { isAuthError } from "../errors.js";
import { SqliteAuthStorage } from "../storage/sqlite.js";
import { AuthService } from "./service.js";

async function svc(superAdminEmail = "andrei@hasna.com") {
  const storage = new SqliteAuthStorage({ path: ":memory:" });
  await storage.migrate();
  return new AuthService(storage, resolveConfig({ sqlitePath: ":memory:", superAdminEmail }));
}

describe("super admin (andrei@hasna.com)", () => {
  test("registering with the super-admin email grants isSuperAdmin", async () => {
    const service = await svc();
    const reg = await service.register({ email: "andrei@hasna.com", password: "supersecret1" });
    expect(reg.user.isSuperAdmin).toBe(true);
  });

  test("default super admin email is andrei@hasna.com", async () => {
    const service = await svc(undefined as unknown as string);
    expect(service.superAdminEmail).toBe("andrei@hasna.com");
  });

  test("a normal user does NOT get super admin", async () => {
    const service = await svc();
    const reg = await service.register({ email: "someone@else.com", password: "supersecret1" });
    expect(reg.user.isSuperAdmin).toBe(false);
  });

  test("super admin can list all tenants and all users across tenants", async () => {
    const service = await svc();
    await service.register({ email: "andrei@hasna.com", password: "supersecret1" });
    await service.register({ email: "t1@x.com", password: "supersecret1", tenantName: "One" });
    await service.register({ email: "t2@y.com", password: "supersecret1", tenantName: "Two" });

    const sa = await service.login("andrei@hasna.com", "supersecret1");
    const saCtx = await service.authenticate(sa.token);

    const tenants = await service.listAllTenants(saCtx);
    expect(tenants.length).toBe(3);
    const users = await service.listAllUsers(saCtx);
    expect(users.map((u) => u.email).sort()).toEqual(["andrei@hasna.com", "t1@x.com", "t2@y.com"]);
  });

  test("a normal user is forbidden from the super-admin plane", async () => {
    const service = await svc();
    const reg = await service.register({ email: "normal@x.com", password: "supersecret1" });
    const ctx = await service.authenticate(reg.token);
    const err1 = await service.listAllTenants(ctx).catch((e) => e);
    expect(isAuthError(err1) && err1.code).toBe("forbidden");
    const err2 = await service.listAllUsers(ctx).catch((e) => e);
    expect(isAuthError(err2) && err2.code).toBe("forbidden");
  });

  test("super admin CAN read another tenant's users cross-boundary", async () => {
    const service = await svc();
    await service.register({ email: "andrei@hasna.com", password: "supersecret1" });
    const other = await service.register({ email: "member@other.com", password: "supersecret1" });
    const sa = await service.login("andrei@hasna.com", "supersecret1");
    const saCtx = await service.authenticate(sa.token);
    const users = await service.listTenantUsers(saCtx, other.tenant.id);
    expect(users.map((u) => u.email)).toEqual(["member@other.com"]);
  });
});
