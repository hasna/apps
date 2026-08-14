import { ComputersError, type ConfinementClass, type InstallPolicyRule, type PackageSpec, type ProviderKind } from "./contracts";

const ID_PATTERN = "^[a-z][a-z0-9_]{2,63}$";
const IDEMPOTENCY_KEY_PATTERN = "^[A-Za-z0-9._:-]+$";
const PACKAGE_PATTERN = "^(?:@[A-Za-z0-9][A-Za-z0-9._-]*/)?[A-Za-z0-9][A-Za-z0-9._+-]*$";
const VERSION_PATTERN = "^[A-Za-z0-9][A-Za-z0-9._+~:-]{0,127}$";
const DIGEST_PATTERN = "^sha256:[a-f0-9]{64}$";
const REGISTRY_PATTERN = "^https://[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\\.[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?(?::[1-9][0-9]{3})?/(?:[A-Za-z0-9_~!$&()*+,:;=@-](?:[A-Za-z0-9._~!$&()*+,:;=@-]*[A-Za-z0-9_~!$&()*+,:;=@-])?(?:/[A-Za-z0-9_~!$&()*+,:;=@-](?:[A-Za-z0-9._~!$&()*+,:;=@-]*[A-Za-z0-9_~!$&()*+,:;=@-])?)*/?)?$";
const INSTALL_POLICY_PACKAGE_PATTERN = "^[A-Za-z0-9@/_.+:-]*(?:\\*[A-Za-z0-9@/_.+:-]*){0,8}$";
const ID = new RegExp(ID_PATTERN);
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const DIGEST = new RegExp(DIGEST_PATTERN);
const NONCE = /^[A-Za-z0-9_-]{16,128}$/;
const PACKAGE = new RegExp(PACKAGE_PATTERN);
const VERSION = new RegExp(VERSION_PATTERN);
const REGISTRY = new RegExp(REGISTRY_PATTERN);
const INSTALL_POLICY_PACKAGE = new RegExp(INSTALL_POLICY_PACKAGE_PATTERN);

const PACKAGE_NAME_SCHEMA = {
  type: "string", minLength: 1, maxLength: 214, pattern: PACKAGE_PATTERN, not: { pattern: "\\.\\." },
} as const;
const PACKAGE_VERSION_SCHEMA = { type: "string", minLength: 1, maxLength: 128, pattern: VERSION_PATTERN } as const;
const DIGEST_SCHEMA = { type: "string", pattern: DIGEST_PATTERN } as const;
const MAX_REGISTRY_HOSTNAME_LENGTH = 253;
const REGISTRY_SCHEMA = {
  type: "string", format: "uri", pattern: REGISTRY_PATTERN, maxLength: 512,
  "x-maxHostnameLength": MAX_REGISTRY_HOSTNAME_LENGTH,
} as const;
export const INSTALL_POLICY_PACKAGE_PATTERN_SCHEMA = {
  type: "string", minLength: 1, maxLength: 128, pattern: INSTALL_POLICY_PACKAGE_PATTERN,
} as const;

export const MCP_INPUT_SCHEMA_FRAGMENTS = {
  id: { type: "string", minLength: 3, maxLength: 64, pattern: ID_PATTERN },
  idempotencyKey: { type: "string", minLength: 8, maxLength: 128, pattern: IDEMPOTENCY_KEY_PATTERN },
  argv: {
    type: "array", minItems: 1, maxItems: 128, "x-maxEncodedBytes": 65_536,
    items: { type: "string", minLength: 1, maxLength: 65_536, pattern: "^[^\\u0000]+$" },
  },
  registry: REGISTRY_SCHEMA,
  packageSpec: {
    type: "object",
    required: ["manager", "name", "version", "digest", "registry", "dependencyClosure", "allowLifecycleScripts"],
    additionalProperties: false,
    properties: {
      manager: { enum: ["apt", "dnf", "apk", "brew", "npm", "bun"] },
      name: PACKAGE_NAME_SCHEMA,
      version: PACKAGE_VERSION_SCHEMA,
      digest: DIGEST_SCHEMA,
      registry: REGISTRY_SCHEMA,
      dependencyClosure: {
        type: "array", maxItems: 512,
        items: {
          type: "object", required: ["name", "version", "digest"], additionalProperties: false,
          properties: { name: PACKAGE_NAME_SCHEMA, version: PACKAGE_VERSION_SCHEMA, digest: DIGEST_SCHEMA },
        },
      },
      allowLifecycleScripts: { type: "boolean" },
    },
  },
} as const;

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
    : provider === "local_vm"
      ? confinementClass === "unverified_vm"
      : confinementClass === "unverified_vm" || confinementClass === "strict_vm";
  if (!valid) invalid("confinementClass", "contradicts provider assurance class");
}

export function validateIdempotencyKey(value: unknown): string {
  if (typeof value !== "string" || value.length < 8 || value.length > 128 || !new RegExp(IDEMPOTENCY_KEY_PATTERN).test(value)) {
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

function validateCanonicalRegistry(value: unknown, reject: () => never): string {
  if (typeof value !== "string" || value.length > 512 || !REGISTRY.test(value)) reject();
  const withoutScheme = value.slice("https://".length);
  const hostnameEnd = withoutScheme.search(/[:/]/);
  const hostname = hostnameEnd === -1 ? withoutScheme : withoutScheme.slice(0, hostnameEnd);
  if (hostname.length > MAX_REGISTRY_HOSTNAME_LENGTH) reject();
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
  const registry = validateCanonicalRegistry(item.registry, () => invalid(
    "spec.registry", "must be a canonical, credential-free, query-free, fragment-free lowercase HTTPS URL",
  ));
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
    registry,
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
          || !INSTALL_POLICY_PACKAGE.test(item))) invalidPolicy("invalid package patterns");
      result.packagePatterns = rule.packagePatterns as string[];
    }
    if (rule.registries !== undefined) {
      if (!Array.isArray(rule.registries) || rule.registries.length < 1 || rule.registries.length > 32 || new Set(rule.registries).size !== rule.registries.length) invalidPolicy("invalid registries");
      const registries = rule.registries.map((item) => validateCanonicalRegistry(item, () => invalidPolicy("invalid registry")));
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
