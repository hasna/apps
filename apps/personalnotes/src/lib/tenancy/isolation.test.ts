import { describe, expect, test } from "bun:test";
import { AuthService } from "../auth/service.js";
import { resolveConfig } from "../config.js";
import { isAuthError } from "../errors.js";
import { SqliteAuthStorage } from "../storage/sqlite.js";

async function twoTenants() {
  const storage = new SqliteAuthStorage({ path: ":memory:" });
  await storage.migrate();
  const service = new AuthService(storage, resolveConfig({ sqlitePath: ":memory:", superAdminEmail: "andrei@hasna.com" }));

  const a = await service.register({ email: "owner-a@a.com", password: "supersecret1", tenantName: "TenantA" });
  const b = await service.register({ email: "owner-b@b.com", password: "supersecret1", tenantName: "TenantB" });
  return { storage, service, a, b };
}

describe("per-tenant isolation", () => {
  test("storage.getUserById will not return a user from a different tenant", async () => {
    const { storage, a, b } = await twoTenants();
    // A's owner id, queried under B's tenant scope => null.
    expect(await storage.getUserById(b.tenant.id, a.user.id)).toBeNull();
    // Correct scope resolves.
    expect((await storage.getUserById(a.tenant.id, a.user.id))?.email).toBe("owner-a@a.com");
  });

  test("listTenantUsers only returns the caller's tenant", async () => {
    const { service, a, b } = await twoTenants();
    const ctxA = await service.authenticate(a.token);
    const usersA = await service.listTenantUsers(ctxA);
    expect(usersA.map((u) => u.email).sort()).toEqual(["owner-a@a.com"]);
    expect(usersA.some((u) => u.tenantId === b.tenant.id)).toBe(false);
  });

  test("a non-super-admin cannot read another tenant's users by passing tenantId", async () => {
    const { service, a, b } = await twoTenants();
    const ctxA = await service.authenticate(a.token);
    const err = await service.listTenantUsers(ctxA, b.tenant.id).catch((e) => e);
    expect(isAuthError(err) && err.code).toBe("forbidden");
  });

  test("a tenant admin cannot mutate a user in another tenant", async () => {
    const { service, a, b } = await twoTenants();
    const ctxA = await service.authenticate(a.token);
    // b.user.id does not exist within tenant A -> not_found (not a silent cross-tenant write).
    const err = await service.setUserRole(ctxA, b.user.id, "admin").catch((e) => e);
    expect(isAuthError(err) && err.code).toBe("not_found");
    // B's user is unchanged.
    const ctxB = await service.authenticate(b.token);
    const usersB = await service.listTenantUsers(ctxB);
    expect(usersB[0]?.role).toBe("owner");
  });

  test("suspending a tenant revokes access for its users via authenticate", async () => {
    const { service, a, b } = await twoTenants();
    // Make A a super admin path is separate; here we suspend B's tenant using a super admin.
    const storage = new SqliteAuthStorage({ path: ":memory:" });
    await storage.migrate();
    const svc = new AuthService(storage, resolveConfig({ sqlitePath: ":memory:", superAdminEmail: "andrei@hasna.com" }));
    const sa = await svc.register({ email: "andrei@hasna.com", password: "supersecret1" });
    const tenant = await svc.register({ email: "u@t.com", password: "supersecret1" });
    const saCtx = await svc.authenticate(sa.token);
    await svc.setTenantStatus(saCtx, tenant.tenant.id, "suspended");
    const err = await svc.authenticate(tenant.token).catch((e) => e);
    expect(isAuthError(err) && err.code).toBe("tenant_suspended");
    // Reference the two-tenant fixture so it is exercised.
    expect(a.tenant.id).not.toBe(b.tenant.id);
  });
});
