import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { hashBearerToken } from "../src/auth";
import { ComputersError, type AuthorizationContext, type InstallPolicyRevision, type InstallPolicyRule } from "../src/contracts";
import { StaticInstallTicketSigningKeyProvider } from "../src/install-policy";
import { createApp } from "../src/server";
import { ComputersService } from "../src/service";
import { SQLiteStorage } from "../src/storage";

const rules: InstallPolicyRule[] = [{ effect: "deny" }];
const missingComputerId = "cmp_oracle_missing";
const notFound = { code: "not_found", message: "Computer not found", status: 404 };
const denied = { code: "authorization_denied", message: "Authorization denied", status: 403 };
const staleGeneration = { code: "policy_generation_mismatch", message: "Authorization denied", status: 403 };

function captureFailure(callback: () => unknown): { code: string; message: string; status: number } {
  try {
    callback();
  } catch (error) {
    if (error instanceof ComputersError) return { code: error.code, message: error.message, status: error.status };
    throw error;
  }
  throw new Error("Expected ComputersError");
}

describe("Computer existence nondisclosure", () => {
  let storage: SQLiteStorage;
  let service: ComputersService;
  let targetComputerId: string;
  let boundComputerId: string;
  let admin: AuthorizationContext;
  let boundAdmin: AuthorizationContext;
  let boundOwner: AuthorizationContext;
  let owner: AuthorizationContext;
  let ownerWithoutRead: AuthorizationContext;
  let ownerWithoutPolicy: AuthorizationContext;
  let crossTenantAdmin: AuthorizationContext;

  beforeEach(() => {
    storage = new SQLiteStorage(":memory:");
    storage.migrate();
    service = new ComputersService(storage, {
      ticketSigningKeyProvider: new StaticInstallTicketSigningKeyProvider(randomBytes(32)),
    });
    admin = {
      tenantId: "tenant_oracle", principalId: "principal_admin", scopes: ["computers:admin"], authMethod: "bearer",
    };
    const target = service.createComputer(admin, {
      slug: "oracle-target", provider: "local_machine", ownerPrincipalId: "principal_owner", idempotencyKey: "oracle-target-create",
    });
    // The storage domain permits one active assignment per principal. Retire A's
    // assignment so the same principal can own B while A remains addressable;
    // the assertions below prove boundComputerId, not ownership, hides A.
    storage.updateComputerStatus(admin.tenantId, target.id, "deleted");
    const endedAt = new Date().toISOString();
    const retired = storage.database.query(
      "UPDATE assignments SET active = 0, ended_at = ? WHERE tenant_id = ? AND computer_id = ? AND principal_id = ? AND active = 1",
    ).run(endedAt, admin.tenantId, target.id, target.ownerPrincipalId);
    expect(retired.changes).toBe(1);
    const bound = service.createComputer(admin, {
      slug: "oracle-bound", provider: "local_machine", ownerPrincipalId: target.ownerPrincipalId, idempotencyKey: "oracle-bound-create",
    });
    targetComputerId = target.id;
    boundComputerId = bound.id;
    boundOwner = {
      tenantId: admin.tenantId,
      principalId: target.ownerPrincipalId,
      scopes: ["computers:read", "computers:policy"],
      boundComputerId: bound.id,
      policyGeneration: bound.policyGeneration,
      authMethod: "bearer",
    };
    owner = {
      ...boundOwner,
      boundComputerId: target.id,
      policyGeneration: target.policyGeneration,
    };
    ownerWithoutRead = { ...owner, scopes: ["computers:policy"] };
    ownerWithoutPolicy = { ...owner, scopes: ["computers:read"] };
    boundAdmin = { ...admin, boundComputerId: bound.id, policyGeneration: bound.policyGeneration };
    crossTenantAdmin = {
      tenantId: "tenant_other", principalId: "principal_other_admin", scopes: ["computers:admin"], authMethod: "bearer",
    };
  });

  afterEach(() => storage.close());

  const getPolicy = (context: AuthorizationContext, computerId: string): InstallPolicyRevision => {
    return service.getInstallPolicy(context, computerId);
  };

  const boundaries = () => [
    {
      name: "general Computer lookup",
      invoke: (context: AuthorizationContext, id: string) => service.getComputer(context, id),
      missingScope: () => ownerWithoutRead,
    },
    {
      name: "install policy GET",
      invoke: (context: AuthorizationContext, id: string) => getPolicy(context, id),
      missingScope: () => ownerWithoutRead,
    },
    {
      name: "install policy POST",
      invoke: (context: AuthorizationContext, id: string) => service.createInstallPolicy(context, id, rules),
      missingScope: () => ownerWithoutPolicy,
    },
  ];

  test("service lookup and policy boundaries apply one existence-safe ordering", () => {
    for (const boundary of boundaries()) {
      const boundExisting = captureFailure(() => boundary.invoke(boundOwner, targetComputerId));
      const boundMissing = captureFailure(() => boundary.invoke(boundOwner, missingComputerId));
      expect(boundExisting, `${boundary.name} bound owner existing`).toEqual(notFound);
      expect(boundMissing, `${boundary.name} bound owner missing`).toEqual(boundExisting);

      const boundAdminExisting = captureFailure(() => boundary.invoke(boundAdmin, targetComputerId));
      const boundAdminMissing = captureFailure(() => boundary.invoke(boundAdmin, missingComputerId));
      expect(boundAdminExisting, `${boundary.name} bound admin existing`).toEqual(notFound);
      expect(boundAdminMissing, `${boundary.name} bound admin missing`).toEqual(boundAdminExisting);

      const missingScope = boundary.missingScope();
      const missingScopeExisting = captureFailure(() => boundary.invoke(missingScope, targetComputerId));
      const missingScopeAbsent = captureFailure(() => boundary.invoke(missingScope, missingComputerId));
      expect(missingScopeExisting, `${boundary.name} missing scope existing`).toEqual(denied);
      expect(missingScopeAbsent, `${boundary.name} missing scope absent`).toEqual(missingScopeExisting);

      const crossTenantExisting = captureFailure(() => boundary.invoke(crossTenantAdmin, targetComputerId));
      const crossTenantMissing = captureFailure(() => boundary.invoke(crossTenantAdmin, missingComputerId));
      expect(crossTenantExisting, `${boundary.name} cross-tenant existing`).toEqual(notFound);
      expect(crossTenantMissing, `${boundary.name} cross-tenant missing`).toEqual(crossTenantExisting);
    }

    expect(service.getComputer(owner, targetComputerId).id).toBe(targetComputerId);
    expect(getPolicy(owner, targetComputerId)).toMatchObject({ computerId: targetComputerId, generation: 1 });
    expect(service.createInstallPolicy(owner, targetComputerId, rules)).toMatchObject({ computerId: targetComputerId, generation: 2 });

    expect(service.getComputer(admin, targetComputerId).id).toBe(targetComputerId);
    expect(getPolicy(admin, targetComputerId)).toMatchObject({ computerId: targetComputerId, generation: 2 });
    expect(service.createInstallPolicy(admin, targetComputerId, rules)).toMatchObject({ computerId: targetComputerId, generation: 3 });

    const staleOwner = { ...owner, policyGeneration: 999 };
    for (const boundary of boundaries()) {
      expect(captureFailure(() => boundary.invoke(staleOwner, targetComputerId)), `${boundary.name} stale generation`).toEqual(staleGeneration);
    }
  });

  test("REST lookup and policy routes return exact existence-safe envelopes", async () => {
    const credentials = {
      boundOwner: randomBytes(32).toString("base64url"),
      boundAdmin: randomBytes(32).toString("base64url"),
      owner: randomBytes(32).toString("base64url"),
      ownerWithoutRead: randomBytes(32).toString("base64url"),
      ownerWithoutPolicy: randomBytes(32).toString("base64url"),
      admin: randomBytes(32).toString("base64url"),
      staleOwner: randomBytes(32).toString("base64url"),
      crossTenantAdmin: randomBytes(32).toString("base64url"),
    };
    const app = createApp(service, {
      principals: await Promise.all([
        [credentials.boundOwner, boundOwner],
        [credentials.boundAdmin, boundAdmin],
        [credentials.owner, owner],
        [credentials.ownerWithoutRead, ownerWithoutRead],
        [credentials.ownerWithoutPolicy, ownerWithoutPolicy],
        [credentials.admin, admin],
        [credentials.staleOwner, { ...owner, policyGeneration: 999 }],
        [credentials.crossTenantAdmin, crossTenantAdmin],
      ].map(async ([credential, context]) => ({
        tokenHash: await hashBearerToken(credential as string), context: context as AuthorizationContext,
      }))),
    });
    const request = async (credential: string, method: "GET" | "POST", path: string, requestId: string) => {
      const response = await app(new Request(`http://127.0.0.1${path}`, {
        method,
        headers: {
          authorization: `Bearer ${credential}`,
          "x-request-id": requestId,
          ...(method === "POST" ? { "content-type": "application/json" } : {}),
        },
        ...(method === "POST" ? { body: JSON.stringify({ rules }) } : {}),
      }));
      return { status: response.status, body: await response.json() };
    };
    const routes = [
      {
        name: "general Computer lookup", method: "GET" as const, suffix: "",
        requestIds: { bound: "req_oracle_general_bound", boundAdmin: "req_oracle_general_bound_admin", scope: "req_oracle_general_scope", crossTenant: "req_oracle_general_tenant", stale: "req_oracle_general_stale" },
        missingScopeCredential: credentials.ownerWithoutRead,
      },
      {
        name: "install policy GET", method: "GET" as const, suffix: "/install/policy",
        requestIds: { bound: "req_oracle_policy_get_bound", boundAdmin: "req_oracle_policy_get_bound_admin", scope: "req_oracle_policy_get_scope", crossTenant: "req_oracle_policy_get_tenant", stale: "req_oracle_policy_get_stale" },
        missingScopeCredential: credentials.ownerWithoutRead,
      },
      {
        name: "install policy POST", method: "POST" as const, suffix: "/install/policy",
        requestIds: { bound: "req_oracle_policy_post_bound", boundAdmin: "req_oracle_policy_post_bound_admin", scope: "req_oracle_policy_post_scope", crossTenant: "req_oracle_policy_post_tenant", stale: "req_oracle_policy_post_stale" },
        missingScopeCredential: credentials.ownerWithoutPolicy,
      },
    ];

    const exactError = (failure: typeof notFound | typeof denied | typeof staleGeneration, requestId: string) => ({
      status: failure.status,
      body: { error: { code: failure.code, message: failure.message, requestId } },
    });

    for (const route of routes) {
      const boundExisting = await request(
        credentials.boundOwner, route.method, `/v1/computers/${targetComputerId}${route.suffix}`, route.requestIds.bound,
      );
      const boundMissing = await request(
        credentials.boundOwner, route.method, `/v1/computers/${missingComputerId}${route.suffix}`, route.requestIds.bound,
      );
      expect(boundExisting, `${route.name} bound owner existing`).toEqual(exactError(notFound, route.requestIds.bound));
      expect(boundMissing, `${route.name} bound owner missing`).toEqual(boundExisting);

      const boundAdminExisting = await request(
        credentials.boundAdmin, route.method, `/v1/computers/${targetComputerId}${route.suffix}`, route.requestIds.boundAdmin,
      );
      const boundAdminMissing = await request(
        credentials.boundAdmin, route.method, `/v1/computers/${missingComputerId}${route.suffix}`, route.requestIds.boundAdmin,
      );
      expect(boundAdminExisting, `${route.name} bound admin existing`).toEqual(exactError(notFound, route.requestIds.boundAdmin));
      expect(boundAdminMissing, `${route.name} bound admin missing`).toEqual(boundAdminExisting);

      const missingScopeExisting = await request(
        route.missingScopeCredential, route.method, `/v1/computers/${targetComputerId}${route.suffix}`, route.requestIds.scope,
      );
      const missingScopeAbsent = await request(
        route.missingScopeCredential, route.method, `/v1/computers/${missingComputerId}${route.suffix}`, route.requestIds.scope,
      );
      expect(missingScopeExisting, `${route.name} missing scope existing`).toEqual(exactError(denied, route.requestIds.scope));
      expect(missingScopeAbsent, `${route.name} missing scope absent`).toEqual(missingScopeExisting);

      const crossTenantExisting = await request(
        credentials.crossTenantAdmin, route.method, `/v1/computers/${targetComputerId}${route.suffix}`, route.requestIds.crossTenant,
      );
      const crossTenantMissing = await request(
        credentials.crossTenantAdmin, route.method, `/v1/computers/${missingComputerId}${route.suffix}`, route.requestIds.crossTenant,
      );
      expect(crossTenantExisting, `${route.name} cross-tenant existing`).toEqual(exactError(notFound, route.requestIds.crossTenant));
      expect(crossTenantMissing, `${route.name} cross-tenant missing`).toEqual(crossTenantExisting);
    }

    const ownerGeneral = await request(credentials.owner, "GET", `/v1/computers/${targetComputerId}`, "req_oracle_owner_get");
    expect(ownerGeneral).toMatchObject({ status: 200, body: { id: targetComputerId } });
    const ownerPolicy = await request(credentials.owner, "GET", `/v1/computers/${targetComputerId}/install/policy`, "req_oracle_owner_policy_get");
    expect(ownerPolicy).toMatchObject({ status: 200, body: { computerId: targetComputerId, generation: 1 } });
    const ownerUpdate = await request(credentials.owner, "POST", `/v1/computers/${targetComputerId}/install/policy`, "req_oracle_owner_policy_post");
    expect(ownerUpdate).toMatchObject({ status: 201, body: { computerId: targetComputerId, generation: 2 } });

    const adminGeneral = await request(credentials.admin, "GET", `/v1/computers/${targetComputerId}`, "req_oracle_admin_get");
    expect(adminGeneral).toMatchObject({ status: 200, body: { id: targetComputerId } });
    const adminPolicy = await request(credentials.admin, "GET", `/v1/computers/${targetComputerId}/install/policy`, "req_oracle_admin_policy_get");
    expect(adminPolicy).toMatchObject({ status: 200, body: { computerId: targetComputerId, generation: 2 } });
    const adminUpdate = await request(credentials.admin, "POST", `/v1/computers/${targetComputerId}/install/policy`, "req_oracle_admin_policy_post");
    expect(adminUpdate).toMatchObject({ status: 201, body: { computerId: targetComputerId, generation: 3 } });

    for (const route of routes) {
      const stale = await request(
        credentials.staleOwner, route.method, `/v1/computers/${targetComputerId}${route.suffix}`, route.requestIds.stale,
      );
      expect(stale, `${route.name} stale generation`).toEqual(exactError(staleGeneration, route.requestIds.stale));
    }
  });

  test("delegated creation and parent grant resolution hide inaccessible parents before object-specific checks", async () => {
    const activeParent = service.getComputer(admin, boundComputerId);
    const childOwners = ["principal_parent_child_service", "principal_parent_child_rest", "principal_parent_child_other"];
    const grantInput = {
      principalId: activeParent.ownerPrincipalId, ownerPrincipalId: activeParent.ownerPrincipalId, parentComputerId: activeParent.id,
      allowedProviders: ["local_machine" as const], allowedChildOwnerPrincipalIds: childOwners, allowedRegions: ["local"],
      allowedProfileIds: ["profile_default"], maxStorageGiB: 32, maxUptimeSeconds: 600, maxBudgetMicros: 1000, limit: 3,
    };
    const grant = service.createComputerGrant(admin, grantInput);
    const delegatedOwner: AuthorizationContext = {
      tenantId: admin.tenantId, principalId: activeParent.ownerPrincipalId, scopes: ["computers:create"],
      boundComputerId: activeParent.id, policyGeneration: activeParent.policyGeneration, authMethod: "bearer",
    };
    const missingScope = { ...delegatedOwner, scopes: ["computers:read" as const] };
    const wrongOwner: AuthorizationContext = { tenantId: admin.tenantId, principalId: "principal_parent_stranger", scopes: ["computers:create"],
      boundComputerId: targetComputerId, policyGeneration: 1, authMethod: "bearer" };
    const staleOwner = { ...delegatedOwner, policyGeneration: 999 };
    const input = (parentComputerId: string, suffix: string, ownerPrincipalId = childOwners[2] ?? "principal_parent_child_other") => ({
      slug: `parent-oracle-${suffix}`, provider: "local_machine" as const, ownerPrincipalId, parentComputerId, grantId: grant.id,
      region: "local", profileId: "profile_default", storageGiB: 32, uptimeSeconds: 600, budgetMicros: 1000,
      idempotencyKey: `parent-oracle-${suffix}`,
    });
    const pairs: Array<{ name: string; context: AuthorizationContext; failure: typeof notFound | typeof denied }> = [
      { name: "bound owner", context: delegatedOwner, failure: notFound },
      { name: "bound admin", context: boundAdmin, failure: notFound },
      { name: "wrong owner", context: wrongOwner, failure: notFound },
      { name: "missing scope", context: missingScope, failure: denied },
      { name: "cross tenant", context: crossTenantAdmin, failure: notFound },
    ];
    for (const pair of pairs) {
      const existing = captureFailure(() => service.createComputer(pair.context, input(targetComputerId, `${pair.name.replace(" ", "-")}-existing`)));
      const missing = captureFailure(() => service.createComputer(pair.context, input(missingComputerId, `${pair.name.replace(" ", "-")}-missing`)));
      expect(existing, `${pair.name} existing parent`).toEqual(pair.failure);
      expect(missing, `${pair.name} missing parent`).toEqual(existing);
    }
    expect(captureFailure(() => service.createComputer(staleOwner, input(activeParent.id, "stale")))).toEqual(staleGeneration);
    expect(service.createComputer(delegatedOwner, input(activeParent.id, "authorized-service", childOwners[0])).status).toBe("provisioning");

    const boundGrantExisting = captureFailure(() => service.createComputerGrant(boundAdmin, { ...grantInput, parentComputerId: targetComputerId }));
    const boundGrantMissing = captureFailure(() => service.createComputerGrant(boundAdmin, { ...grantInput, parentComputerId: missingComputerId }));
    expect(boundGrantExisting).toEqual(notFound); expect(boundGrantMissing).toEqual(boundGrantExisting);
    expect(captureFailure(() => service.createComputerGrant({ ...admin, policyGeneration: 999 }, grantInput))).toEqual(staleGeneration);

    const credentials = {
      delegated: randomBytes(32).toString("base64url"), boundAdmin: randomBytes(32).toString("base64url"), wrongOwner: randomBytes(32).toString("base64url"),
      missingScope: randomBytes(32).toString("base64url"), stale: randomBytes(32).toString("base64url"),
      crossTenant: randomBytes(32).toString("base64url"), admin: randomBytes(32).toString("base64url"),
    };
    const app = createApp(service, { principals: await Promise.all([
      [credentials.delegated, delegatedOwner], [credentials.boundAdmin, boundAdmin], [credentials.wrongOwner, wrongOwner], [credentials.missingScope, missingScope],
      [credentials.stale, staleOwner], [credentials.crossTenant, crossTenantAdmin], [credentials.admin, admin],
    ].map(async ([credential, context]) => ({ tokenHash: await hashBearerToken(credential as string), context: context as AuthorizationContext }))) });
    const post = async (credential: string, path: string, body: Record<string, unknown>, requestId: string, idempotencyKey?: string) => {
      const response = await app(new Request(`http://127.0.0.1${path}`, { method: "POST", headers: {
        authorization: `Bearer ${credential}`, "content-type": "application/json", "x-request-id": requestId,
        ...(idempotencyKey === undefined ? {} : { "idempotency-key": idempotencyKey }),
      }, body: JSON.stringify(body) }));
      return { status: response.status, body: await response.json() };
    };
    const exactError = (failure: typeof notFound | typeof denied | typeof staleGeneration, requestId: string) => ({
      status: failure.status, body: { error: { code: failure.code, message: failure.message, requestId } },
    });
    const createBody = (parentComputerId: string, suffix: string, ownerPrincipalId = childOwners[2] ?? "principal_parent_child_other") => {
      const { idempotencyKey: _key, ...body } = input(parentComputerId, suffix, ownerPrincipalId); return body;
    };
    for (const pair of [
      { name: "bound", credential: credentials.delegated, failure: notFound },
      { name: "bound-admin", credential: credentials.boundAdmin, failure: notFound },
      { name: "owner", credential: credentials.wrongOwner, failure: notFound },
      { name: "scope", credential: credentials.missingScope, failure: denied },
      { name: "tenant", credential: credentials.crossTenant, failure: notFound },
    ]) {
      const requestId = `req_parent_${pair.name.replace("-", "_")}`;
      const existing = await post(pair.credential, "/v1/computers", createBody(targetComputerId, `${pair.name}-rest-existing`), requestId, `${pair.name}-rest-existing`);
      const missing = await post(pair.credential, "/v1/computers", createBody(missingComputerId, `${pair.name}-rest-missing`), requestId, `${pair.name}-rest-missing`);
      expect(existing, `${pair.name} REST existing parent`).toEqual(exactError(pair.failure, requestId));
      expect(missing, `${pair.name} REST missing parent`).toEqual(existing);
    }
    expect(await post(credentials.stale, "/v1/computers", createBody(activeParent.id, "stale-rest"), "req_parent_stale", "stale-rest"))
      .toEqual(exactError(staleGeneration, "req_parent_stale"));
    expect(await post(credentials.delegated, "/v1/computers", createBody(activeParent.id, "authorized-rest", childOwners[1]), "req_parent_authorized", "authorized-rest"))
      .toMatchObject({ status: 201, body: { ownerPrincipalId: childOwners[1], status: "provisioning" } });

    const grantExisting = await post(credentials.boundAdmin, "/v1/computer-create-grants", { ...grantInput, parentComputerId: targetComputerId }, "req_grant_bound");
    const grantMissing = await post(credentials.boundAdmin, "/v1/computer-create-grants", { ...grantInput, parentComputerId: missingComputerId }, "req_grant_bound");
    expect(grantExisting).toEqual(exactError(notFound, "req_grant_bound")); expect(grantMissing).toEqual(grantExisting);
    expect(await post(credentials.missingScope, "/v1/computer-create-grants", grantInput, "req_grant_scope"))
      .toEqual(exactError(denied, "req_grant_scope"));
  });

  test("REST maps a stale divergent install-policy writer to a bounded conflict envelope", async () => {
    const active = service.getComputer(admin, boundComputerId);
    service.createInstallPolicy(admin, active.id, [{ effect: "allow", managers: ["bun"] }]);
    const staleStorage = new Proxy(storage, {
      get(target, property) {
        if (property === "getComputer") {
          return (tenantId: string, id: string) => id === active.id && tenantId === active.tenantId ? { ...active } : target.getComputer(tenantId, id);
        }
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const staleService = new ComputersService(staleStorage, {
      ticketSigningKeyProvider: new StaticInstallTicketSigningKeyProvider(randomBytes(32)),
    });
    const credential = randomBytes(32).toString("base64url");
    const app = createApp(staleService, { principals: [{ tokenHash: await hashBearerToken(credential), context: admin }] });
    const response = await app(new Request(`http://127.0.0.1/v1/computers/${active.id}/install/policy`, {
      method: "POST", headers: { authorization: `Bearer ${credential}`, "content-type": "application/json", "x-request-id": "req_policy_cas_conflict" },
      body: JSON.stringify({ rules: [{ effect: "deny" }] }),
    }));
    expect({ status: response.status, body: await response.json() }).toEqual({
      status: 409,
      body: { error: { code: "conflict", message: "Install policy generation already has a different revision", requestId: "req_policy_cas_conflict" } },
    });
  });
});
