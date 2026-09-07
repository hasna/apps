import { domainToASCII } from "node:url";
import type { TenantScopedStore, DomainRecord } from "./store.js";
import type { SenderResolver } from "./sender.js";
import type { DomainDnsTask } from "./domain-connect-provider.js";

export class DomainConnectError extends Error {
  constructor(
    message: string,
    readonly status = 409,
    readonly reason = "domain_connect_conflict",
  ) {
    super(message);
  }
}
export interface DomainConnectInput {
  domain: string;
  provider_id: string;
  dns_provider: "manual" | "cloudflare" | "route53";
  register_provider: boolean;
}
export interface DomainConnectRefs {
  input: DomainConnectInput;
  provider_type: "ses" | "resend";
  domain: DomainRecord | null;
}
export interface DomainConnectResult {
  dry_run: boolean;
  connection: {
    id: string | null;
    domain_id: string | null;
    domain: string;
    provider_id: string;
    dns_provider: DomainConnectInput["dns_provider"];
    register_provider: boolean;
    status:
      | "planned"
      | "processing"
      | "blocked"
      | "pending_verification"
      | "verified";
    provider_registered: boolean | null;
    dns_tasks: DomainDnsTask[];
    checked_at: string;
    message: string;
  };
}
export interface DomainConnectClaim {
  id: string;
  lease: string | null;
  provider_type: "ses" | "resend";
  input: DomainConnectInput;
}
export function normalizeDomainConnect(
  body: Record<string, unknown>,
): DomainConnectInput {
  if (
    Object.keys(body).some(
      (key) =>
        ![
          "domain",
          "provider_id",
          "dns_provider",
          "register_provider",
          "dry_run",
        ].includes(key),
    )
  )
    throw new DomainConnectError(
      "Unknown domain connection option",
      400,
      "invalid_option",
    );
  const domain =
    typeof body.domain === "string"
      ? domainToASCII(body.domain.trim().replace(/\.$/, "")).toLowerCase()
      : "";
  if (
    !domain ||
    domain.length > 253 ||
    !domain.includes(".") ||
    !domain
      .split(".")
      .every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) ||
    /^\d+(?:\.\d+){3}$/.test(domain)
  )
    throw new DomainConnectError(
      "A valid already-owned DNS domain is required",
      400,
      "invalid_domain",
    );
  const provider = body.provider_id;
  if (
    typeof provider !== "string" ||
    !provider.trim() ||
    provider.length > 300 ||
    /[\x00-\x1f\x7f]/.test(provider)
  )
    throw new DomainConnectError(
      "A nonempty provider reference is required",
      400,
      "invalid_provider",
    );
  const dns = body.dns_provider ?? "manual";
  if (
    typeof dns !== "string" ||
    !["manual", "cloudflare", "route53"].includes(dns)
  )
    throw new DomainConnectError(
      "Unknown DNS provider label",
      400,
      "invalid_dns_provider",
    );
  for (const field of ["dry_run", "register_provider"] as const)
    if (body[field] !== undefined && typeof body[field] !== "boolean")
      throw new DomainConnectError(
        `${field} must be boolean`,
        400,
        "invalid_option",
      );
  return {
    domain,
    provider_id: provider.trim(),
    dns_provider: dns as DomainConnectInput["dns_provider"],
    register_provider: body.register_provider !== false,
  };
}
export async function connectDomain(
  store: TenantScopedStore,
  tenant: string,
  input: DomainConnectInput,
  dryRun: boolean,
  resolveSender?: SenderResolver,
  actor = "operator",
): Promise<DomainConnectResult> {
  const refs = await store.resolveDomainConnect(input);
  const sender = resolveSender?.(tenant, refs.input.provider_id);
  if (
    !sender?.readDomainConnection ||
    (input.register_provider && !sender.registerDomain) ||
    sender.provider !== refs.provider_type
  )
    throw new DomainConnectError(
      "Configure a matching server SES or Resend domain-management binding",
      503,
      "provider_capability_missing",
    );
  const result: DomainConnectResult = {
    dry_run: dryRun,
    connection: {
      id: null,
      domain_id: refs.domain?.id ?? null,
      ...refs.input,
      status: dryRun ? "planned" : "processing",
      provider_registered: null,
      dns_tasks: [],
      checked_at: new Date().toISOString(),
      message: dryRun
        ? "Plan only: resolve the provider domain, register it if requested and missing, then record DNS publication tasks. No provider calls or records changed."
        : "Domain connection is processing; run connect again to inspect or resume it.",
    },
  };
  if (dryRun) return result;
  const claim = await store.claimDomainConnect(
    refs.input,
    refs.provider_type,
    actor,
  );
  result.connection.id = claim.id;
  if (!claim.lease)
    return { ...result, connection: { ...result.connection, ...claim.input } };
  try {
    const signal = AbortSignal.timeout(25000);
    let evidence = await sender.readDomainConnection(input.domain, signal);
    if (!evidence.registered && input.register_provider) {
      const currentRefs = await store.resolveDomainConnect(refs.input);
      if (currentRefs.provider_type !== refs.provider_type)
        throw new DomainConnectError(
          "Provider binding changed before registration",
          409,
          "provider_mismatch",
        );
      if (!(await store.domainConnectLeaseCurrent(claim))) return result;
      await sender.registerDomain!(input.domain, signal);
      evidence = await sender.readDomainConnection(input.domain, signal);
    }
    if (!evidence.registered && input.register_provider)
      throw new DomainConnectError(
        "The requested provider registration is not confirmed; retry to inspect the provider again",
        409,
        "registration_unconfirmed",
      );
    result.connection.provider_registered = evidence.registered;
    result.connection.dns_tasks = evidence.dns_tasks;
    result.connection.checked_at = new Date().toISOString();
    result.connection.status = evidence.verified_for_sending
      ? "verified"
      : "pending_verification";
    result.connection.message = !evidence.registered
      ? "The provider has no registered domain. Registration was skipped; register it before DNS verification."
      : evidence.verified_for_sending
        ? "The provider reports sending verification. DNS tasks and shared registry are recorded; inbound routing is unchanged."
        : "The provider domain is registered. Publish or merge the returned DNS records, then run domain verify. No DNS was published.";
    const completed = await store.completeDomainConnect(claim, result);
    return (
      completed ?? {
        ...result,
        connection: {
          ...result.connection,
          status: "processing",
          message:
            "A newer connection attempt owns this job; run connect again to read current evidence.",
        },
      }
    );
  } catch (error) {
    result.connection.status = "blocked";
    result.connection.message =
      error instanceof DomainConnectError
        ? error.message
        : "Provider registration or DNS evidence could not be confirmed. A provider-side change may have completed; retry reads the provider before registering again. Provider details are not exposed.";
    result.connection.checked_at = new Date().toISOString();
    await store.blockDomainConnect(claim, result);
    return result;
  }
}
