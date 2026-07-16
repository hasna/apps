import { AuthorizationEngine, type AuthorizationAction } from "./auth";
import { types as utilTypes } from "node:util";
import {
  ComputersError,
  BUILTIN_LOCAL_MACHINE_PROFILE_DOCUMENT,
  RESERVED_PROFILE_IDS,
  SANDBOX_DISABLED_CODE,
  type AuthorizationContext,
  type AdoptComputerInput,
  type Computer,
  type ComputerCreateGrant,
  type ComputerStatus,
  type CreateComputerInput,
  type CreateComputerGrantInput,
  type CreateComputerProfileInput,
  type ComputerProfile,
  type ComputerProfileDocument,
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

const SERVICE_INPUT_MAX_DEPTH = 32;
const SERVICE_INPUT_MAX_NODES = 10_000;
const SERVICE_INPUT_MAX_BYTES = 1024 * 1024;
const SERVICE_INPUT_TEXT_ENCODER = new TextEncoder();

interface ServiceInputSnapshotState {
  readonly active: Set<object>;
  nodes: number;
  bytes: number;
  objectPrototypeChecked: boolean;
  arrayPrototypeChecked: boolean;
}

function rejectServiceInput(reason: string, tooLarge = false): never {
  throw new ComputersError(
    tooLarge ? "request_too_large" : "invalid_request",
    tooLarge ? "Request body is too large" : "Invalid request body",
    tooLarge ? 413 : 400,
    { reason },
  );
}

function addServiceInputBytes(state: ServiceInputSnapshotState, bytes: number): void {
  state.bytes += bytes;
  if (state.bytes > SERVICE_INPUT_MAX_BYTES) rejectServiceInput("input is too large", true);
}

function countServiceInputJsonString(state: ServiceInputSnapshotState, value: string): void {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) rejectServiceInput("strings must be JSON-safe");
  addServiceInputBytes(state, SERVICE_INPUT_TEXT_ENCODER.encode(encoded).byteLength);
}

function hasEnumerableOwnProperty(value: object): boolean {
  const descriptors = Object.getOwnPropertyDescriptors(value) as Record<PropertyKey, PropertyDescriptor>;
  return Reflect.ownKeys(descriptors).some((key) => descriptors[key]?.enumerable === true);
}

function assertServiceInputPrototypeIsClean(state: ServiceInputSnapshotState, array: boolean): void {
  if (!state.objectPrototypeChecked) {
    if (Object.getPrototypeOf(Object.prototype) !== null) rejectServiceInput("custom prototypes are not allowed");
    if (hasEnumerableOwnProperty(Object.prototype)) rejectServiceInput("inherited enumerable properties are not allowed");
    state.objectPrototypeChecked = true;
  }
  if (array && !state.arrayPrototypeChecked) {
    if (Object.getPrototypeOf(Array.prototype) !== Object.prototype) rejectServiceInput("custom prototypes are not allowed");
    if (hasEnumerableOwnProperty(Array.prototype)) rejectServiceInput("inherited enumerable properties are not allowed");
    state.arrayPrototypeChecked = true;
  }
}

