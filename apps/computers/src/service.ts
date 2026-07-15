import { AuthorizationEngine } from "./auth";
import {
  ComputersError,
  SANDBOX_DISABLED_CODE,
  type AuthorizationContext,
  type Computer,
  type ComputerCreateGrant,
  type ComputerStatus,
  type CreateComputerInput,
  type CreateComputerGrantInput,
  type ExecRequest,
  type InstallPlan,
  type InstallPolicyRevision,
  type InstallPolicyRule,
  type Operation,
  type OperationKind,
  type PackageSpec,
  type ProviderKind,
  type ProviderReadiness,
} from "./contracts";
import { InstallPolicyEngine, InstallTicketService, type InstallTicketSigningKeyProvider } from "./install-policy";
import { createProviderPorts, type ProviderPort } from "./providers";
import type { StoragePort } from "./storage";
import { makeId, sha256 } from "./storage";
import { assertExactKeys, validateArgv, validateId, validateIdempotencyKey, validateInstallPolicyRules, validateNonNegativeInteger, validatePackageSpec, validatePath, validatePositiveInteger, validateProvider, validateProviderConfinement, validateRegion, validateSlug, validateTimestamp } from "./validation";

export interface CoreServiceOptions {
  providers?: Record<ProviderKind, ProviderPort>;
  ticketSigningKeyProvider?: InstallTicketSigningKeyProvider;
}

export class ComputersService {
  readonly storage: StoragePort;
  readonly authorization = new AuthorizationEngine();
  readonly installPolicies = new InstallPolicyEngine();
  readonly tickets: InstallTicketService;
  readonly providers: Record<ProviderKind, ProviderPort>;

  constructor(storage: StoragePort, options: CoreServiceOptions = {}) {
    this.storage = storage;
    this.providers = options.providers ?? createProviderPorts();
    const signingKey = options.ticketSigningKeyProvider?.getKey() ?? storage.getOrCreateControllerKey("install_ticket_hmac_v1");
    this.tickets = new InstallTicketService(storage, signingKey);
  }

  createComputer(context: AuthorizationContext, raw: CreateComputerInput): Computer {
    const input = raw as unknown as Record<string, unknown>;
    assertExactKeys(input, ["id", "slug", "provider", "ownerPrincipalId", "parentComputerId", "grantId", "region", "profileId", "storageGiB", "uptimeSeconds", "budgetMicros", "idempotencyKey", "broadInternet"]);
    const provider = validateProvider(raw.provider);
    let parent: Computer | undefined;
    if (raw.parentComputerId !== undefined) {
      const parentId = validateId(raw.parentComputerId, "parentComputerId");
      parent = this.storage.getComputer(context.tenantId, parentId);
      if (parent === undefined) {
        if (!context.scopes.includes("computers:admin")) throw new ComputersError("authorization_denied", "Authorization denied", 403);
        throw new ComputersError("not_found", "Computer not found", 404);
      }
    }
    this.authorization.authorize(context, "computer:create", parent);
    const id = raw.id === undefined ? makeId("cmp") : validateId(raw.id, "id");
    const slug = validateSlug(raw.slug);
    const ownerPrincipalId = validateId(raw.ownerPrincipalId, "ownerPrincipalId");
    const idempotencyKey = validateIdempotencyKey(raw.idempotencyKey);
    const grantId = raw.grantId === undefined ? undefined : validateId(raw.grantId, "grantId");
    if (parent === undefined && !context.scopes.includes("computers:admin")) throw new ComputersError("authorization_denied", "Authorization denied", 403);
    const now = new Date().toISOString();
    const computer: Computer = {
      id, tenantId: context.tenantId, slug, provider,
      confinementClass: provider === "local_machine" ? "dedicated_machine" : "unverified_vm",
      status: "provisioning", ownerPrincipalId, policyGeneration: 1,
      dataExfiltrationProtection: raw.broadInternet === true ? false : false,
      createdAt: now, updatedAt: now,
    };
    validateProviderConfinement(computer.provider, computer.confinementClass);
    const region = raw.region === undefined ? "local" : validateRegion(raw.region);
    const profileId = raw.profileId === undefined ? "profile_default" : validateId(raw.profileId, "profileId");
    const storageGiB = raw.storageGiB === undefined ? 32 : validatePositiveInteger(raw.storageGiB, "storageGiB", 1_048_576);
    const uptimeSeconds = raw.uptimeSeconds === undefined ? 3600 : validatePositiveInteger(raw.uptimeSeconds, "uptimeSeconds", 31_536_000);
    const budgetMicros = raw.budgetMicros === undefined ? 0 : validateNonNegativeInteger(raw.budgetMicros, "budgetMicros", Number.MAX_SAFE_INTEGER);
    if (parent !== undefined && (raw.region === undefined || raw.profileId === undefined || raw.storageGiB === undefined || raw.uptimeSeconds === undefined || raw.budgetMicros === undefined)) {
      throw new ComputersError("invalid_request", "Delegated creation requires explicit grant-bounded resource fields", 400);
    }
    const record: Parameters<StoragePort["createComputer"]>[0] = { computer, requestingPrincipalId: context.principalId, idempotencyKey, requestHash: sha256({ ...raw, id: raw.id ?? null }) };
    if (parent !== undefined) record.parentComputerId = parent.id;
    if (grantId !== undefined) record.grantId = grantId;
    const operation = this.newOperation(computer, "create", idempotencyKey, { provider, confinementClass: computer.confinementClass, region, profileId, storageGiB, uptimeSeconds, budgetMicros });
    const policy = this.buildPolicy(context.tenantId, computer.id, 1, [{ effect: "deny" }]);
    return this.storage.createComputer(record, operation, policy, {
      actorPrincipalId: context.principalId, action: "computer.created", data: { provider, confinementClass: computer.confinementClass, operationId: operation.id }, computerId: computer.id,
    }).value;
  }

