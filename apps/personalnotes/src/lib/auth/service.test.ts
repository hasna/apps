import { beforeEach, describe, expect, test } from "bun:test";
import { resolveConfig } from "../config.js";
import { isAuthError } from "../errors.js";
import { SqliteAuthStorage } from "../storage/sqlite.js";
import { AuthService } from "./service.js";

async function freshService(overrides = {}) {
  const storage = new SqliteAuthStorage({ path: ":memory:" });
  await storage.migrate();
  const config = resolveConfig({
    sqlitePath: ":memory:",
    superAdminEmail: "andrei@hasna.com",
    ...overrides,
  });
  return { storage, service: new AuthService(storage, config) };
}

describe("AuthService register/login", () => {
  let service: AuthService;

  beforeEach(async () => {
    ({ service } = await freshService());
  });

  test("register creates a tenant + owner user and returns a session token", async () => {
    const result = await service.register({ email: "a@example.com", password: "supersecret1" });
    expect(result.user.email).toBe("a@example.com");
    expect(result.user.role).toBe("owner");
    expect(result.user.isSuperAdmin).toBe(false);
    expect(result.tenant.id).toBeTruthy();
    expect(result.token.startsWith("pn_sess_")).toBe(true);
    expect(result.tokenKind).toBe("session");
    expect(result.expiresAt).toBeTruthy();
  });

  test("register normalizes email casing/whitespace", async () => {
    const result = await service.register({ email: "  MixedCase@Example.COM ", password: "supersecret1" });
    expect(result.user.email).toBe("mixedcase@example.com");
  });

  test("duplicate email is rejected", async () => {
    await service.register({ email: "dup@example.com", password: "supersecret1" });
    const err = await service.register({ email: "dup@example.com", password: "supersecret2" }).catch((e) => e);
    expect(isAuthError(err) && err.code).toBe("email_taken");
  });

  test("weak password is rejected", async () => {
    const err = await service.register({ email: "weak@example.com", password: "short" }).catch((e) => e);
    expect(isAuthError(err) && err.code).toBe("invalid_request");
  });

  test("invalid email is rejected", async () => {
    const err = await service.register({ email: "not-an-email", password: "supersecret1" }).catch((e) => e);
    expect(isAuthError(err) && err.code).toBe("invalid_request");
  });

  test("login succeeds with correct password and fails with wrong password", async () => {
    await service.register({ email: "login@example.com", password: "supersecret1" });
    const ok = await service.login("login@example.com", "supersecret1");
    expect(ok.token.startsWith("pn_sess_")).toBe(true);

    const err = await service.login("login@example.com", "wrongpassword").catch((e) => e);
    expect(isAuthError(err) && err.code).toBe("invalid_credentials");
  });

  test("login for unknown email fails as invalid_credentials (no enumeration leak)", async () => {
    const err = await service.login("ghost@example.com", "whatever12").catch((e) => e);
    expect(isAuthError(err) && err.code).toBe("invalid_credentials");
  });

  test("tenant slugs are unique even for similar names", async () => {
    const a = await service.register({ email: "x@a.com", password: "supersecret1", tenantName: "Acme" });
    const b = await service.register({ email: "y@b.com", password: "supersecret1", tenantName: "Acme" });
    expect(a.tenant.slug).not.toBe(b.tenant.slug);
  });
});

describe("AuthService token lifecycle", () => {
  test("authenticate resolves a valid session token to an AuthContext", async () => {
    const { service } = await freshService();
    const reg = await service.register({ email: "tok@example.com", password: "supersecret1" });
    const ctx = await service.authenticate(reg.token);
    expect(ctx.email).toBe("tok@example.com");
    expect(ctx.tenantId).toBe(reg.tenant.id);
    expect(ctx.tokenKind).toBe("session");
  });

  test("logout revokes the token so authenticate then fails", async () => {
    const { service } = await freshService();
    const reg = await service.register({ email: "out@example.com", password: "supersecret1" });
    await service.logout(reg.token);
    const err = await service.authenticate(reg.token).catch((e) => e);
    expect(isAuthError(err) && err.code).toBe("unauthenticated");
  });

  test("expired session token is rejected", async () => {
    const storage = new SqliteAuthStorage({ path: ":memory:" });
    await storage.migrate();
    let clock = Date.now();
    const config = resolveConfig({ sqlitePath: ":memory:", sessionTtlSeconds: 60 });
    const service = new AuthService(storage, config, () => clock);
    const reg = await service.register({ email: "exp@example.com", password: "supersecret1" });
    clock += 61 * 1000;
    const err = await service.authenticate(reg.token).catch((e) => e);
    expect(isAuthError(err) && err.code).toBe("unauthenticated");
  });

  test("api token can be minted and used, and appears in listing without plaintext", async () => {
    const { service } = await freshService();
    const reg = await service.register({ email: "api@example.com", password: "supersecret1" });
    const ctx = await service.authenticate(reg.token);
    const apiResult = await service.createApiToken(ctx, "cli");
    expect(apiResult.token.startsWith("pn_")).toBe(true);
    expect(apiResult.token.startsWith("pn_sess_")).toBe(false);

    const apiCtx = await service.authenticate(apiResult.token);
    expect(apiCtx.tokenKind).toBe("api");
    expect(apiCtx.userId).toBe(reg.user.id);

    const tokens = await service.listMyTokens(ctx);
    expect(tokens.length).toBe(2);
    expect(tokens.every((t) => !("tokenHash" in t))).toBe(true);
  });

  test("garbage / empty tokens are rejected", async () => {
    const { service } = await freshService();
    for (const bad of ["", "garbage", "Bearer x", "pn_"]) {
      const err = await service.authenticate(bad).catch((e) => e);
      expect(isAuthError(err) && err.code).toBe("unauthenticated");
    }
  });
});