function snapshotServiceInputValue(value: unknown, state: ServiceInputSnapshotState, depth: number): unknown {
  if (depth > SERVICE_INPUT_MAX_DEPTH) rejectServiceInput("input nesting is too deep");
  state.nodes += 1;
  if (state.nodes > SERVICE_INPUT_MAX_NODES) rejectServiceInput("input is too large", true);

  if (value === null) {
    addServiceInputBytes(state, 4);
    return null;
  }
  switch (typeof value) {
    case "string":
      countServiceInputJsonString(state, value);
      return value;
    case "number":
      if (!Number.isFinite(value)) rejectServiceInput("non-finite numbers are not JSON-safe");
      addServiceInputBytes(state, JSON.stringify(value).length);
      return value;
    case "boolean":
      addServiceInputBytes(state, value ? 4 : 5);
      return value;
    case "undefined":
      rejectServiceInput("undefined is not JSON-safe");
    case "function":
      rejectServiceInput("functions are not JSON-safe");
    case "bigint":
      rejectServiceInput("bigints are not JSON-safe");
    case "symbol":
      rejectServiceInput("symbols are not JSON-safe");
    case "object":
      break;
  }

  if (utilTypes.isProxy(value)) rejectServiceInput("proxies are not allowed");
  if (state.active.has(value)) rejectServiceInput("cycles are not allowed");

  const array = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value) as object | null;
  if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
    rejectServiceInput("custom prototypes are not allowed");
  }
  if (array || prototype === Object.prototype) assertServiceInputPrototypeIsClean(state, array);

  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key === "symbol")) rejectServiceInput("symbol properties are not allowed");
  state.active.add(value);
  try {
    if (array) {
      const length = value.length;
      if (!Number.isSafeInteger(length) || length > SERVICE_INPUT_MAX_NODES) rejectServiceInput("input is too large", true);
      if (keys.length !== length + 1 || !Object.hasOwn(descriptors, "length")) {
        rejectServiceInput("sparse arrays are not allowed");
      }
      const output: unknown[] = [];
      addServiceInputBytes(state, 1);
      for (let index = 0; index < length; index += 1) {
        const key = String(index);
        if (!Object.hasOwn(descriptors, key)) rejectServiceInput("sparse arrays are not allowed");
        const descriptor = descriptors[key];
        if (descriptor === undefined) rejectServiceInput("sparse arrays are not allowed");
        if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value")) rejectServiceInput("accessors are not allowed");
        if (index > 0) addServiceInputBytes(state, 1);
        Object.defineProperty(output, key, {
          configurable: true,
          enumerable: true,
          value: snapshotServiceInputValue(descriptor.value, state, depth + 1),
          writable: true,
        });
      }
      addServiceInputBytes(state, 1);
      return Object.freeze(output);
    }

    const output = Object.create(null) as Record<string, unknown>;
    addServiceInputBytes(state, 1);
    for (const [index, key] of (keys as string[]).entries()) {
      const descriptor = descriptors[key];
      if (descriptor === undefined || !Object.hasOwn(descriptor, "value")) rejectServiceInput("accessors are not allowed");
      if (!descriptor.enumerable) rejectServiceInput("non-enumerable properties are not allowed");
      if (index > 0) addServiceInputBytes(state, 1);
      countServiceInputJsonString(state, key);
      addServiceInputBytes(state, 1);
      output[key] = snapshotServiceInputValue(descriptor.value, state, depth + 1);
    }
    addServiceInputBytes(state, 1);
    return Object.freeze(output);
  } finally {
    state.active.delete(value);
  }
}

