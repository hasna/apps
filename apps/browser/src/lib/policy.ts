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

export type BrowserActionRisk = "none" | "navigation" | "external_mutation" | "sensitive";

export type BrowserActionPolicyTag =
  | "account_creation"
  | "captcha"
  | "credential_entry"
  | "credential_submit"
  | "delete"
  | "external_mutation"
  | "file_download"
  | "file_upload"
  | "irreversible_mutation"
  | "legal_acceptance"
  | "mfa"
  | "navigation"
  | "payment";

export interface BrowserActionRiskInput {
  kind?: string;
  label?: string;
  instruction?: string;
  role?: string;
  fieldType?: string;
  fieldName?: string;
  selector?: string;
}

export interface BrowserActionRiskClassification {
  risk: BrowserActionRisk;
  requiresApproval: boolean;
  tags: BrowserActionPolicyTag[];
  reason?: string;
}

type Env = Record<string, string | undefined>;

export interface BrowserPolicyOptions {
  approvalToken?: string;
  env?: Env;
}

function truthy(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true" || value?.toLowerCase() === "yes";
}

function normalizePolicyText(value: string | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9@._ -]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function has(text: string, pattern: RegExp): boolean {
  return pattern.test(text);
}

function addTag(tags: BrowserActionPolicyTag[], tag: BrowserActionPolicyTag): void {
  if (!tags.includes(tag)) tags.push(tag);
}

function maxActionRisk(a: BrowserActionRisk, b: BrowserActionRisk): BrowserActionRisk {
  const rank: Record<BrowserActionRisk, number> = {
    none: 0,
    navigation: 1,
    external_mutation: 2,
    sensitive: 3,
  };
  return rank[a] >= rank[b] ? a : b;
}

export function classifyBrowserActionRisk(input: BrowserActionRiskInput): BrowserActionRiskClassification {
  const kind = normalizePolicyText(input.kind);
  const role = normalizePolicyText(input.role);
  const fieldType = normalizePolicyText(input.fieldType);
  const target = normalizePolicyText([
    input.label,
    input.role,
    input.fieldType,
    input.fieldName,
    input.selector,
  ].filter(Boolean).join(" "));
  const instruction = normalizePolicyText(input.instruction);
  const all = normalizePolicyText(`${target} ${instruction}`);
  const tags: BrowserActionPolicyTag[] = [];
  let risk: BrowserActionRisk = "none";

  const actionLike = kind === "click" || kind === "check" || kind === "select";
  const submitLikeTarget = has(target, /\b(submit|continue|next|confirm|finish|complete|done|save|send)\b/);
  const accountContext = has(all, /\b(create account|sign up|signup|register|registration|join|new account)\b/);
  const credentialContext = has(all, /\b(login|log in|sign in|signin|password|credential)\b/);

  if (fieldType === "password" || has(target, /\b(password|passcode|secret answer)\b/)) {
    addTag(tags, "credential_entry");
    risk = maxActionRisk(risk, "sensitive");
  }

  if (has(all, /\b(captcha|hcaptcha|recaptcha|human verification|verify you are human|i am human)\b/)) {
    addTag(tags, "captcha");
    risk = maxActionRisk(risk, "sensitive");
  }

  if (has(all, /\b(mfa|2fa|two factor|two-factor|one time|one-time|otp|totp|authenticator|verification code|security code)\b/)) {
    addTag(tags, "mfa");
    risk = maxActionRisk(risk, "sensitive");
  }

  if (fieldType === "file" || has(target, /\b(upload|attach file|choose file)\b/)) {
    addTag(tags, "file_upload");
    risk = maxActionRisk(risk, "sensitive");
  }

  if (has(target, /\b(download|export)\b/)) {
    addTag(tags, "file_download");
    risk = maxActionRisk(risk, "external_mutation");
  }

  if (has(all, /\b(card number|credit card|debit card|cvv|cvc|iban|bank account|billing|payment|pay now|purchase|buy now|place order|checkout)\b/)) {
    addTag(tags, "payment");
    risk = maxActionRisk(risk, "sensitive");
  }

  if (actionLike && has(all, /\b(delete|remove account|close account|cancel subscription|terminate|revoke|wire|transfer)\b/)) {
    addTag(tags, "delete");
    addTag(tags, "irreversible_mutation");
    risk = maxActionRisk(risk, "sensitive");
  }

  if (actionLike && has(all, /\b(terms|privacy|policy|eula|agreement|consent|i agree|agree to|accept terms|legal)\b/)) {
    addTag(tags, "legal_acceptance");
    risk = maxActionRisk(risk, "sensitive");
  }

  if (actionLike && (has(target, /\b(create account|sign up|signup|register|join now|submit registration)\b/) || (submitLikeTarget && accountContext))) {
    addTag(tags, "account_creation");
    risk = maxActionRisk(risk, "sensitive");
  }

  if (actionLike && (has(target, /\b(sign in|signin|log in|login)\b/) || (submitLikeTarget && credentialContext))) {
    addTag(tags, "credential_submit");
    risk = maxActionRisk(risk, "sensitive");
  }

  if (actionLike && has(all, /\b(add to cart|apply|approve|book|cancel|change|confirm|create|decline|edit|enroll|invite|post|publish|remove|request|reserve|reschedule|save address|save changes|schedule|send|share|submit|unsubscribe|update|upload)\b/)) {
    addTag(tags, "external_mutation");
    risk = maxActionRisk(risk, "external_mutation");
  }

  if (risk === "none" && kind === "click" && has(all, /\b(next|continue|open|view|details|learn more)\b/)) {
    addTag(tags, "navigation");
    risk = "navigation";
  }

  return {
    risk,
    requiresApproval: risk === "sensitive" || risk === "external_mutation",
    tags,
    reason: tags.length > 0 ? `Policy tags: ${tags.join(", ")}` : undefined,
  };
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
