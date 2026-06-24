import type { FleetToolInput } from "./planner-tools.js";
import { fleetArtifactTokenClaims, type FleetArtifactTokenClaims } from "./fleet-artifacts.js";

export type FleetTransportKind =
  | "open-machines-cli-ssh"
  | "open-machines-mcp-http"
  | "resident-agent";

export type FleetTransportAuth =
  | "ssh-agent"
  | "api-key"
  | "mtls";

export interface FleetTransportRequest {
  kind: FleetTransportKind;
  auth: FleetTransportAuth;
  machineId: string;
  explicitOptIn: boolean;
  capabilityToken?: string;
  endpoint?: string;
}

export type FleetTransportDecisionStatus = "allowed" | "requires_confirmation" | "blocked";

export interface FleetTransportDecision {
  status: FleetTransportDecisionStatus;
  allowed: boolean;
  reason?: string;
  metadata: Record<string, unknown>;
}

export interface FleetCapabilityTokenVerification {
  token: string;
  machineId: string;
  action: FleetToolInput["action"];
  transportKind: FleetTransportKind;
  transportAuth: FleetTransportAuth;
  endpoint?: string;
  artifact?: FleetArtifactTokenClaims;
}

export type FleetCapabilityTokenVerifier = (
  verification: FleetCapabilityTokenVerification,
) => boolean | { ok: boolean; reason?: string };

const MUTATING_FLEET_ACTIONS = new Set<FleetToolInput["action"]>(["run_smoke", "pull_artifact"]);

export function isFleetMutation(input: FleetToolInput): boolean {
  return MUTATING_FLEET_ACTIONS.has(input.action);
}

export function evaluateFleetTransport(
  input: FleetToolInput,
  options: {
    approved?: boolean;
    fleetTransport?: FleetTransportRequest;
    verifyCapabilityToken?: FleetCapabilityTokenVerifier;
  } = {},
): FleetTransportDecision {
  if (!isFleetMutation(input)) {
    return {
      status: "allowed",
      allowed: true,
      metadata: { mutation: false },
    };
  }

  if (!options.approved) {
    return {
      status: "requires_confirmation",
      allowed: false,
      reason: `fleet.${input.action} requires approval before execution.`,
      metadata: { mutation: true },
    };
  }

  const transport = options.fleetTransport;
  if (!transport) {
    return blocked("Approved fleet mutations require an explicit secure fleet transport.", input, transport);
  }

  if (!transport.explicitOptIn) {
    return blocked("Fleet transport requires explicit operator opt-in for this run.", input, transport);
  }

  if (transport.machineId !== input.machineId) {
    return blocked("Fleet transport machine binding does not match the requested machine.", input, transport);
  }

  if (!transport.capabilityToken?.trim()) {
    return blocked("Fleet transport requires a machine-scoped capability token.", input, transport);
  }

  const authError = validateTransportAuth(transport);
  if (authError) {
    return blocked(authError, input, transport);
  }

  const tokenDecision = verifyCapabilityToken(input, transport, options.verifyCapabilityToken);
  if (!tokenDecision.ok) {
    return blocked(tokenDecision.reason, input, transport);
  }

  return {
    status: "allowed",
    allowed: true,
    metadata: transportAuditMetadata(input, transport),
  };
}

function verifyCapabilityToken(
  input: FleetToolInput,
  transport: FleetTransportRequest,
  verifier: FleetCapabilityTokenVerifier | undefined,
): { ok: true } | { ok: false; reason: string } {
  const token = transport.capabilityToken?.trim();
  if (!token) {
    return { ok: false, reason: "Fleet transport requires a machine-scoped capability token." };
  }
  const artifact = input.action === "pull_artifact"
    ? fleetArtifactTokenClaims(input)
    : undefined;
  if (input.action === "pull_artifact" && !artifact) {
    return { ok: false, reason: "Fleet artifact pulls require a canonical artifact contract before token verification." };
  }
  if (!verifier) {
    return { ok: false, reason: "Fleet transport requires verified machine/action capability token claims." };
  }
  const result = verifier({
    token,
    machineId: input.machineId,
    action: input.action,
    transportKind: transport.kind,
    transportAuth: transport.auth,
    endpoint: transport.endpoint,
    artifact,
  });
  if (result === true) return { ok: true };
  if (result === false) {
    return { ok: false, reason: "Fleet capability token verifier rejected the token." };
  }
  return result.ok
    ? { ok: true }
    : { ok: false, reason: result.reason ?? "Fleet capability token verifier rejected the token." };
}

export function transportAuditMetadata(
  input: FleetToolInput,
  transport: FleetTransportRequest | undefined,
): Record<string, unknown> {
  const endpointClass = classifyEndpoint(transport?.endpoint);
  return {
    mutation: isFleetMutation(input),
    requested_action: input.action,
    machine_binding: transport ? transport.machineId === input.machineId : false,
    transport_kind: transport?.kind ?? "missing",
    transport_auth: transport?.auth ?? "missing",
    endpoint_class: endpointClass,
    explicit_opt_in: transport?.explicitOptIn === true,
    capability_token_present: Boolean(transport?.capabilityToken?.trim()),
  };
}

function blocked(
  reason: string,
  input: FleetToolInput,
  transport: FleetTransportRequest | undefined,
): FleetTransportDecision {
  return {
    status: "blocked",
    allowed: false,
    reason,
    metadata: transportAuditMetadata(input, transport),
  };
}

function validateTransportAuth(transport: FleetTransportRequest): string | undefined {
  if (transport.kind === "open-machines-cli-ssh") {
    return transport.auth === "ssh-agent"
      ? undefined
      : "open-machines SSH transport requires ssh-agent authentication.";
  }

  if (transport.kind === "open-machines-mcp-http") {
    const endpointClass = classifyEndpoint(transport.endpoint);
    if (endpointClass === "missing" || endpointClass === "invalid") {
      return "open-machines MCP HTTP transport requires a valid endpoint.";
    }
    if (endpointClass === "insecure_remote") {
      return "open-machines MCP HTTP transport must use HTTPS, mTLS, or loopback-only HTTP.";
    }
    if (transport.auth !== "api-key") {
      return "open-machines MCP HTTP transport currently requires API-key authentication; mTLS is reserved until open-machines implements it.";
    }
    return undefined;
  }

  if (transport.kind === "resident-agent") {
    const endpointClass = classifyEndpoint(transport.endpoint);
    if (endpointClass === "missing" || endpointClass === "invalid") {
      return "resident-agent transport requires a valid endpoint.";
    }
    if (endpointClass === "insecure_remote") {
      return "resident-agent transport must use HTTPS, mTLS, or loopback-only HTTP.";
    }
    if (transport.auth !== "api-key" && transport.auth !== "mtls") {
      return "resident-agent transport requires api-key or mTLS authentication.";
    }
    return undefined;
  }
}

function classifyEndpoint(endpoint: string | undefined): "missing" | "loopback" | "https" | "insecure_remote" | "invalid" {
  if (!endpoint) return "missing";
  try {
    const url = new URL(endpoint);
    const host = url.hostname.toLowerCase();
    const loopback = host === "localhost" || host === "127.0.0.1" || host === "::1";
    if (loopback) return "loopback";
    if (url.protocol === "https:") return "https";
    return "insecure_remote";
  } catch {
    return "invalid";
  }
}