  createComputerGrant(context: AuthorizationContext, raw: CreateComputerGrantInput): ComputerCreateGrant {
    if (!context.scopes.includes("computers:admin")) throw new ComputersError("authorization_denied", "Authorization denied", 403);
    const input = raw as unknown as Record<string, unknown>;
    assertExactKeys(input, ["id", "principalId", "ownerPrincipalId", "parentComputerId", "allowedProviders", "allowedChildOwnerPrincipalIds", "allowedRegions", "allowedProfileIds", "maxStorageGiB", "maxUptimeSeconds", "maxBudgetMicros", "limit", "expiresAt"]);
    const parent = this.requireComputer(context.tenantId, validateId(raw.parentComputerId, "parentComputerId"));
    const principalId = validateId(raw.principalId, "principalId");
    const ownerPrincipalId = validateId(raw.ownerPrincipalId, "ownerPrincipalId");
    if (parent.ownerPrincipalId !== ownerPrincipalId || principalId !== ownerPrincipalId) throw new ComputersError("invalid_request", "Grant principal and owner must match the parent Computer owner", 400);
    if (!Array.isArray(raw.allowedProviders) || raw.allowedProviders.length < 1 || raw.allowedProviders.length > 3) throw new ComputersError("invalid_request", "Invalid allowed providers", 400);
    const providerOrder: ProviderKind[] = ["local_machine", "local_vm", "aws_ec2"];
    const allowedProviders = raw.allowedProviders.map(validateProvider).sort((left, right) => providerOrder.indexOf(left) - providerOrder.indexOf(right));
    if (new Set(allowedProviders).size !== allowedProviders.length) throw new ComputersError("invalid_request", "Invalid allowed providers", 400);
    const validateIds = (value: unknown, field: string, maximum: number): string[] => {
      if (!Array.isArray(value) || value.length < 1 || value.length > maximum) throw new ComputersError("invalid_request", `Invalid ${field}`, 400);
      const values = value.map((item) => validateId(item, field));
      if (new Set(values).size !== values.length) throw new ComputersError("invalid_request", `Invalid ${field}`, 400);
      return values.sort();
    };
    const allowedChildOwnerPrincipalIds = validateIds(raw.allowedChildOwnerPrincipalIds, "allowedChildOwnerPrincipalIds", 128);
    const allowedRegions = (() => {
      if (!Array.isArray(raw.allowedRegions) || raw.allowedRegions.length < 1 || raw.allowedRegions.length > 32) throw new ComputersError("invalid_request", "Invalid allowedRegions", 400);
      const values = raw.allowedRegions.map((item) => validateRegion(item, "allowedRegions"));
      if (new Set(values).size !== values.length) throw new ComputersError("invalid_request", "Invalid allowedRegions", 400);
      return values.sort();
    })();
    const allowedProfileIds = validateIds(raw.allowedProfileIds, "allowedProfileIds", 64);
    const maxStorageGiB = validatePositiveInteger(raw.maxStorageGiB, "maxStorageGiB", 1_048_576);
    const maxUptimeSeconds = validatePositiveInteger(raw.maxUptimeSeconds, "maxUptimeSeconds", 31_536_000);
    const maxBudgetMicros = validateNonNegativeInteger(raw.maxBudgetMicros, "maxBudgetMicros", Number.MAX_SAFE_INTEGER);
    if (!Number.isSafeInteger(raw.limit) || raw.limit < 1 || raw.limit > 1000) throw new ComputersError("invalid_request", "Invalid grant limit", 400);
    const now = new Date().toISOString();
    let expiresAt: string | undefined;
    if (raw.expiresAt !== undefined) {
      expiresAt = validateTimestamp(raw.expiresAt, "expiresAt");
      if (Date.parse(expiresAt) <= Date.parse(now)) throw new ComputersError("invalid_request", "Grant expiry must be in the future", 400);
    }
    const grant: ComputerCreateGrant = {
      id: raw.id === undefined ? makeId("grt") : validateId(raw.id, "id"), tenantId: context.tenantId, principalId,
      ownerPrincipalId, parentComputerId: parent.id, allowedProviders, allowedChildOwnerPrincipalIds, allowedRegions, allowedProfileIds,
      maxStorageGiB, maxUptimeSeconds, maxBudgetMicros, limit: raw.limit, active: true, generation: parent.policyGeneration,
      createdAt: now, updatedAt: now,
    };
    if (expiresAt !== undefined) grant.expiresAt = expiresAt;
    return this.storage.createComputerGrant(grant, {
      actorPrincipalId: context.principalId, action: "computer_create_grant.created", data: { grantId: grant.id, limit: grant.limit, allowedProviders }, computerId: parent.id,
    }).value;
  }