function snapshotServiceInput<T>(value: T): T {
  return snapshotServiceInputValue(value, {
    active: new Set(), nodes: 0, bytes: 0, objectPrototypeChecked: false, arrayPrototypeChecked: false,
  }, 0) as T;
}

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
    const input = snapshotServiceInput(raw);
    assertExactKeys(input as unknown as Record<string, unknown>, ["id", "slug", "provider", "ownerPrincipalId", "parentComputerId", "grantId", "region", "profileId", "storageGiB", "uptimeSeconds", "budgetMicros", "idempotencyKey", "broadInternet"]);
    const provider = validateProvider(input.provider);
    let parent: Computer | undefined;
    if (input.parentComputerId !== undefined) {
      const parentId = validateId(input.parentComputerId, "parentComputerId");
      parent = this.resolveComputer(context, parentId, "computer:create");
    }
    if (parent === undefined) this.authorization.authorize(context, "computer:create");
    const id = input.id === undefined ? makeId("cmp") : validateId(input.id, "id");
    const slug = validateSlug(input.slug);
    const ownerPrincipalId = validateId(input.ownerPrincipalId, "ownerPrincipalId");
    const idempotencyKey = validateIdempotencyKey(input.idempotencyKey);
    const grantId = input.grantId === undefined ? undefined : validateId(input.grantId, "grantId");
    if (parent === undefined && !context.scopes.includes("computers:admin")) throw new ComputersError("authorization_denied", "Authorization denied", 403);
    const now = new Date().toISOString();
    const computer: Computer = {
      id, tenantId: context.tenantId, slug, provider,
      confinementClass: provider === "local_machine" ? "dedicated_machine" : "unverified_vm",
      status: "provisioning", ownerPrincipalId, policyGeneration: 1,
      dataExfiltrationProtection: input.broadInternet === true ? false : false,
      createdAt: now, updatedAt: now,
    };
    validateProviderConfinement(computer.provider, computer.confinementClass);
    const region = input.region === undefined ? "local" : validateRegion(input.region);
    const profileId = input.profileId === undefined ? "profile_default" : validateId(input.profileId, "profileId");
    const storageGiB = input.storageGiB === undefined ? 32 : validatePositiveInteger(input.storageGiB, "storageGiB", 1_048_576);
    const uptimeSeconds = input.uptimeSeconds === undefined ? 3600 : validatePositiveInteger(input.uptimeSeconds, "uptimeSeconds", 31_536_000);
    const budgetMicros = input.budgetMicros === undefined ? 0 : validateNonNegativeInteger(input.budgetMicros, "budgetMicros", Number.MAX_SAFE_INTEGER);
    if (parent !== undefined && (input.region === undefined || input.profileId === undefined || input.storageGiB === undefined || input.uptimeSeconds === undefined || input.budgetMicros === undefined)) {
      throw new ComputersError("invalid_request", "Delegated creation requires explicit grant-bounded resource fields", 400);
    }
    if (parent !== undefined && !context.scopes.includes("computers:admin")) {
      const grant = grantId === undefined ? undefined : this.storage.getComputerGrant(context.tenantId, grantId);
      const expiresAt = grant?.expiresAt === undefined ? undefined : Date.parse(grant.expiresAt);
      if (grant === undefined || !grant.active || parent.status === "deleted" || parent.status === "deleting"
        || grant.parentComputerId !== parent.id || grant.principalId !== context.principalId || grant.ownerPrincipalId !== parent.ownerPrincipalId
        || grant.generation !== parent.policyGeneration || (expiresAt !== undefined && (!Number.isFinite(expiresAt) || expiresAt <= Date.parse(now)))
        || !grant.allowedProviders.includes(provider) || !grant.allowedProfileIds.includes(profileId)
        || !grant.allowedChildOwnerPrincipalIds.includes(ownerPrincipalId) || !grant.allowedRegions.includes(region)
        || storageGiB > grant.maxStorageGiB || uptimeSeconds > grant.maxUptimeSeconds || budgetMicros > grant.maxBudgetMicros) {
        throw new ComputersError("authorization_denied", "Authorization denied", 403);
      }
    }
    // aws_ec2 has no configured provider adapter and no aws profile document in this release. Rather
    // than fabricate a local profile, fail truthfully with provider_not_configured so the advertised
    // provider reaches its (unconfigured) provider path instead of a misleading local-profile error.
    if (provider === "aws_ec2") throw new ComputersError("provider_not_configured", "AWS EC2 provider is not configured", 503);
    const profile = this.resolveProfile(context.tenantId, profileId, provider);
    // Truthful invariant: the quota-charged storageGiB must cover the home disk the provider will
    // actually provision (Lima provisions profile.homeDiskGiB). Without this a grant-bounded request
    // could declare a small storageGiB (<= grant.maxStorageGiB) yet select a large-home profile,
    // provisioning more than was authorized. Enforced before any persistence or provider mutation.
    if (profile.document.provider === "local_vm" && storageGiB < profile.document.homeDiskGiB) {
      throw new ComputersError("invalid_request", "Requested storageGiB must cover the bound profile home disk", 400, { field: "storageGiB", reason: "below_profile_home_disk" });
    }
    const record: Parameters<StoragePort["createComputer"]>[0] = { computer, requestingPrincipalId: context.principalId, idempotencyKey, requestHash: sha256({ ...input, id: input.id ?? null }) };
    if (parent !== undefined) record.parentComputerId = parent.id;
    if (grantId !== undefined) record.grantId = grantId;
    const operation = this.newOperation(computer, "create", idempotencyKey, { provider, confinementClass: computer.confinementClass, region, profileId,
      profile: { id: profile.id, generation: profile.generation, digest: profile.digest, document: profile.document }, storageGiB, uptimeSeconds, budgetMicros });
    const policy = this.buildPolicy(context.tenantId, computer.id, 1, [{ effect: "deny" }]);
    return this.storage.createComputer(record, operation, policy, {
      actorPrincipalId: context.principalId, action: "computer.created", data: { provider, confinementClass: computer.confinementClass, operationId: operation.id }, computerId: computer.id,
    }).value;
  }

  adoptComputer(context: AuthorizationContext, raw: AdoptComputerInput): Computer {
    const input = snapshotServiceInput(raw);
    if (!context.scopes.includes("computers:admin")) throw new ComputersError("authorization_denied", "Authorization denied", 403);
    assertExactKeys(input as unknown as Record<string, unknown>, ["id", "slug", "ownerPrincipalId", "adoptionId", "profileId", "idempotencyKey"]);
    const id = input.id === undefined ? makeId("cmp") : validateId(input.id, "id");
    const ownerPrincipalId = validateId(input.ownerPrincipalId, "ownerPrincipalId");
    const adoptionId = validateId(input.adoptionId, "adoptionId");
    const profileId = input.profileId === undefined ? "profile_adopted" : validateId(input.profileId, "profileId");
    const profile = this.resolveProfile(context.tenantId, profileId, "local_machine");
    const idempotencyKey = validateIdempotencyKey(input.idempotencyKey); const now = new Date().toISOString();
    const computer: Computer = { id, tenantId: context.tenantId, slug: validateSlug(input.slug), provider: "local_machine", confinementClass: "dedicated_machine",
      status: "provisioning", ownerPrincipalId, policyGeneration: 1, dataExfiltrationProtection: false, createdAt: now, updatedAt: now };
    const operation = this.newOperation(computer, "create", idempotencyKey, { provider: "local_machine", confinementClass: "dedicated_machine", region: "local", profileId,
      profile: { id: profile.id, generation: profile.generation, digest: profile.digest, document: profile.document },
      storageGiB: 1, uptimeSeconds: 31_536_000, budgetMicros: 0, adoption: { adoptionId } });
    operation.desiredComputerStatus = "running";
    const policy = this.buildPolicy(context.tenantId, computer.id, 1, [{ effect: "deny" }]);
    return this.storage.createComputer({ computer, requestingPrincipalId: context.principalId, idempotencyKey, requestHash: sha256({ ...input, id: input.id ?? null, operation: "adopt" }) }, operation, policy,
      { actorPrincipalId: context.principalId, action: "computer.adoption_requested", data: { adoptionId, operationId: operation.id }, computerId: computer.id }).value;
  }

  createProfile(context: AuthorizationContext, raw: CreateComputerProfileInput): ComputerProfile {
    const input = snapshotServiceInput(raw);
    if (!context.scopes.includes("computers:admin")) throw new ComputersError("authorization_denied", "Authorization denied", 403);
    assertExactKeys(input as unknown as Record<string, unknown>, ["id", "name", "document"]);
    const id = validateId(input.id, "id");
    if (RESERVED_PROFILE_IDS.includes(id)) throw new ComputersError("invalid_request", "Profile id is reserved for a built-in profile", 400, { field: "id", reason: "reserved" });
    const document = this.validateProfileDocument(input.document); const name = typeof input.name === "string" && /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$/.test(input.name) ? input.name : undefined;
    if (name === undefined) throw new ComputersError("invalid_request", "Invalid profile name", 400);
    const now = new Date().toISOString(); const profile: ComputerProfile = { id, tenantId: context.tenantId,
      name, generation: 1, digest: sha256(document), document, createdAt: now };
    return this.storage.createProfile(profile, { actorPrincipalId: context.principalId, action: "profile.created", data: { profileId: profile.id, digest: profile.digest } }).value;
  }

  listProfiles(context: AuthorizationContext): ComputerProfile[] {
    if (!context.scopes.some((scope) => scope === "computers:read" || scope === "computers:admin")) throw new ComputersError("authorization_denied", "Authorization denied", 403);
    return this.storage.listProfiles(context.tenantId);
  }

  createComputerGrant(context: AuthorizationContext, raw: CreateComputerGrantInput): ComputerCreateGrant {
    const input = snapshotServiceInput(raw);
    if (!context.scopes.includes("computers:admin")) throw new ComputersError("authorization_denied", "Authorization denied", 403);
    assertExactKeys(input as unknown as Record<string, unknown>, ["id", "principalId", "ownerPrincipalId", "parentComputerId", "allowedProviders", "allowedChildOwnerPrincipalIds", "allowedRegions", "allowedProfileIds", "maxStorageGiB", "maxUptimeSeconds", "maxBudgetMicros", "limit", "expiresAt"]);
    const parent = this.resolveComputer(context, validateId(input.parentComputerId, "parentComputerId"), "computer:read");
    const principalId = validateId(input.principalId, "principalId");
    const ownerPrincipalId = validateId(input.ownerPrincipalId, "ownerPrincipalId");
    if (parent.ownerPrincipalId !== ownerPrincipalId || principalId !== ownerPrincipalId) throw new ComputersError("invalid_request", "Grant principal and owner must match the parent Computer owner", 400);
    if (!Array.isArray(input.allowedProviders) || input.allowedProviders.length < 1 || input.allowedProviders.length > 3) throw new ComputersError("invalid_request", "Invalid allowed providers", 400);
    const providerOrder: ProviderKind[] = ["local_machine", "local_vm", "aws_ec2"];
    const allowedProviders = input.allowedProviders.map(validateProvider).sort((left, right) => providerOrder.indexOf(left) - providerOrder.indexOf(right));
    if (new Set(allowedProviders).size !== allowedProviders.length) throw new ComputersError("invalid_request", "Invalid allowed providers", 400);
    const validateIds = (value: unknown, field: string, maximum: number): string[] => {
      if (!Array.isArray(value) || value.length < 1 || value.length > maximum) throw new ComputersError("invalid_request", `Invalid ${field}`, 400);
      const values = value.map((item) => validateId(item, field));
      if (new Set(values).size !== values.length) throw new ComputersError("invalid_request", `Invalid ${field}`, 400);
      return values.sort();
    };
    const allowedChildOwnerPrincipalIds = validateIds(input.allowedChildOwnerPrincipalIds, "allowedChildOwnerPrincipalIds", 128);
    const allowedRegions = (() => {
      if (!Array.isArray(input.allowedRegions) || input.allowedRegions.length < 1 || input.allowedRegions.length > 32) throw new ComputersError("invalid_request", "Invalid allowedRegions", 400);
      const values = input.allowedRegions.map((item) => validateRegion(item, "allowedRegions"));
      if (new Set(values).size !== values.length) throw new ComputersError("invalid_request", "Invalid allowedRegions", 400);
      return values.sort();
    })();
    const allowedProfileIds = validateIds(input.allowedProfileIds, "allowedProfileIds", 64);
    const maxStorageGiB = validatePositiveInteger(input.maxStorageGiB, "maxStorageGiB", 1_048_576);
    const maxUptimeSeconds = validatePositiveInteger(input.maxUptimeSeconds, "maxUptimeSeconds", 31_536_000);
    const maxBudgetMicros = validateNonNegativeInteger(input.maxBudgetMicros, "maxBudgetMicros", Number.MAX_SAFE_INTEGER);
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 1000) throw new ComputersError("invalid_request", "Invalid grant limit", 400);
    const now = new Date().toISOString();
    let expiresAt: string | undefined;
    if (input.expiresAt !== undefined) {
      expiresAt = validateTimestamp(input.expiresAt, "expiresAt");
      if (Date.parse(expiresAt) <= Date.parse(now)) throw new ComputersError("invalid_request", "Grant expiry must be in the future", 400);
    }
    const grant: ComputerCreateGrant = {
      id: input.id === undefined ? makeId("grt") : validateId(input.id, "id"), tenantId: context.tenantId, principalId,
      ownerPrincipalId, parentComputerId: parent.id, allowedProviders, allowedChildOwnerPrincipalIds, allowedRegions, allowedProfileIds,
      maxStorageGiB, maxUptimeSeconds, maxBudgetMicros, limit: input.limit, active: true, generation: parent.policyGeneration,
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
    return this.resolveComputer(context, validateId(id), "computer:read");
  }

  requestLifecycle(context: AuthorizationContext, computerId: string, kind: "start" | "stop" | "quarantine" | "delete", idempotencyKey: string): Operation {
    const computer = this.resolveComputer(context, validateId(computerId, "computerId"), kind === "delete" ? "computer:delete" : "computer:operate");
    const allowed: Record<typeof kind, ComputerStatus[]> = {
      start: ["stopped"], stop: ["running"], quarantine: ["stopped", "running"], delete: ["stopped", "quarantined", "error"],
    };
    const operation = this.newOperation(computer, kind, validateIdempotencyKey(idempotencyKey), {});
    return this.storage.createLifecycleOperation(operation, allowed[kind], {
      actorPrincipalId: context.principalId, action: `computer.${kind}.requested`, data: { operationId: operation.id }, computerId: computer.id,
    }).value;
  }

  requestExec(context: AuthorizationContext, computerId: string, raw: ExecRequest): Operation {
    const input = snapshotServiceInput(raw);
    const computer = this.resolveComputer(context, validateId(computerId, "computerId"), "exec:request");
    assertExactKeys(input as unknown as Record<string, unknown>, ["argv", "cwd", "envNames", "timeoutSeconds", "idempotencyKey"]);
    const argv = validateArgv(input.argv);
    const cwd = input.cwd === undefined ? undefined : validatePath(input.cwd, "cwd");
    const timeoutSeconds = input.timeoutSeconds ?? 300;
    if (!Number.isSafeInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 3600) throw new ComputersError("invalid_request", "Invalid timeout", 400);
    const envNames = input.envNames ?? [];
    if (!Array.isArray(envNames) || envNames.length > 128 || envNames.some((name) => typeof name !== "string" || !/^[A-Z_][A-Z0-9_]{0,127}$/.test(name))) throw new ComputersError("invalid_request", "Invalid environment variable names", 400);
    const request: Record<string, unknown> = { argv, envNames, timeoutSeconds };
    if (cwd !== undefined) request.cwd = cwd;
    const pending = this.newOperation(computer, "exec", validateIdempotencyKey(input.idempotencyKey), request);
    return this.storage.createOperation(pending, {
      actorPrincipalId: context.principalId, action: "exec.requested", data: { operationId: pending.id, argv0: argv[0] }, computerId: computer.id,
    }).value;
  }

  installPlan(context: AuthorizationContext, computerId: string, rawSpec: unknown): InstallPlan & { ticket?: string } {
    const input = snapshotServiceInput(rawSpec);
    const computer = this.resolveComputer(context, validateId(computerId, "computerId"), "install:plan");
    const revision = this.requirePolicy(computer);
    const spec = validatePackageSpec(input);
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
    const computer = this.resolveComputer(context, validateId(computerId, "computerId"), "install:apply");
    const verified = this.tickets.verify(ticket, context.tenantId, computer.id);
    const operation = this.newOperation(computer, "install", validateIdempotencyKey(idempotencyKey), { ticketId: verified.claims.ticketId, spec: verified.claims.spec, specDigest: verified.claims.specDigest });
    return this.storage.consumeInstallTicketAndCreateOperation(verified.claims, verified.signature, new Date().toISOString(), operation, {
      actorPrincipalId: context.principalId, action: "install.apply_requested", data: { operationId: operation.id, specDigest: verified.claims.specDigest }, computerId: computer.id,
    }).value;
  }

  getInstallPolicy(context: AuthorizationContext, computerId: string): InstallPolicyRevision {
    const computer = this.resolveComputer(context, validateId(computerId, "computerId"), "computer:read");
    return this.requirePolicy(computer);
  }

  createInstallPolicy(context: AuthorizationContext, computerId: string, rules: InstallPolicyRule[]): InstallPolicyRevision {
    const input = snapshotServiceInput(rules);
    const computer = this.resolveComputer(context, validateId(computerId, "computerId"), "policy:write");
    const validatedRules = validateInstallPolicyRules(input);
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
      try { this.resolveComputer(context, operation.computerId, "computer:read"); return true; } catch { return false; }
    });
  }

  async providerReadiness(context: AuthorizationContext): Promise<ProviderReadiness[]> {
    if (!context.scopes.includes("computers:read") && !context.scopes.includes("computers:admin")) throw new ComputersError("authorization_denied", "Authorization denied", 403);
    return Promise.all(Object.values(this.providers).map((provider) => provider.readiness()));
  }

  sandboxDisabled(): never {
    throw new ComputersError(SANDBOX_DISABLED_CODE, "Sandbox integration is disabled", 501);
  }

  private resolveComputer(context: AuthorizationContext, id: string, action: AuthorizationAction): Computer {
    this.authorization.authorize(context, action);
    const computer = this.storage.getComputer(context.tenantId, id);
    if (computer === undefined) throw new ComputersError("not_found", "Computer not found", 404);
    const admin = context.scopes.includes("computers:admin");
    if ((!admin && context.principalId !== computer.ownerPrincipalId)
      || (context.boundComputerId !== undefined && context.boundComputerId !== computer.id)) {
      throw new ComputersError("not_found", "Computer not found", 404);
    }
    this.authorization.authorize(context, action, computer);
    return computer;
  }

  private requirePolicy(computer: Computer): InstallPolicyRevision {
    const revision = this.storage.getInstallPolicy(computer.tenantId, computer.id, computer.policyGeneration);
    if (revision === undefined) throw new ComputersError("storage_error", "Install policy is unavailable", 500);
    return revision;
  }

  private validateProfileDocument(raw: ComputerProfileDocument): ComputerProfileDocument {
    const value = raw as unknown as Record<string, unknown>;
    assertExactKeys(value, ["provider", "cpus", "memoryGiB", "rootDiskGiB", "homeDiskGiB", "imageLocation", "imageDigest"]);
    if (raw.provider !== "local_machine" && raw.provider !== "local_vm") throw new ComputersError("invalid_request", "Invalid profile provider", 400);
    const cpus = validatePositiveInteger(raw.cpus, "cpus", 64); const memoryGiB = validatePositiveInteger(raw.memoryGiB, "memoryGiB", 256);
    const rootDiskGiB = validatePositiveInteger(raw.rootDiskGiB, "rootDiskGiB", 4096); const homeDiskGiB = validatePositiveInteger(raw.homeDiskGiB, "homeDiskGiB", 4096);
    if (rootDiskGiB < 8) throw new ComputersError("invalid_request", "Invalid rootDiskGiB", 400);
    const document: ComputerProfileDocument = { provider: raw.provider, cpus, memoryGiB, rootDiskGiB, homeDiskGiB };
    if (raw.provider === "local_vm") {
      if (typeof raw.imageLocation !== "string" || raw.imageLocation.length < 1 || raw.imageLocation.length > 2048) throw new ComputersError("invalid_request", "Invalid profile image", 400);
      let location: URL; try { location = new URL(String(raw.imageLocation)); } catch { throw new ComputersError("invalid_request", "Invalid profile image", 400); }
      if (location.protocol !== "https:" || location.username || location.password || location.toString().length > 2048
        || typeof raw.imageDigest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(raw.imageDigest)) throw new ComputersError("invalid_request", "Invalid profile image", 400);
      document.imageLocation = location.toString(); document.imageDigest = raw.imageDigest;
    } else if (raw.imageLocation !== undefined || raw.imageDigest !== undefined) throw new ComputersError("invalid_request", "Adopted-machine profiles cannot define VM images", 400);
    if (Buffer.byteLength(JSON.stringify(document)) > 4096) throw new ComputersError("invalid_request", "Profile document is too large", 400);
    return document;
  }

  private resolveProfile(tenantId: string, profileId: string, provider: ProviderKind): ComputerProfile {
    if (RESERVED_PROFILE_IDS.includes(profileId)) {
      if (provider !== "local_machine") throw new ComputersError("invalid_request", "Local VM creation requires an explicit tenant profile", 400);
      const document = { ...BUILTIN_LOCAL_MACHINE_PROFILE_DOCUMENT } as ComputerProfileDocument;
      return { id: profileId, tenantId, name: "Built-in adopted machine", generation: 1, digest: sha256(document), document, createdAt: "1970-01-01T00:00:00.000Z" };
    }
    const profile = this.storage.getProfile(tenantId, profileId);
    if (profile === undefined) throw new ComputersError("invalid_request", "Computer profile is not available", 400);
    if (profile.document.provider !== provider) throw new ComputersError("invalid_request", "Computer profile provider does not match", 400);
    return profile;
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
