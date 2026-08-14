import { describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { hashBearerToken } from "../src/auth";
import { ComputersError, type AuthorizationContext, type Computer, type InstallPolicyRevision, type Operation, type ProviderOutcome } from "../src/contracts";
import { StaticInstallTicketSigningKeyProvider } from "../src/install-policy";
import { createProviderPorts, type ProviderPort } from "../src/providers";
import { createApp } from "../src/server";
import { ComputersService } from "../src/service";
import { SQLiteStorage, makeId, sha256 } from "../src/storage";
import { OperationWorker } from "../src/worker";

const admin: AuthorizationContext = { tenantId: "tenant_rc", principalId: "principal_admin", scopes: ["computers:admin"], authMethod: "bearer" };

function newService(): { storage: SQLiteStorage; service: ComputersService } {
  const storage = new SQLiteStorage(":memory:"); storage.migrate();
  const service = new ComputersService(storage, { ticketSigningKeyProvider: new StaticInstallTicketSigningKeyProvider(randomBytes(32)) });
  return { storage, service };
}

function captureError(action: () => unknown): Pick<ComputersError, "code" | "message" | "status"> {
  try { action(); } catch (error) {
    expect(error).toBeInstanceOf(ComputersError); const failure = error as ComputersError;
    return { code: failure.code, message: failure.message, status: failure.status };
  }
  throw new Error("Expected ComputersError");
}

const localVmProfile = (homeDiskGiB: number) => ({
  provider: "local_vm" as const, cpus: 2, memoryGiB: 4, rootDiskGiB: 16, homeDiskGiB,
  imageLocation: "https://images.example.invalid/rc.qcow2", imageDigest: `sha256:${"a".repeat(64)}`,
});

describe("release-candidate reserved profile identifiers (finding 7)", () => {
  test("service and storage both reject creating a profile with a reserved built-in id", () => {
    const { storage, service } = newService();
    try {
      for (const id of ["profile_default", "profile_adopted"]) {
        expect(captureError(() => service.createProfile(admin, { id, name: "Shadow", document: localVmProfile(32) })))
          .toEqual({ code: "invalid_request", message: "Profile id is reserved for a built-in profile", status: 400 });
      }
      // Defense in depth: the storage layer refuses the reserved id even if the service guard is bypassed.
      const now = new Date().toISOString();
      const document = { provider: "local_machine" as const, cpus: 4, memoryGiB: 8, rootDiskGiB: 32, homeDiskGiB: 32 };
      expect(() => storage.createProfile(
        { id: "profile_default", tenantId: admin.tenantId, name: "Shadow", generation: 1, digest: `sha256:${"b".repeat(64)}`, document, createdAt: now },
        { actorPrincipalId: admin.principalId, action: "profile.created", data: {}, computerId: undefined as never },
      )).toThrow("reserved");
      // A non-reserved id still succeeds.
      expect(service.createProfile(admin, { id: "profile_ok", name: "Fine", document: localVmProfile(32) }).id).toBe("profile_ok");
    } finally { storage.close(); }
  });
});

describe("release-candidate storage/profile quota invariant (finding 3)", () => {
  test("requested storageGiB must cover the bound local_vm profile home disk", () => {
    const { storage, service } = newService();
    try {
      service.createProfile(admin, { id: "profile_big_home", name: "Big home", document: localVmProfile(64) });
      // Non-delegated admin create: under-declaring storage below the provisioned home disk is rejected.
      expect(captureError(() => service.createComputer(admin, {
        slug: "rc-under", provider: "local_vm", ownerPrincipalId: "principal_rc_a", profileId: "profile_big_home", storageGiB: 32, idempotencyKey: "rc-under-001",
      }))).toEqual({ code: "invalid_request", message: "Requested storageGiB must cover the bound profile home disk", status: 400 });
      // Covering storage is accepted.
      expect(service.createComputer(admin, {
        slug: "rc-ok", provider: "local_vm", ownerPrincipalId: "principal_rc_b", profileId: "profile_big_home", storageGiB: 64, idempotencyKey: "rc-ok-001",
      }).status).toBe("provisioning");
    } finally { storage.close(); }
  });

  test("a grant-bounded delegated request cannot under-declare storage below the profile home disk, and stays authorization-first", async () => {
    const { storage, service } = newService();
    try {
      const parent = service.createComputer(admin, { slug: "rc-parent", provider: "local_machine", ownerPrincipalId: "principal_rc_parent", idempotencyKey: "rc-parent-001" });
      service.createProfile(admin, { id: "profile_deleg_home", name: "Delegated home", document: localVmProfile(64) });
      const grant = service.createComputerGrant(admin, {
        principalId: "principal_rc_parent", ownerPrincipalId: "principal_rc_parent", parentComputerId: parent.id,
        allowedProviders: ["local_vm"], allowedChildOwnerPrincipalIds: ["principal_rc_child"], allowedRegions: ["local"],
        allowedProfileIds: ["profile_deleg_home"], maxStorageGiB: 64, maxUptimeSeconds: 600, maxBudgetMicros: 1000, limit: 4,
      });
      const delegated: AuthorizationContext = { tenantId: admin.tenantId, principalId: "principal_rc_parent", scopes: ["computers:create"],
        boundComputerId: parent.id, policyGeneration: parent.policyGeneration, authMethod: "bearer" };
      const body = (storageGiB: number, key: string) => ({
        slug: "rc-child", provider: "local_vm" as const, ownerPrincipalId: "principal_rc_child", parentComputerId: parent.id, grantId: grant.id,
        region: "local", profileId: "profile_deleg_home", storageGiB, uptimeSeconds: 600, budgetMicros: 1000, idempotencyKey: key,
      });
      // The bypass: storageGiB (32) <= maxStorageGiB (64) but below the profile's provisioned homeDiskGiB (64).
      expect(captureError(() => service.createComputer(delegated, body(32, "rc-child-bypass"))))
        .toEqual({ code: "invalid_request", message: "Requested storageGiB must cover the bound profile home disk", status: 400 });
      // A caller without create authority is denied before any profile/storage disclosure (no oracle).
      const noScope = { ...delegated, scopes: ["computers:read" as const] };
      expect(captureError(() => service.createComputer(noScope, body(32, "rc-child-noscope"))))
        .toEqual({ code: "authorization_denied", message: "Authorization denied", status: 403 });
      // Covering storage within the grant is accepted.
      expect(service.createComputer(delegated, body(64, "rc-child-ok")).status).toBe("provisioning");
    } finally { storage.close(); }
  });
});

describe("release-candidate aws_ec2 unconfigured provider truthfulness (finding 6)", () => {
  test("service create truthfully reports provider_not_configured instead of a fake local profile error", () => {
    const { storage, service } = newService();
    try {
      expect(captureError(() => service.createComputer(admin, { slug: "rc-aws", provider: "aws_ec2", ownerPrincipalId: "principal_rc_aws", idempotencyKey: "rc-aws-001" })))
        .toEqual({ code: "provider_not_configured", message: "AWS EC2 provider is not configured", status: 503 });
    } finally { storage.close(); }
  });

  test("REST create returns a bounded 503 provider_not_configured envelope for aws_ec2", async () => {
    const { storage, service } = newService();
    try {
      const credential = randomBytes(32).toString("base64url");
      const app = createApp(service, { principals: [{ tokenHash: await hashBearerToken(credential), context: admin }] });
      const response = await app(new Request("http://127.0.0.1/v1/computers", {
        method: "POST",
        headers: { authorization: `Bearer ${credential}`, "content-type": "application/json", "x-request-id": "req_rc_aws", "idempotency-key": "rc-aws-rest-001" },
        body: JSON.stringify({ slug: "rc-aws-rest", provider: "aws_ec2", ownerPrincipalId: "principal_rc_aws" }),
      }));
      expect({ status: response.status, body: await response.json() }).toEqual({
        status: 503, body: { error: { code: "provider_not_configured", message: "AWS EC2 provider is not configured", requestId: "req_rc_aws" } },
      });
    } finally { storage.close(); }
  });
});

function lifecycleProvider(resourceId: string): ProviderPort {
  const invoke = async (request: Parameters<ProviderPort["stop"]>[0]): Promise<ProviderOutcome> => {
    const lifecycle = ({ create: "stopped", start: "running", stop: "stopped", quarantine: "quarantined", delete: "deleted", restore: "running" } as const)[request.operation.kind] ?? "stopped";
    return { kind: "success", resource: { resourceId, instanceId: resourceId }, result: { lifecycle, ...(request.operation.kind === "delete" ? { retainHome: true } : {}) } };
  };
  return {
    kind: "local_machine",
    readiness: async () => ({ provider: "local_machine", configured: true, ready: true, confinementClass: "dedicated_machine", controls: {}, limitations: [] }),
    create: invoke, start: invoke, stop: invoke, quarantine: invoke, delete: invoke, restore: invoke, reconcile: invoke,
  };
}

describe("release-candidate host re-assignment and binding provenance (findings 4 and 5)", () => {
  test("deleting an adopted Computer retires its assignment and frees the released host for a new Computer", async () => {
    const storage = new SQLiteStorage(":memory:"); storage.migrate();
    const providers = createProviderPorts(); providers.local_machine = lifecycleProvider("resource_shared_host");
    const service = new ComputersService(storage, { providers, ticketSigningKeyProvider: new StaticInstallTicketSigningKeyProvider(randomBytes(32)) });
    const owner = "principal_rc_host_owner";
    try {
      const first = service.createComputer(admin, { slug: "rc-host-a", provider: "local_machine", ownerPrincipalId: owner, idempotencyKey: "rc-host-a-create" });
      await new OperationWorker(storage, providers).runTenant(admin.tenantId);
      expect(storage.getComputer(admin.tenantId, first.id)?.status).toBe("stopped");
      expect(storage.getProviderBinding(admin.tenantId, first.id)).toMatchObject({ resource: { resourceId: "resource_shared_host" }, state: "active" });

      // The owner's active assignment blocks a second Computer while the first is live.
      expect(captureError(() => service.createComputer(admin, { slug: "rc-host-b", provider: "local_machine", ownerPrincipalId: owner, idempotencyKey: "rc-host-b-early" })))
        .toEqual({ code: "conflict", message: "Computer conflicts with an active assignment or slug", status: 409 });

      // Delete the first Computer: reaches "deleted" and its binding is released.
      const bound = { ...admin, boundComputerId: first.id, policyGeneration: first.policyGeneration };
      service.requestLifecycle(bound, first.id, "delete", "rc-host-a-delete");
      await new OperationWorker(storage, providers).runTenant(admin.tenantId);
      expect(storage.getComputer(admin.tenantId, first.id)?.status).toBe("deleted");
      const retired = storage.database.query("SELECT active FROM assignments WHERE tenant_id = ? AND computer_id = ?").get(admin.tenantId, first.id) as { active: number };
      expect(retired.active).toBe(0);
      expect(storage.getProviderBinding(admin.tenantId, first.id)).toMatchObject({ state: "released" });

      // Finding 4: the same owner can now be assigned a new Computer.
      const second = service.createComputer(admin, { slug: "rc-host-b", provider: "local_machine", ownerPrincipalId: owner, idempotencyKey: "rc-host-b-create" });
      // Finding 5: re-binding the same released machine host to the new Computer succeeds (partial uniqueness).
      await new OperationWorker(storage, providers).runTenant(admin.tenantId);
      expect(storage.getComputer(admin.tenantId, second.id)?.status).toBe("stopped");
      expect(storage.getProviderBinding(admin.tenantId, second.id)).toMatchObject({ resource: { resourceId: "resource_shared_host" }, state: "active" });
    } finally { storage.close(); }
  });

  test("storage enforces the local_vm home-disk quota invariant at the trust boundary, persisting nothing on rejection", () => {
    const { storage, service } = newService();
    try {
      // Build a delegated create that the storage grant/reservation checks accept, so a reservation row
      // would otherwise be written. The service quota guard is deliberately bypassed by calling storage
      // directly; the storage boundary must independently reject the under-declared local_vm create.
      const parent = service.createComputer(admin, { slug: "rc-store-parent", provider: "local_machine", ownerPrincipalId: "principal_store_parent", idempotencyKey: "rc-store-parent-001" });
      const profile = service.createProfile(admin, { id: "profile_store_home", name: "Store home", document: localVmProfile(64) });
      const grant = service.createComputerGrant(admin, {
        principalId: "principal_store_parent", ownerPrincipalId: "principal_store_parent", parentComputerId: parent.id,
        allowedProviders: ["local_vm"], allowedChildOwnerPrincipalIds: ["principal_store_child"], allowedRegions: ["local"],
        allowedProfileIds: ["profile_store_home"], maxStorageGiB: 64, maxUptimeSeconds: 600, maxBudgetMicros: 1000, limit: 4,
      });
      const now = new Date().toISOString();
      const childComputer = (id: string, slug: string): Computer => ({
        id, tenantId: admin.tenantId, slug, provider: "local_vm", confinementClass: "unverified_vm", status: "provisioning",
        ownerPrincipalId: "principal_store_child", policyGeneration: 1, dataExfiltrationProtection: false, createdAt: now, updatedAt: now,
      });
      const requestFor = (storageGiB: number) => ({
        provider: "local_vm", confinementClass: "unverified_vm", region: "local", profileId: profile.id,
        profile: { id: profile.id, generation: profile.generation, digest: profile.digest, document: profile.document },
        storageGiB, uptimeSeconds: 600, budgetMicros: 1000,
      });
      const operationFor = (computerId: string, storageGiB: number, idempotencyKey: string): Operation => ({
        id: makeId("opn"), tenantId: admin.tenantId, computerId, kind: "create", status: "pending", policyGeneration: 1,
        idempotencyKey, request: requestFor(storageGiB), fence: 0, createdAt: now, updatedAt: now,
        priorComputerStatus: "provisioning", desiredComputerStatus: "stopped",
      });
      const policyFor = (computerId: string): InstallPolicyRevision => ({
        id: makeId("pol"), tenantId: admin.tenantId, computerId, generation: 1, digest: sha256({ computerId }), rules: [{ effect: "deny" }], createdAt: now,
      });
      const count = (table: string, column: string, value: string): number =>
        Number((storage.database.query(`SELECT COUNT(*) AS c FROM ${table} WHERE tenant_id = ? AND ${column} = ?`).get(admin.tenantId, value) as { c: number }).c);

      const under = childComputer(makeId("cmp"), "rc-store-under");
      const underOperation = operationFor(under.id, 32, "rc-store-under-key");
      // storageGiB (32) is within the grant (maxStorageGiB 64) yet below the profile home disk (64).
      expect(captureError(() => storage.createComputer(
        { computer: under, parentComputerId: parent.id, grantId: grant.id, requestingPrincipalId: "principal_store_parent", idempotencyKey: "rc-store-under-key", requestHash: sha256({ under: true }) },
        underOperation, policyFor(under.id), { actorPrincipalId: admin.principalId, action: "computer.created", data: {}, computerId: under.id },
      ))).toEqual({ code: "invalid_request", message: "Requested storageGiB must cover the bound profile home disk", status: 400 });
      // The transaction rolled back before any write: no Computer, assignment, reservation, idempotency
      // record, volume, or operation was persisted.
      expect(storage.getComputer(admin.tenantId, under.id)).toBeUndefined();
      expect(storage.getOperation(admin.tenantId, underOperation.id)).toBeUndefined();
      expect(count("assignments", "computer_id", under.id)).toBe(0);
      expect(count("child_reservations", "child_computer_id", under.id)).toBe(0);
      expect(count("volumes", "computer_id", under.id)).toBe(0);
      expect(count("idempotency_keys", "idempotency_key", "rc-store-under-key")).toBe(0);

      // A covering storageGiB (64) persists the child and consumes the reservation, proving the guard is exact.
      const ok = childComputer(makeId("cmp"), "rc-store-ok");
      const created = storage.createComputer(
        { computer: ok, parentComputerId: parent.id, grantId: grant.id, requestingPrincipalId: "principal_store_parent", idempotencyKey: "rc-store-ok-key", requestHash: sha256({ ok: true }) },
        operationFor(ok.id, 64, "rc-store-ok-key"), policyFor(ok.id), { actorPrincipalId: admin.principalId, action: "computer.created", data: {}, computerId: ok.id },
      );
      expect(created.created).toBe(true);
      expect(storage.getComputer(admin.tenantId, ok.id)?.status).toBe("provisioning");
      expect(count("child_reservations", "child_computer_id", ok.id)).toBe(1);
    } finally { storage.close(); }
  });

  test("only one live (active/unknown) binding may hold a resource, while released bindings are retained", () => {
    const storage = new SQLiteStorage(":memory:"); storage.migrate();
    try {
      const index = storage.database.query("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'provider_bindings_active_resource'").get() as { sql: string } | null;
      expect(index?.sql).toContain("WHERE state IN ('unknown', 'active')");
      // No unconditional uniqueness over all states may remain on the rebuilt table.
      const table = storage.database.query("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'provider_bindings'").get() as { sql: string };
      expect(table.sql).not.toContain("UNIQUE (tenant_id, provider, resource_id)");
    } finally { storage.close(); }
  });
});

describe("release-candidate reserved-profile OpenAPI parity (finding 7 schema gap)", () => {
  test("bun run check:schemas passes with the extended CreateComputer/AdoptComputer/CreateComputerProfile cross-checks", async () => {
    const proc = Bun.spawn(["bun", "run", "scripts/check-schemas.ts"], { stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited,
    ]);
    expect({ code, passed: stdout.includes("schema checks passed"), stderr }).toEqual({ code: 0, passed: true, stderr: "" });
  });

  test("OpenAPI pins CreateComputerProfile.id to a reserved-excluding CustomProfileId while built-in references keep Id", () => {
    const api = JSON.parse(readFileSync("schemas/openapi.json", "utf8")) as {
      components: { schemas: Record<string, { properties?: Record<string, unknown>; allOf?: unknown; not?: unknown }> };
    };
    const schemas = api.components.schemas;
    expect(schemas.CreateComputerProfile?.properties?.id).toEqual({ $ref: "#/components/schemas/CustomProfileId" });
    expect(schemas.CustomProfileId).toEqual({ allOf: [{ $ref: "#/components/schemas/Id" }], not: { enum: ["profile_default", "profile_adopted"] } });
    // Built-in profile references elsewhere must remain valid canonical Ids.
    expect(schemas.CreateComputer?.properties?.profileId).toEqual({ $ref: "#/components/schemas/Id" });
    expect(schemas.AdoptComputer?.properties?.profileId).toEqual({ $ref: "#/components/schemas/Id" });
    expect(schemas.CreateComputerGrant?.properties?.allowedProfileIds).toEqual({
      type: "array", minItems: 1, maxItems: 64, uniqueItems: true, items: { $ref: "#/components/schemas/Id" },
    });
  });

  test("runtime REST and storage reject reserved profile ids while a custom id is accepted", async () => {
    const { storage, service } = newService();
    try {
      const credential = randomBytes(32).toString("base64url");
      const app = createApp(service, { principals: [{ tokenHash: await hashBearerToken(credential), context: admin }] });
      const post = (body: unknown, requestId: string): Promise<Response> => app(new Request("http://127.0.0.1/v1/profiles", {
        method: "POST",
        headers: { authorization: `Bearer ${credential}`, "content-type": "application/json", "x-request-id": requestId },
        body: JSON.stringify(body),
      }));
      const reservedDocument = { provider: "local_machine" as const, cpus: 4, memoryGiB: 8, rootDiskGiB: 32, homeDiskGiB: 32 };
      for (const id of ["profile_default", "profile_adopted"]) {
        const response = await post({ id, name: "Shadow", document: localVmProfile(32) }, `req_${id}`);
        expect({ status: response.status, body: await response.json() }).toEqual({
          status: 400, body: { error: { code: "invalid_request", message: "Profile id is reserved for a built-in profile", requestId: `req_${id}` } },
        });
        // Defense in depth: the storage layer refuses the reserved id even if the service guard is bypassed.
        expect(() => storage.createProfile(
          { id, tenantId: admin.tenantId, name: "Shadow", generation: 1, digest: `sha256:${"c".repeat(64)}`, document: reservedDocument, createdAt: new Date().toISOString() },
          { actorPrincipalId: admin.principalId, action: "profile.created", data: {}, computerId: undefined as never },
        )).toThrow("reserved");
      }
      const accepted = await post({ id: "profile_custom_ok", name: "Fine", document: localVmProfile(32) }, "req_custom_ok");
      expect({ status: accepted.status, id: (await accepted.json() as { id: string }).id }).toEqual({ status: 201, id: "profile_custom_ok" });
    } finally { storage.close(); }
  });
});