  listComputerGrants(context: AuthorizationContext): ComputerCreateGrant[] {
    if (!context.scopes.some((scope) => scope === "computers:read" || scope === "computers:create" || scope === "computers:admin")) throw new ComputersError("authorization_denied", "Authorization denied", 403);
    return this.storage.listComputerGrants(context.tenantId, context.scopes.includes("computers:admin") ? undefined : context.principalId);
  }

  listComputers(context: AuthorizationContext): Computer[] {
    return this.storage.listComputers(context.tenantId).filter((computer) => {
      try { this.authorization.authorize(context, "computer:read", computer); return true; } catch { return false; }
    });
  }

  getComputer(context: AuthorizationContext, id: string): Computer {
    const computer = this.requireComputer(context.tenantId, validateId(id));
    this.authorization.authorize(context, "computer:read", computer);
    return computer;
  }

  requestLifecycle(context: AuthorizationContext, computerId: string, kind: "start" | "stop" | "quarantine" | "delete", idempotencyKey: string): Operation {
    const computer = this.requireComputer(context.tenantId, validateId(computerId, "computerId"));
    this.authorization.authorize(context, kind === "delete" ? "computer:delete" : "computer:operate", computer);
    const allowed: Record<typeof kind, ComputerStatus[]> = {
      start: ["stopped"], stop: ["running"], quarantine: ["stopped", "running"], delete: ["stopped", "quarantined", "error"],
    };
    if (!allowed[kind].includes(computer.status)) throw new ComputersError("conflict", `Computer cannot ${kind} from ${computer.status}`, 409);
    const operation = this.newOperation(computer, kind, validateIdempotencyKey(idempotencyKey), {});
    const created = this.storage.createOperation(operation, {
      actorPrincipalId: context.principalId, action: `computer.${kind}.requested`, data: { operationId: operation.id }, computerId: computer.id,
    }).value;
    if (kind === "start") {
      const capability = this.storage.getHomeLeaseCapability(context.tenantId, computer.id);
      if (capability !== undefined) this.storage.setOperationHomeLease(created.id, capability);
    }
    return created;
  }

  requestExec(context: AuthorizationContext, computerId: string, raw: ExecRequest): Operation {
    const computer = this.requireComputer(context.tenantId, validateId(computerId, "computerId"));
    this.authorization.authorize(context, "exec:request", computer);
    const input = raw as unknown as Record<string, unknown>;
    assertExactKeys(input, ["argv", "cwd", "envNames", "timeoutSeconds", "idempotencyKey"]);
    const argv = validateArgv(raw.argv);
    const cwd = raw.cwd === undefined ? undefined : validatePath(raw.cwd, "cwd");
    const timeoutSeconds = raw.timeoutSeconds ?? 300;
    if (!Number.isSafeInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 3600) throw new ComputersError("invalid_request", "Invalid timeout", 400);
    const envNames = raw.envNames ?? [];
    if (!Array.isArray(envNames) || envNames.length > 128 || envNames.some((name) => typeof name !== "string" || !/^[A-Z_][A-Z0-9_]{0,127}$/.test(name))) throw new ComputersError("invalid_request", "Invalid environment variable names", 400);
    const request: Record<string, unknown> = { argv, envNames, timeoutSeconds };
    if (cwd !== undefined) request.cwd = cwd;
    const pending = this.newOperation(computer, "exec", validateIdempotencyKey(raw.idempotencyKey), request);
    return this.storage.createOperation(pending, {
      actorPrincipalId: context.principalId, action: "exec.requested", data: { operationId: pending.id, argv0: argv[0] }, computerId: computer.id,
    }).value;
  }

