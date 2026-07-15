import type { Computer, HomeLeaseCapability, Operation, ProviderAttempt, ProviderKind, ProviderOutcome, ProviderReadiness } from "./contracts";
import { ComputersError } from "./contracts";

const PROVIDER_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,511}$/;

function exact(value: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(value).some((key) => !keys.includes(key))) throw new ComputersError("invalid_request", "Provider returned an invalid outcome", 500);
}

function resource(value: unknown): NonNullable<ProviderOutcome["resource"]> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new ComputersError("invalid_request", "Provider returned an invalid outcome", 500);
  const item = value as Record<string, unknown>; exact(item, ["resourceId", "instanceId", "bootId"]);
  for (const key of ["resourceId", "instanceId", "bootId"] as const) {
    if ((key === "resourceId" || item[key] !== undefined) && (typeof item[key] !== "string" || !PROVIDER_REFERENCE.test(item[key]))) {
      throw new ComputersError("invalid_request", "Provider returned an invalid outcome", 500);
    }
  }
  const result: NonNullable<ProviderOutcome["resource"]> = { resourceId: String(item.resourceId) };
  if (item.instanceId !== undefined) result.instanceId = String(item.instanceId);
  if (item.bootId !== undefined) result.bootId = String(item.bootId);
  return result;
}

export function validateProviderOutcome(value: unknown): ProviderOutcome {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new ComputersError("invalid_request", "Provider returned an invalid outcome", 500);
  const item = value as Record<string, unknown>;
  if (item.kind === "success") {
    exact(item, ["kind", "resource", "result"]);
    if (typeof item.result !== "object" || item.result === null || Array.isArray(item.result)) throw new ComputersError("invalid_request", "Provider returned an invalid outcome", 500);
    let encoded: string;
    try { encoded = JSON.stringify(item.result); } catch { throw new ComputersError("invalid_request", "Provider returned an invalid outcome", 500); }
    if (new TextEncoder().encode(encoded).byteLength > 1024 * 1024) throw new ComputersError("invalid_request", "Provider returned an invalid outcome", 500);
    return { kind: "success", resource: resource(item.resource), result: item.result as Record<string, unknown> };
  }
  if (item.kind === "definite_failure") {
    exact(item, ["kind", "code", "message", "resource"]);
    if (typeof item.code !== "string" || !/^[a-z][a-z0-9_]{2,63}$/.test(item.code)
      || typeof item.message !== "string" || item.message.length < 1 || item.message.length > 512) throw new ComputersError("invalid_request", "Provider returned an invalid outcome", 500);
    const outcome: Extract<ProviderOutcome, { kind: "definite_failure" }> = { kind: "definite_failure", code: item.code, message: item.message };
    if (item.resource !== undefined) outcome.resource = resource(item.resource);
    return outcome;
  }
  if (item.kind === "unknown") {
    exact(item, ["kind", "providerOperationId", "message", "resource"]);
    if (typeof item.providerOperationId !== "string" || !PROVIDER_REFERENCE.test(item.providerOperationId)
      || typeof item.message !== "string" || item.message.length < 1 || item.message.length > 512) throw new ComputersError("invalid_request", "Provider returned an invalid outcome", 500);
    const outcome: Extract<ProviderOutcome, { kind: "unknown" }> = { kind: "unknown", providerOperationId: item.providerOperationId, message: item.message };
    if (item.resource !== undefined) outcome.resource = resource(item.resource);
    return outcome;
  }
  throw new ComputersError("invalid_request", "Provider returned an invalid outcome", 500);
}

export interface ProviderCreateRequest {
  computer: Computer;
  operation: Operation;
  attempt: ProviderAttempt;
}

export interface ProviderOperationRequest extends ProviderCreateRequest {
  homeLease?: HomeLeaseCapability;
}

export interface ProviderPort {
  readonly kind: ProviderKind;
  readiness(): Promise<ProviderReadiness>;
  create(request: ProviderCreateRequest): Promise<ProviderOutcome>;
  start(request: ProviderOperationRequest & { homeLease: HomeLeaseCapability }): Promise<ProviderOutcome>;
  stop(request: ProviderOperationRequest): Promise<ProviderOutcome>;
  quarantine(request: ProviderOperationRequest): Promise<ProviderOutcome>;
  delete(request: ProviderOperationRequest): Promise<ProviderOutcome>;
  restore(request: ProviderOperationRequest & { homeLease: HomeLeaseCapability }): Promise<ProviderOutcome>;
  reconcile(request: ProviderOperationRequest): Promise<ProviderOutcome>;
}

export class UnconfiguredProvider implements ProviderPort {
  readonly kind: ProviderKind;

  constructor(kind: ProviderKind) {
    this.kind = kind;
  }

  async readiness(): Promise<ProviderReadiness> {
    const strict = this.kind !== "local_machine";
    return {
      provider: this.kind,
      configured: false,
      ready: false,
      confinementClass: strict ? "unverified_vm" : "dedicated_machine",
      controls: strict
        ? { providerSpecificControlsPassed: false, externalEgressEnforced: false, residentIndependentIsolation: false }
        : { entireHostDedicated: false, controllerExternallyProtected: false },
      limitations: [
        "Provider adapter is not configured in this core slice.",
        strict
          ? "strict_vm may be claimed only after provider-specific isolation and egress controls pass."
          : "local_machine is lower-assurance dedicated_machine confinement and never strict VM isolation.",
      ],
    };
  }

  async create(_request: ProviderCreateRequest): Promise<ProviderOutcome> {
    return this.unavailable();
  }

  async start(_request: ProviderOperationRequest & { homeLease: HomeLeaseCapability }): Promise<ProviderOutcome> {
    return this.unavailable();
  }

  async stop(_request: ProviderOperationRequest): Promise<ProviderOutcome> {
    return this.unavailable();
  }

  async quarantine(_request: ProviderOperationRequest): Promise<ProviderOutcome> {
    return this.unavailable();
  }

  async delete(_request: ProviderOperationRequest): Promise<ProviderOutcome> {
    return this.unavailable();
  }

  async restore(_request: ProviderOperationRequest & { homeLease: HomeLeaseCapability }): Promise<ProviderOutcome> { return this.unavailable(); }
  async reconcile(_request: ProviderOperationRequest): Promise<ProviderOutcome> { return this.unavailable(); }

  private unavailable(): ProviderOutcome {
    return { kind: "definite_failure", code: "provider_not_configured", message: `Provider ${this.kind} is not configured` };
  }
}

export function createProviderPorts(): Record<ProviderKind, ProviderPort> {
  return {
    local_machine: new UnconfiguredProvider("local_machine"),
    local_vm: new UnconfiguredProvider("local_vm"),
    aws_ec2: new UnconfiguredProvider("aws_ec2"),
  };
}
