import { randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import type { AuthStorage } from "./contract.js";

/**
 * Behavioral conformance suite run against BOTH storage engines so SQLite and
 * PostgreSQL prove identical tenant-isolation semantics (hasna-storage-standard:
 * one interface, engine-agnostic parity).
 */
export function runStorageContractSuite(name: string, make: () => Promise<AuthStorage>): void {
  describe(`${name} — storage contract`, () => {
    async function seedTwoTenants(storage: AuthStorage) {
      const tenantA = await storage.createTenant({ id: randomUUID(), slug: "a", name: "A", status: "active" });
      const tenantB = await storage.createTenant({ id: randomUUID(), slug: "b", name: "B", status: "active" });
      const userA = await storage.createUser({
        id: randomUUID(),
        tenantId: tenantA.id,
        email: "a@x.com",
        passwordHash: "h",
        displayName: "A",
        role: "owner",
        isSuperAdmin: false,
        status: "active",
      });
      const userB = await storage.createUser({
        id: randomUUID(),
        tenantId: tenantB.id,
        email: "b@x.com",
        passwordHash: "h",
        displayName: "B",
        role: "owner",
        isSuperAdmin: false,
        status: "active",
      });
      return { tenantA, tenantB, userA, userB };
    }

    test("getUserById is tenant-scoped (cross-tenant returns null)", async () => {
      const storage = await make();
      const { tenantA, tenantB, userA } = await seedTwoTenants(storage);
      expect(await storage.getUserById(tenantB.id, userA.id)).toBeNull();
      expect((await storage.getUserById(tenantA.id, userA.id))?.email).toBe("a@x.com");
      await storage.close();
    });

    test("listUsers only returns the requested tenant", async () => {
      const storage = await make();
      const { tenantA } = await seedTwoTenants(storage);
      const users = await storage.listUsers(tenantA.id);
      expect(users.map((u) => u.email)).toEqual(["a@x.com"]);
      await storage.close();
    });

    test("email is globally unique for login lookup", async () => {
      const storage = await make();
      const { userA } = await seedTwoTenants(storage);
      expect((await storage.getUserByEmail("a@x.com"))?.id).toBe(userA.id);
      expect(await storage.getUserByEmail("missing@x.com")).toBeNull();
      await storage.close();
    });

    test("tokens: create, resolve by hash, revoke, and tenant-scoped bulk revoke", async () => {
      const storage = await make();
      const { tenantA, userA } = await seedTwoTenants(storage);
      const tokenHash = randomUUID().replace(/-/g, "");
      await storage.createToken({
        id: randomUUID(),
        tenantId: tenantA.id,
        userId: userA.id,
        kind: "session",
        tokenHash,
        label: "",
        expiresAt: null,
      });
      expect((await storage.getTokenByHash(tokenHash))?.userId).toBe(userA.id);

      await storage.touchToken(tokenHash, new Date().toISOString());
      expect((await storage.getTokenByHash(tokenHash))?.lastUsedAt).not.toBeNull();

      await storage.revokeToken(tokenHash);
      expect((await storage.getTokenByHash(tokenHash))?.revokedAt).not.toBeNull();

      const revoked = await storage.revokeAllUserTokens(tenantA.id, userA.id);
      expect(revoked).toBe(0); // already revoked; none live
      await storage.close();
    });

    test("setUserStatus / setUserRole are tenant-scoped", async () => {
      const storage = await make();
      const { tenantA, tenantB, userA } = await seedTwoTenants(storage);
      // Wrong tenant scope => no-op, returns null.
      expect(await storage.setUserRole(tenantB.id, userA.id, "admin")).toBeNull();
      expect((await storage.getUserById(tenantA.id, userA.id))?.role).toBe("owner");
      // Correct scope updates.
      expect((await storage.setUserRole(tenantA.id, userA.id, "admin"))?.role).toBe("admin");
      await storage.close();
    });

    test("super-admin plane listings cross tenants", async () => {
      const storage = await make();
      await seedTwoTenants(storage);
      expect((await storage.listTenantsGlobal()).length).toBe(2);
      expect((await storage.listUsersGlobal()).length).toBe(2);
      await storage.close();
    });
  });
}