  installPlan(context: AuthorizationContext, computerId: string, rawSpec: unknown): InstallPlan & { ticket?: string } {
    const computer = this.requireComputer(context.tenantId, validateId(computerId, "computerId"));
    this.authorization.authorize(context, "install:plan", computer);
    const revision = this.requirePolicy(computer);
    const spec = validatePackageSpec(rawSpec);
    const plan = this.installPolicies.evaluate(revision, spec);
    if (plan.decision !== "allow") {
      this.storage.appendAudit(context.tenantId, context.principalId, "install.planned", { decision: plan.decision, specDigest: plan.specDigest }, computer.id);
      return plan;
    }
    return { ...plan, ticket: this.tickets.issue(context.tenantId, computer.id, revision, spec, {
      actorPrincipalId: context.principalId, action: "install.ticket_issued", data: { decision: plan.decision, specDigest: plan.specDigest }, computerId: computer.id,
    }) };
  }

  installApply(context: AuthorizationContext, computerId: string, ticket: string, idempotencyKey: string): Operation {
    const computer = this.requireComputer(context.tenantId, validateId(computerId, "computerId"));
    this.authorization.authorize(context, "install:apply", computer);
    const verified = this.tickets.verify(ticket, context.tenantId, computer.id);
    const operation = this.newOperation(computer, "install", validateIdempotencyKey(idempotencyKey), { ticketId: verified.claims.ticketId, spec: verified.claims.spec, specDigest: verified.claims.specDigest });
    return this.storage.consumeInstallTicketAndCreateOperation(verified.claims, verified.signature, new Date().toISOString(), operation, {
      actorPrincipalId: context.principalId, action: "install.apply_requested", data: { operationId: operation.id, specDigest: verified.claims.specDigest }, computerId: computer.id,
    }).value;
  }

  createInstallPolicy(context: AuthorizationContext, computerId: string, rules: InstallPolicyRule[]): InstallPolicyRevision {
    const computer = this.requireComputer(context.tenantId, validateId(computerId, "computerId"));
    this.authorization.authorize(context, "policy:write", computer);
    const validatedRules = validateInstallPolicyRules(rules);
    const generation = computer.policyGeneration + 1;
    const candidate = this.buildPolicy(context.tenantId, computer.id, generation, validatedRules);
    const revision = this.storage.createInstallPolicy(candidate, {
      actorPrincipalId: context.principalId, action: "install_policy.revision_created", data: { generation, digest: candidate.digest }, computerId: computer.id,
    });
    return revision;
  }

  listOperations(context: AuthorizationContext, computerId?: string): Operation[] {
    if (computerId !== undefined) this.getComputer(context, computerId);
    return this.storage.listOperations(context.tenantId, computerId).filter((operation) => {
      try { this.authorization.authorize(context, "computer:read", this.requireComputer(context.tenantId, operation.computerId)); return true; } catch { return false; }
    });
  }

  async providerReadiness(context: AuthorizationContext): Promise<ProviderReadiness[]> {
    if (!context.scopes.includes("computers:read") && !context.scopes.includes("computers:admin")) throw new ComputersError("authorization_denied", "Authorization denied", 403);
    return Promise.all(Object.values(this.providers).map((provider) => provider.readiness()));
  }

  sandboxDisabled(): never {
    throw new ComputersError(SANDBOX_DISABLED_CODE, "Sandbox integration is disabled", 501);
  }

  private requireComputer(tenantId: string, id: string): Computer {
    const computer = this.storage.getComputer(tenantId, id);
    if (computer === undefined) throw new ComputersError("not_found", "Computer not found", 404);
    return computer;
  }

  private requirePolicy(computer: Computer): InstallPolicyRevision {
    const revision = this.storage.getInstallPolicy(computer.tenantId, computer.id, computer.policyGeneration);
    if (revision === undefined) throw new ComputersError("storage_error", "Install policy is unavailable", 500);
    return revision;
  }

  private newOperation(computer: Computer, kind: OperationKind, idempotencyKey: string, request: Record<string, unknown>): Operation {
    const now = new Date().toISOString();
    const desired: Partial<Record<OperationKind, ComputerStatus>> = {
      create: "stopped", start: "running", stop: "stopped", quarantine: "quarantined", delete: "deleted",
    };
    const operation: Operation = {
      id: makeId("opn"), tenantId: computer.tenantId, computerId: computer.id, kind, status: "pending",
      policyGeneration: computer.policyGeneration, idempotencyKey, request, fence: 0, createdAt: now, updatedAt: now,
    };
    if (desired[kind] !== undefined) {
      operation.priorComputerStatus = computer.status;
      operation.desiredComputerStatus = desired[kind];
    }
    return operation;
  }

  private buildPolicy(tenantId: string, computerId: string, generation: number, rules: InstallPolicyRule[]): InstallPolicyRevision {
    const digest = sha256({ tenantId, computerId, generation, rules });
    return { id: makeId("pol"), tenantId, computerId, generation, digest, rules, createdAt: new Date().toISOString() };
  }
}
