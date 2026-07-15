import { ComputersError, type ConfinementClass, type InstallPolicyRule, type PackageSpec, type ProviderKind } from "./contracts";

const ID = /^[a-z][a-z0-9_]{2,63}$/;
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const NONCE = /^[A-Za-z0-9_-]{16,128}$/;
const PACKAGE = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._+-]*$/i;
const VERSION = /^[A-Za-z0-9][A-Za-z0-9._+~:-]{0,127}$/;

function invalid(field: string, reason: string): never {
  throw new ComputersError("invalid_request", `Invalid ${field}`, 400, { field, reason });
}

export function validateId(value: unknown, field = "id"): string {
  if (typeof value !== "string" || !ID.test(value)) invalid(field, "must match a safe identifier");
  return value;
}

export function validateSlug(value: unknown, field = "slug"): string {
  if (typeof value !== "string" || !SLUG.test(value)) invalid(field, "must be a lowercase DNS-style slug");
  return value;
}

export function validateProvider(value: unknown): ProviderKind {
  if (value !== "local_machine" && value !== "local_vm" && value !== "aws_ec2") invalid("provider", "unsupported provider");
  return value;
}

export function validateProviderConfinement(provider: ProviderKind, confinementClass: ConfinementClass): void {
  const valid = provider === "local_machine"
    ? confinementClass === "dedicated_machine"
    : confinementClass === "unverified_vm" || confinementClass === "strict_vm";
  if (!valid) invalid("confinementClass", "contradicts provider assurance class");
}

export function validateIdempotencyKey(value: unknown): string {
  if (typeof value !== "string" || value.length < 8 || value.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(value)) {
    invalid("idempotencyKey", "must be 8-128 safe characters");
  }
  return value;
}

export function validateNonce(value: unknown): string {
  if (typeof value !== "string" || !NONCE.test(value)) invalid("nonce", "must be 16-128 URL-safe characters");
  return value;
}

export function validateTimestamp(value: unknown, field: string): string {
  if (typeof value !== "string") invalid(field, "must be an RFC3339 timestamp");
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) invalid(field, "must be canonical RFC3339 UTC");
  return value;
}

export function validatePath(value: unknown, field = "path"): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 4096 || !value.startsWith("/")) {
    invalid(field, "must be an absolute path");
  }
  if (value.includes("\0") || value.split("/").includes("..")) invalid(field, "must not contain NUL or traversal");
  return value;
}

export function validateArgv(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 128) invalid("argv", "must contain 1-128 arguments");
  let bytes = 0;
  const argv = value.map((item, index) => {
    if (typeof item !== "string" || item.length === 0 || item.includes("\0")) invalid(`argv[${index}]`, "must be a non-empty NUL-free string");
    bytes += new TextEncoder().encode(item).byteLength;
    return item;
  });
  if (bytes > 64 * 1024) invalid("argv", "encoded arguments exceed 64 KiB");
  return argv;
}

export function validateDigest(value: unknown, field = "digest"): string {
  if (typeof value !== "string" || !DIGEST.test(value)) invalid(field, "must be a sha256 digest");
  return value;
}

export function validatePackageSpec(value: unknown): PackageSpec {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid("spec", "must be an object");
  const item = value as Record<string, unknown>;
  assertExactKeys(item, ["manager", "name", "version", "digest", "registry", "dependencyClosure", "allowLifecycleScripts"]);
  const managers = ["apt", "dnf", "apk", "brew", "npm", "bun"] as const;
  if (!managers.includes(item.manager as (typeof managers)[number])) invalid("spec.manager", "unsupported manager");
  if (typeof item.name !== "string" || item.name.length > 214 || !PACKAGE.test(item.name) || item.name.includes("..")) invalid("spec.name", "unsafe package name");
  if (typeof item.version !== "string" || !VERSION.test(item.version)) invalid("spec.version", "unsafe or missing exact version");
  const digest = validateDigest(item.digest, "spec.digest");
  if (typeof item.registry !== "string" || item.registry.length > 512) invalid("spec.registry", "invalid registry URL");
  let registry: URL;
  try {
    registry = new URL(item.registry);
  } catch {
    invalid("spec.registry", "must be an absolute HTTPS URL");
  }
  if (registry.protocol !== "https:" || registry.username || registry.password) invalid("spec.registry", "must be credential-free HTTPS");
  if (!Array.isArray(item.dependencyClosure) || item.dependencyClosure.length > 512) invalid("spec.dependencyClosure", "must be an array with at most 512 items");
  const dependencyClosure = item.dependencyClosure.map((dependency, index) => {
    if (typeof dependency !== "object" || dependency === null || Array.isArray(dependency)) invalid(`spec.dependencyClosure[${index}]`, "must be an object");
    const dep = dependency as Record<string, unknown>;
    assertExactKeys(dep, ["name", "version", "digest"]);
    if (typeof dep.name !== "string" || dep.name.length > 214 || !PACKAGE.test(dep.name) || dep.name.includes("..")) invalid(`spec.dependencyClosure[${index}].name`, "unsafe name");
    if (typeof dep.version !== "string" || !VERSION.test(dep.version)) invalid(`spec.dependencyClosure[${index}].version`, "unsafe version");
    return { name: dep.name, version: dep.version, digest: validateDigest(dep.digest, `spec.dependencyClosure[${index}].digest`) };
  });
  if (typeof item.allowLifecycleScripts !== "boolean") invalid("spec.allowLifecycleScripts", "must be boolean");
  return {
    manager: item.manager as PackageSpec["manager"],
    name: item.name,
    version: item.version,
    digest,
    registry: registry.toString(),
    dependencyClosure,
    allowLifecycleScripts: item.allowLifecycleScripts,
  };
}

