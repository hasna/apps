import { BrowserError } from "../types/index.js";

export const BROWSER_ALLOW_RISKY_CAPABILITIES_ENV = "BROWSER_ALLOW_RISKY_CAPABILITIES";
export const BROWSER_CAPABILITY_TOKEN_ENV = "BROWSER_CAPABILITY_TOKEN";
export const BROWSER_ALLOWED_DOMAINS_ENV = "BROWSER_ALLOWED_DOMAINS";

export type BrowserCapability =
  | "cdp_attach"
  | "tui_launch"
  | "extension_session"
  | "extension_evaluate"
  | "stealth"
  | "storage_state"
  | "file_upload"
  | "file_download";

type Env = Record<string, string | undefined>;

export interface BrowserPolicyOptions {
  approvalToken?: string;
  env?: Env;
}

function truthy(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true" || value?.toLowerCase() === "yes";
}

function capabilityEnvName(capability: BrowserCapability): string {
  return `BROWSER_ALLOW_${capability.toUpperCase()}`;
}

export function isBrowserCapabilityApproved(
  capability: BrowserCapability,
  options: BrowserPolicyOptions = {}
): boolean {
  const env = options.env ?? process.env;
  const configuredToken = env[BROWSER_CAPABILITY_TOKEN_ENV]?.trim();
  if (configuredToken) return options.approvalToken === configuredToken;
  return truthy(env[BROWSER_ALLOW_RISKY_CAPABILITIES_ENV]) || truthy(env[capabilityEnvName(capability)]);
}

export function assertBrowserCapability(
  capability: BrowserCapability,
  options: BrowserPolicyOptions = {}
): void {
  if (isBrowserCapabilityApproved(capability, options)) return;
  throw new BrowserError(
    `Browser capability '${capability}' requires operator approval. Set ${BROWSER_ALLOW_RISKY_CAPABILITIES_ENV}=1 for a trusted local session or configure ${BROWSER_CAPABILITY_TOKEN_ENV} and pass approval_token.`,
    "BROWSER_CAPABILITY_REQUIRES_APPROVAL",
  );
}

export function allowedDomains(env: Env = process.env): string[] {
  return (env[BROWSER_ALLOWED_DOMAINS_ENV] ?? "")
    .split(",")
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean);
}

export function assertBrowserNavigationAllowed(url: string, options: { env?: Env } = {}): void {
  const domains = allowedDomains(options.env);
  if (domains.length === 0) return;

  let hostname = "";
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return;
  }

  const allowed = domains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
  if (!allowed) {
    throw new BrowserError(
      `Navigation to '${hostname}' is not in ${BROWSER_ALLOWED_DOMAINS_ENV}.`,
      "BROWSER_DOMAIN_NOT_ALLOWED",
    );
  }
}
