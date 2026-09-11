import { EmailsSelfHostClient, ApiError } from "../selfhost.js";
import { readStorageWiring } from "./storage-wiring.js";
import { resolveSelfHostedConfig } from "../db/self-hosted-store.js";
export interface ConnectDomainOptions {
  provider: string;
  dnsProvider?: "manual" | "cloudflare" | "route53";
  registerProvider?: boolean;
  dryRun?: boolean;
}
export type ConnectDomainResult = Awaited<
  ReturnType<EmailsSelfHostClient["connectDomain"]>
>;
function client() {
  if (readStorageWiring(process.env).kind !== "api")
    throw new Error(
      "Domain connection requires an authenticated Emails API configuration and cannot use a local database.",
    );
  const config = resolveSelfHostedConfig(process.env, {
    selectedMode: "self_hosted",
  });
  const base = new URL(config.baseUrl);
  base.pathname = base.pathname.replace(/\/v1\/?$/, "").replace(/\/$/, "");
  return new EmailsSelfHostClient({
    baseUrl: base.toString().replace(/\/$/, ""),
    bearerToken: config.credential,
  });
}
export async function connectDomain(
  domain: string,
  options: ConnectDomainOptions,
): Promise<ConnectDomainResult> {
  try {
    return await client().connectDomain(
      {
        domain,
        provider_id: options.provider,
        dns_provider: options.dnsProvider ?? "manual",
        register_provider: options.registerProvider ?? true,
        dry_run: options.dryRun ?? false,
      },
      { signal: AbortSignal.timeout(30000) },
    );
  } catch (error) {
    const reasons: Record<string, string> = {
      invalid_option: "Unknown or invalid connection option.",
      invalid_domain: "A valid already-owned DNS domain is required.",
      invalid_provider: "A nonempty provider reference is required.",
      invalid_dns_provider:
        "Choose manual, cloudflare, or route53 as the DNS provider label.",
      provider_not_found:
        "Provider reference is missing or ambiguous in this account.",
      provider_unavailable: "Select an active SES or Resend provider.",
      provider_mismatch:
        "The domain must be bound to the selected provider; transfer it explicitly first.",
      domain_disabled: "The existing domain is disabled or suspended.",
      provider_capability_missing:
        "Configure a matching server SES or Resend domain-management binding.",
    };
    if (
      error instanceof ApiError &&
      error.body &&
      typeof error.body === "object" &&
      "reason" in error.body &&
      typeof error.body.reason === "string" &&
      Object.hasOwn(reasons, error.body.reason)
    )
      throw new Error(reasons[error.body.reason], { cause: error });
    throw error;
  }
}
export function inspectDomainConnection(
  id: string,
): Promise<ConnectDomainResult> {
  return client().getDomainConnection(id, {
    signal: AbortSignal.timeout(30000),
  });
}
export function formatDomainConnection(result: ConnectDomainResult): string {
  const item = result.connection;
  return [
    `${item.domain}: ${item.status}${item.id ? ` (${item.id})` : ""}`,
    item.message,
    ...item.dns_tasks.map(
      (task) =>
        `${task.type} ${task.name} ${task.priority === undefined ? "" : `${task.priority} `}${task.value} [${task.purpose}: ${task.status}]`,
    ),
  ].join("\n");
}