function invalidPolicy(reason: string): never {
  throw new ComputersError("invalid_request", "Invalid install policy", 400, { reason });
}

export function validateInstallPolicyRules(value: unknown): InstallPolicyRule[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 64) invalidPolicy("rules must contain 1-64 entries");
  return value.map((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) invalidPolicy("each rule must be an object");
    const rule = entry as Record<string, unknown>;
    for (const key of Object.keys(rule)) if (!["effect", "managers", "packagePatterns", "registries", "lifecycleScripts"].includes(key)) invalidPolicy(`unknown field ${key}`);
    if (rule.effect !== "allow" && rule.effect !== "deny" && rule.effect !== "approval_required") invalidPolicy("invalid effect");
    const result: InstallPolicyRule = { effect: rule.effect };
    if (rule.managers !== undefined) {
      const managers = ["apt", "dnf", "apk", "brew", "npm", "bun"] as const;
      if (!Array.isArray(rule.managers) || rule.managers.length < 1 || rule.managers.length > managers.length
        || rule.managers.some((item) => typeof item !== "string" || !managers.includes(item as never))
        || new Set(rule.managers).size !== rule.managers.length) invalidPolicy("invalid managers");
      result.managers = rule.managers as NonNullable<InstallPolicyRule["managers"]>;
    }
    if (rule.packagePatterns !== undefined) {
      if (!Array.isArray(rule.packagePatterns) || rule.packagePatterns.length < 1 || rule.packagePatterns.length > 64
        || new Set(rule.packagePatterns).size !== rule.packagePatterns.length
        || rule.packagePatterns.some((item) => typeof item !== "string" || item.length < 1 || item.length > 128
          || !/^[A-Za-z0-9@/_.+*:-]+$/.test(item) || (item.match(/\*/g)?.length ?? 0) > 8)) invalidPolicy("invalid package patterns");
      result.packagePatterns = rule.packagePatterns as string[];
    }
    if (rule.registries !== undefined) {
      if (!Array.isArray(rule.registries) || rule.registries.length < 1 || rule.registries.length > 32 || new Set(rule.registries).size !== rule.registries.length) invalidPolicy("invalid registries");
      const registries = rule.registries.map((item) => {
        if (typeof item !== "string" || item.length > 512) invalidPolicy("invalid registry");
        let url: URL;
        try { url = new URL(item); } catch { return invalidPolicy("invalid registry"); }
        if (url.protocol !== "https:" || url.username || url.password) invalidPolicy("invalid registry");
        return url.toString();
      });
      if (new Set(registries).size !== registries.length) invalidPolicy("invalid registries");
      result.registries = registries;
    }
    if (rule.lifecycleScripts !== undefined) {
      if (typeof rule.lifecycleScripts !== "boolean") invalidPolicy("invalid lifecycleScripts");
      result.lifecycleScripts = rule.lifecycleScripts;
    }
    return result;
  });
}

export function validateRegion(value: unknown, field = "region"): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/.test(value)) invalid(field, "must be a bounded region identifier");
  return value;
}

export function validatePositiveInteger(value: unknown, field: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > maximum) invalid(field, "must be a bounded positive integer");
  return Number(value);
}

export function validateNonNegativeInteger(value: unknown, field: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > maximum) invalid(field, "must be a bounded non-negative integer");
  return Number(value);
}

export function validateRequestObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid("body", "must be a JSON object");
  return value as Record<string, unknown>;
}

export function assertExactKeys(object: Record<string, unknown>, allowed: readonly string[]): void {
  const extra = Object.keys(object).filter((key) => !allowed.includes(key));
  if (extra.length > 0) invalid(extra[0] ?? "body", "unknown field");
}
