export const PACKAGE_NAME = "@hasna/computers";
export const VERSION = "0.1.0";
export const API_VERSION = "v1";
export const SANDBOX_DISABLED_CODE = "sandbox_disabled";
export const ALL_SCOPES = [
  "computers:read", "computers:create", "computers:operate", "computers:exec", "computers:install",
  "computers:snapshot", "computers:assign", "computers:policy", "computers:admin",
] as const;

export type ProviderKind = "local_machine" | "local_vm" | "aws_ec2";
export type ConfinementClass = "dedicated_machine" | "unverified_vm" | "strict_vm";
export type ComputerStatus =
  | "provisioning"
  | "stopped"
  | "running"
  | "quarantined"
  | "deleting"
  | "deleted"
  | "error";
export type OperationKind =
  | "create"
  | "start"
  | "stop"
  | "quarantine"
  | "delete"
  | "exec"
  | "install"
  | "snapshot"
  | "restore";
export type OperationStatus = "pending" | "accepted" | "running" | "unknown" | "succeeded" | "failed" | "cancelled";
export type Scope = (typeof ALL_SCOPES)[number];

export interface Computer {
  id: string;
  tenantId: string;
  slug: string;
  provider: ProviderKind;
  confinementClass: ConfinementClass;
  status: ComputerStatus;
  ownerPrincipalId: string;
  policyGeneration: number;
  dataExfiltrationProtection: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateComputerInput {
  id?: string;
  slug: string;
  provider: ProviderKind;
  ownerPrincipalId: string;
  parentComputerId?: string;
  grantId?: string;
  region?: string;
  profileId?: string;
  storageGiB?: number;
  uptimeSeconds?: number;
  budgetMicros?: number;
  idempotencyKey: string;
  broadInternet?: boolean;
}

export interface AdoptComputerInput {
  id?: string;
  slug: string;
  ownerPrincipalId: string;
  adoptionId: string;
  profileId?: string;
  idempotencyKey: string;
}

export interface ComputerProfile {
  id: string;
  tenantId: string;
  name: string;
  generation: number;
  digest: string;
  document: ComputerProfileDocument;
  createdAt: string;
}

export interface CreateComputerProfileInput {
  id: string;
  name: string;
  document: ComputerProfileDocument;
}

export interface ComputerProfileDocument {
  provider: "local_machine" | "local_vm";
  cpus: number;
  memoryGiB: number;
  rootDiskGiB: number;
  homeDiskGiB: number;
  imageLocation?: string;
  imageDigest?: string;
}

export const BUILTIN_LOCAL_MACHINE_PROFILE_DOCUMENT: Readonly<ComputerProfileDocument> = Object.freeze({
  provider: "local_machine", cpus: 4, memoryGiB: 8, rootDiskGiB: 32, homeDiskGiB: 32,
});

// Built-in profile identifiers the service resolves to synthetic documents. Tenants must not be
// able to shadow or redefine them via profile creation, so both the service and storage reject
// these ids at creation time. Keep this list in sync with resolveProfile's short-circuit branch.
export const RESERVED_PROFILE_IDS = Object.freeze(["profile_default", "profile_adopted"]) as readonly string[];

export interface ComputerVolume {
  id: string;
  tenantId: string;
  computerId: string;
  kind: "root" | "home";
  providerRef?: string;
  fence: number;
  state: "pending" | "attached" | "detached" | "quarantined" | "deleted" | "error";
  createdAt: string;
  updatedAt: string;
}

export interface ComputerCreateGrant {
  id: string;
  tenantId: string;
  principalId: string;
  ownerPrincipalId: string;
  parentComputerId: string;
  allowedProviders: ProviderKind[];
  allowedChildOwnerPrincipalIds: string[];
  allowedRegions: string[];
  allowedProfileIds: string[];
  maxStorageGiB: number;
  maxUptimeSeconds: number;
  maxBudgetMicros: number;
  limit: number;
  active: boolean;
  generation: number;
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateComputerGrantInput {
  id?: string;
  principalId: string;
  ownerPrincipalId: string;
  parentComputerId: string;
  allowedProviders: ProviderKind[];
  allowedChildOwnerPrincipalIds: string[];
  allowedRegions: string[];
  allowedProfileIds: string[];
  maxStorageGiB: number;
  maxUptimeSeconds: number;
  maxBudgetMicros: number;
  limit: number;
  expiresAt?: string;
}

export interface Operation {
  id: string;
  tenantId: string;
  computerId: string;
  kind: OperationKind;
  status: OperationStatus;
  policyGeneration: number;
  idempotencyKey: string;
  request: Record<string, unknown>;
  priorComputerStatus?: ComputerStatus;
  desiredComputerStatus?: ComputerStatus;
  result?: Record<string, unknown>;
  errorCode?: string;
  fence: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderResourceIdentity {
  resourceId: string;
  instanceId?: string;
  bootId?: string;
}

export type ProviderOutcome =
  | { kind: "success"; resource: ProviderResourceIdentity; result: Record<string, unknown> }
  | { kind: "definite_failure"; code: string; message: string; resource?: ProviderResourceIdentity }
  | { kind: "unknown"; providerOperationId: string; message: string; resource?: ProviderResourceIdentity };

export interface ProviderAssuranceEvidence {
  confinementClass: ConfinementClass;
  providerSpecificControlsPassed: boolean;
  externalEgressEnforced: boolean;
  residentIndependentIsolation: boolean;
  hostMounts: boolean;
  hostSockets: boolean;
  portForwards: boolean;
  containerd: boolean;
  networkPolicyId?: string;
}

export interface ProviderAssuranceRecord extends ProviderAssuranceEvidence {
  tenantId: string;
  computerId: string;
  provider: ProviderKind;
  operationId: string;
  attemptId: string;
  bindingFence: number;
  generation: number;
  verifiedAt: string;
}

export interface ProviderAttempt {
  id: string;
  tenantId: string;
  operationId: string;
  attemptNumber: number;
  providerIdempotencyKey: string;
  providerOperationId?: string;
  resource?: ProviderResourceIdentity;
  status: "running" | "unknown" | "succeeded" | "failed";
  fence: number;
  executionOwnerToken?: string;
  executionOwnerGeneration: number;
  executionOwnerExpiresAt?: string;
  startedAt: string;
  completedAt?: string;
}

export interface ProviderBinding {
  tenantId: string;
  computerId: string;
  provider: ProviderKind;
  resource: ProviderResourceIdentity;
  operationId: string;
  attemptId: string;
  state: "unknown" | "active" | "released";
  fence: number;
  updatedAt: string;
}

export interface ExecRequest {
  argv: string[];
  cwd?: string;
  envNames?: string[];
  timeoutSeconds?: number;
  idempotencyKey: string;
}

export type PackageManagerKind = "apt" | "dnf" | "apk" | "brew" | "npm" | "bun";

export interface PackageSpec {
  manager: PackageManagerKind;
  name: string;
  version: string;
  digest: string;
  registry: string;
  dependencyClosure: Array<{ name: string; version: string; digest: string }>;
  allowLifecycleScripts: boolean;
}

export interface InstallPolicyRule {
  effect: "allow" | "deny" | "approval_required";
  managers?: PackageManagerKind[];
  packagePatterns?: string[];
  registries?: string[];
  lifecycleScripts?: boolean;
}

export interface InstallPolicyRevision {
  id: string;
  tenantId: string;
  computerId: string;
  generation: number;
  digest: string;
  rules: InstallPolicyRule[];
  createdAt: string;
}

export interface InstallPlan {
  decision: "allow" | "deny" | "approval_required";
  policyRevisionId: string;
  policyGeneration: number;
  policyDigest: string;
  specDigest: string;
  reasons: string[];
}

export interface InstallTicketClaims {
  ticketId: string;
  tenantId: string;
  computerId: string;
  policyRevisionId: string;
  policyGeneration: number;
  policyDigest: string;
  specDigest: string;
  spec: PackageSpec;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
}

export interface ResidentEnrollment {
  id: string;
  tenantId: string;
  computerId: string;
  expectedProvider: ProviderKind;
  expectedInstanceId: string;
  expectedBootId: string;
  bindingGeneration: number;
  tokenHash: string;
  expiresAt: string;
  usedAt?: string;
}

export interface ResidentBinding {
  tenantId: string;
  computerId: string;
  provider: ProviderKind;
  providerResourceId: string;
  instanceId: string;
  bootId: string;
  generation: number;
  updatedAt: string;
}

export interface ResidentIdentity {
  certificateId: string;
  tenantId: string;
  computerId: string;
  provider: ProviderKind;
  instanceId: string;
  bootId: string;
  generation: number;
  bindingGeneration: number;
  issuedAt: string;
  expiresAt: string;
  revokedAt?: string;
}

export interface ResidentOperationEnvelope {
  operationId: string;
  attemptId: string;
  tenantId: string;
  computerId: string;
  certificateId: string;
  policyGeneration: number;
  fence: number;
  sequence: number;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
  capability: "exec" | "install" | "status" | "cancel";
  payloadDigest: string;
}

export interface HomeLease {
  tenantId: string;
  computerId: string;
  holderId: string;
  fence: number;
  expiresAt: string;
}

export interface HomeLeaseCapability extends HomeLease {
  homeId: string;
}

export interface AuditCheckpoint {
  tenantId: string;
  sequence: number;
  eventHash: string;
  createdAt: string;
}

export interface AuditVerification {
  valid: boolean;
  anchored: boolean;
  eventCount: number;
  error?: string;
}

export interface AuditCheckpointSink {
  readiness(): Promise<{ configured: boolean; ready: boolean; durable: boolean; limitations: string[] }>;
  write(checkpoint: AuditCheckpoint): Promise<void>;
}

export interface AuthorizationContext {
  tenantId: string;
  principalId: string;
  scopes: Scope[];
  boundComputerId?: string;
  policyGeneration?: number;
  authMethod: "bearer" | "loopback_dev" | "resident_mtls";
}

export interface ProviderReadiness {
  provider: ProviderKind;
  configured: boolean;
  ready: boolean;
  confinementClass: ConfinementClass;
  controls: Record<string, boolean>;
  limitations: string[];
}

export type ErrorCode =
  | "authentication_required"
  | "authorization_denied"
  | "not_found"
  | "conflict"
  | "invalid_request"
  | "request_too_large"
  | "provider_not_configured"
  | "provider_outcome_unknown"
  | "unsupported_operation"
  | "sandbox_disabled"
  | "replay_detected"
  | "stale_fence"
  | "expired"
  | "policy_generation_mismatch"
  | "quota_exceeded"
  | "storage_error";

export class ComputersError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, status = 400, details?: Record<string, unknown>) {
    super(message);
    this.name = "ComputersError";
    this.code = code;
    this.status = status;
    if (details !== undefined) this.details = details;
  }
}

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    requestId: string;
  };
}
