import { ValidationError } from "../types/index.js";
import { validateSecretRef } from "../services/secret-boundary.js";

export const NPM_TOKEN_PERMISSIONS = ["read-only", "read-write"] as const;
export type NpmTokenPermission = (typeof NPM_TOKEN_PERMISSIONS)[number];

export const NPM_TOKEN_PURPOSES = ["install", "publish", "stage", "access"] as const;
export type NpmTokenPurpose = (typeof NPM_TOKEN_PURPOSES)[number];

export const NPM_TOKEN_MAX_TTL_DAYS = 30;

export interface NpmTokenNameParts {
  org: string;
  scope: string;
  packageName?: string | null;
  station?: string | null;
  ci?: string | null;
  use: string;
  permission: string;
  expiry: string | Date;
  revision: string | number;
}

export interface NpmTokenRequestPayload {
  org: string;
  scope?: string;
  packageName?: string;
  principal: string;
  station?: string;
  ci?: string;
  purpose: NpmTokenPurpose;
  permission: NpmTokenPermission;
  expiry: string;
  revision: string | number;
  secretRef: string;
  bypass2fa?: boolean;
  registry?: string;
}

export interface ValidatedNpmTokenRequest {
  provider: "npm";
  requestType: "npm-token";
  org: string;
  scope: string;
  packageName?: string;
  principal: string;
  station?: string;
  ci?: string;
  purpose: NpmTokenPurpose;
  permission: NpmTokenPermission;
  expiresAt: string;
  expiresInDays: number;
  revision: string;
  secretRef: string;
  bypass2fa: boolean;
  registry?: string;
  name: string;
  description: string;
}

export interface NpmTokenCommandPreview {
  command: "npm";
  args: string[];
  shell: string;
  safeToLog: true;
  target: {
    scopes: string[];
    packages: string[];
  };
  metadata: NpmTokenAccessMetadata;
  secretsHandoff: OpenSecretsHandoff;
}

export interface NpmTokenAccessMetadata {
  provider: "npm";
  requestType: "npm-token";
  tokenName: string;
  org: string;
  scope: string;
  packageName?: string;
  principal: string;
  station?: string;
  ci?: string;
  purpose: NpmTokenPurpose;
  permission: NpmTokenPermission;
  expiresAt: string;
  expiresInDays: number;
  revision: string;
  bypass2fa: boolean;
}

/**
 * Handoff contract for open-secrets/@hasna/secrets: access keeps only the
 * reference plus metadata. The one-time npm token value must be written by an
 * explicit operator action or secured process outside access logs/storage.
 */
export interface OpenSecretsHandoff {
  system: "@hasna/secrets";
  secretRef: string;
  metadata: NpmTokenAccessMetadata;
  accessStores: "secretRef-and-metadata-only";
  tokenValueHandling: "operator-or-secured-process";
  operatorCommand: {
    command: "secrets";
    args: string[];
    shell: string;
  };
  instructions: string;
}

export interface NpmTokenPreviewOptions {
  now?: Date;
}

export interface NpmTokenApprovedAccessRequest {
  id?: string;
  provider: string;
  resource_kind: string;
  resource_ref?: string;
  status: string;
  secret_ref: string;
}

export interface NpmTokenProvisionPlanOptions extends NpmTokenPreviewOptions {
  execute?: boolean;
  approvedRequest?: NpmTokenApprovedAccessRequest;
}

export interface NpmTokenProvisionPlan {
  mode: "preview" | "approved-manual";
  execute: boolean;
  preview: NpmTokenCommandPreview;
  approvedRequestId?: string;
  message: string;
}

const NPM_SCOPE = /^@[a-z0-9][a-z0-9._-]*$/;
const NPM_PACKAGE_PART = /^[a-z0-9][a-z0-9._~-]*$/;
const IDENTIFIER = /^[a-zA-Z0-9][a-zA-Z0-9._:@/-]*$/;
const DAY_MS = 86_400_000;

export function buildNpmTokenName(parts: NpmTokenNameParts): string {
  return [
    "npm",
    "org",
    slugPart(parts.org, "org"),
    "scope",
    slugPart(parts.scope, "scope"),
    "pkg",
    slugPart(parts.packageName ?? "all", "packageName"),
    "station",
    slugPart(parts.station ?? "none", "station"),
    "ci",
    slugPart(parts.ci ?? "none", "ci"),
    "use",
    slugPart(parts.use, "use"),
    "perm",
    slugPart(parts.permission, "permission"),
    "exp",
    expirySegment(parts.expiry),
    "rev",
    slugPart(String(parts.revision), "revision"),
  ].join("-");
}

export function validateNpmTokenRequestPayload(
  input: NpmTokenRequestPayload,
  options: NpmTokenPreviewOptions = {},
): ValidatedNpmTokenRequest {
  const now = options.now ?? new Date();
  const org = normalizeOrg(input.org);
  const packageName = input.packageName?.trim() ? input.packageName.trim() : undefined;
  const explicitScope = input.scope?.trim() ? input.scope.trim() : undefined;

  if (!explicitScope && !packageName) {
    throw new ValidationError("npm-token request requires a target scope or packageName.");
  }

  const normalizedPackage = packageName ? normalizePackageName(packageName, explicitScope, org) : undefined;
  const scope = normalizeScope(explicitScope ?? packageScope(normalizedPackage) ?? `@${org}`, org);
  if (normalizedPackage && packageScope(normalizedPackage) !== scope) {
    throw new ValidationError("packageName scope must match the requested scope.");
  }

  const permission = oneOf(input.permission, NPM_TOKEN_PERMISSIONS, "permission");
  const purpose = oneOf(input.purpose, NPM_TOKEN_PURPOSES, "purpose");
  const principal = cleanIdentifier(input.principal, "principal");
  const station = optionalIdentifier(input.station, "station");
  const ci = optionalIdentifier(input.ci, "ci");
  if (Boolean(station) === Boolean(ci)) {
    throw new ValidationError("npm-token request requires exactly one of station or ci.");
  }

  const expiry = parseFutureExpiry(input.expiry, now);
  if (expiry.expiresInDays > NPM_TOKEN_MAX_TTL_DAYS) {
    throw new ValidationError(`npm-token expiry must be ${NPM_TOKEN_MAX_TTL_DAYS} days or less.`);
  }
  if (permission === "read-write" && !normalizedPackage) {
    throw new ValidationError("read-write npm-token requests must target a single package.");
  }
  if ((purpose === "publish" || purpose === "stage") && !normalizedPackage) {
    throw new ValidationError(`${purpose} npm-token requests must target a single package.`);
  }
  const revision = cleanIdentifier(String(input.revision), "revision");
  const secretRef = validateSecretRef(input.secretRef, "secretRef");
  const registry = input.registry?.trim() ? validateRegistry(input.registry.trim()) : undefined;
  const bypass2fa = Boolean(input.bypass2fa);

  const name = buildNpmTokenName({
    org,
    scope,
    packageName: normalizedPackage,
    station,
    ci,
    use: purpose,
    permission,
    expiry: expiry.date,
    revision,
  });
  const description = buildDescription({
    provider: "npm",
    requestType: "npm-token",
    org,
    scope,
    packageName: normalizedPackage,
    principal,
    station,
    ci,
    purpose,
    permission,
    expiresAt: expiry.expiresAt,
    expiresInDays: expiry.expiresInDays,
    revision,
    secretRef,
    bypass2fa,
    ...(registry ? { registry } : {}),
    name,
    description: "",
  });

  return {
    provider: "npm",
    requestType: "npm-token",
    org,
    scope,
    ...(normalizedPackage ? { packageName: normalizedPackage } : {}),
    principal,
    ...(station ? { station } : {}),
    ...(ci ? { ci } : {}),
    purpose,
    permission,
    expiresAt: expiry.expiresAt,
    expiresInDays: expiry.expiresInDays,
    revision,
    secretRef,
    bypass2fa,
    ...(registry ? { registry } : {}),
    name,
    description,
  };
}

export function buildNpmTokenCreateCommandPreview(
  input: NpmTokenRequestPayload | ValidatedNpmTokenRequest,
  options: NpmTokenPreviewOptions = {},
): NpmTokenCommandPreview {
  const request = isValidatedRequest(input) ? input : validateNpmTokenRequestPayload(input, options);
  const args = [
    "token",
    "create",
    "--name",
    request.name,
    "--token-description",
    request.description,
    "--expires",
    String(request.expiresInDays),
  ];

  const packages = request.packageName ? [request.packageName] : [];
  const scopes = packages.length === 0 ? [request.scope] : [];
  for (const scope of scopes) {
    args.push("--scopes", scope);
  }
  for (const packageName of packages) {
    args.push("--packages", packageName);
  }
  args.push("--packages-and-scopes-permission", request.permission);
  if (request.bypass2fa) {
    args.push("--bypass-2fa");
  }
  if (request.registry) {
    args.push("--registry", request.registry);
  }

  const metadata = toAccessMetadata(request);
  return {
    command: "npm",
    args,
    shell: renderShellCommand("npm", args),
    safeToLog: true,
    target: { scopes, packages },
    metadata,
    secretsHandoff: buildOpenSecretsHandoff(request, metadata),
  };
}

export function planNpmTokenProvision(
  input: NpmTokenRequestPayload | ValidatedNpmTokenRequest,
  options: NpmTokenProvisionPlanOptions = {},
): NpmTokenProvisionPlan {
  const request = isValidatedRequest(input) ? input : validateNpmTokenRequestPayload(input, options);
  const preview = buildNpmTokenCreateCommandPreview(request, options);
  if (!options.execute) {
    return {
      mode: "preview",
      execute: false,
      preview,
      message: "Preview only; access does not create provider tokens without an approved access request.",
    };
  }

  assertApprovedAccessRequest(request, options.approvedRequest);
  return {
    mode: "approved-manual",
    execute: true,
    preview,
    ...(options.approvedRequest?.id ? { approvedRequestId: options.approvedRequest.id } : {}),
    message:
      "Approved request matched. access still returns a command preview and open-secrets handoff; the token value must be created and stored by a secured operator/provider process.",
  };
}

export function buildOpenSecretsHandoff(
  request: ValidatedNpmTokenRequest,
  metadata: NpmTokenAccessMetadata = toAccessMetadata(request),
): OpenSecretsHandoff {
  return {
    system: "@hasna/secrets",
    secretRef: request.secretRef,
    metadata,
    accessStores: "secretRef-and-metadata-only",
    tokenValueHandling: "operator-or-secured-process",
    operatorCommand: {
      command: "secrets",
      args: ["set", request.secretRef],
      shell: renderShellCommand("secrets", ["set", request.secretRef]),
    },
    instructions:
      "Run npm token create interactively or inside a secured process, then write the one-time token value with secrets set. access records only this secretRef plus metadata.",
  };
}

function toAccessMetadata(request: ValidatedNpmTokenRequest): NpmTokenAccessMetadata {
  return {
    provider: "npm",
    requestType: "npm-token",
    tokenName: request.name,
    org: request.org,
    scope: request.scope,
    ...(request.packageName ? { packageName: request.packageName } : {}),
    principal: request.principal,
    ...(request.station ? { station: request.station } : {}),
    ...(request.ci ? { ci: request.ci } : {}),
    purpose: request.purpose,
    permission: request.permission,
    expiresAt: request.expiresAt,
    expiresInDays: request.expiresInDays,
    revision: request.revision,
    bypass2fa: request.bypass2fa,
  };
}

function isValidatedRequest(input: NpmTokenRequestPayload | ValidatedNpmTokenRequest): input is ValidatedNpmTokenRequest {
  return "provider" in input && input.provider === "npm" && "requestType" in input && input.requestType === "npm-token";
}

function normalizeOrg(value: string): string {
  const org = value?.trim().replace(/^@/, "").toLowerCase();
  if (!org || !NPM_PACKAGE_PART.test(org)) {
    throw new ValidationError("org must be an npm organization slug.");
  }
  return org;
}

function normalizeScope(value: string, org: string): string {
  const scope = value.trim().startsWith("@") ? value.trim().toLowerCase() : `@${value.trim().toLowerCase()}`;
  if (!NPM_SCOPE.test(scope)) {
    throw new ValidationError("scope must be an npm scope like @hasna.");
  }
  if (scope.slice(1) !== org) {
    throw new ValidationError("scope must match org.");
  }
  return scope;
}

function normalizePackageName(value: string, scope: string | undefined, org: string): string {
  const packageName = value.trim().toLowerCase();
  if (packageName.startsWith("@")) {
    const parts = packageName.split("/");
    const packageScopePart = parts[0];
    const packageSlug = parts[1];
    if (parts.length !== 2 || !packageScopePart || !packageSlug) {
      throw new ValidationError("packageName must be an npm package name like @hasna/access.");
    }
    const normalizedScope = normalizeScope(packageScopePart, org);
    if (scope && normalizeScope(scope, org) !== normalizedScope) {
      throw new ValidationError("packageName scope must match the requested scope.");
    }
    validatePackagePart(packageSlug);
    return `${normalizedScope}/${packageSlug}`;
  }

  validatePackagePart(packageName);
  const normalizedScope = normalizeScope(scope ?? `@${org}`, org);
  return `${normalizedScope}/${packageName}`;
}

function validatePackagePart(value: string): void {
  if (!NPM_PACKAGE_PART.test(value)) {
    throw new ValidationError("packageName must be an npm package slug.");
  }
}

function packageScope(packageName: string | undefined): string | undefined {
  if (!packageName?.startsWith("@")) return undefined;
  const [scope] = packageName.split("/");
  return scope;
}

function oneOf<T extends string>(value: T, allowed: readonly T[], field: string): T {
  if (!allowed.includes(value)) {
    throw new ValidationError(`${field} must be one of: ${allowed.join(", ")}.`);
  }
  return value;
}

function cleanIdentifier(value: string, field: string): string {
  const cleaned = value?.trim();
  if (!cleaned || cleaned.length > 128 || !IDENTIFIER.test(cleaned)) {
    throw new ValidationError(`${field} must be a non-empty identifier without whitespace.`);
  }
  return cleaned;
}

function optionalIdentifier(value: string | undefined, field: string): string | undefined {
  return value?.trim() ? cleanIdentifier(value, field) : undefined;
}

function parseFutureExpiry(value: string, now: Date): { date: Date; expiresAt: string; expiresInDays: number } {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ValidationError("expiry must be an ISO date or timestamp.");
  }
  const deltaMs = date.getTime() - now.getTime();
  if (deltaMs <= 0) {
    throw new ValidationError("expiry must be in the future.");
  }
  return {
    date,
    expiresAt: date.toISOString(),
    expiresInDays: Math.ceil(deltaMs / DAY_MS),
  };
}

function validateRegistry(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new ValidationError("registry must be an http(s) URL.");
    }
    return url.toString();
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw new ValidationError("registry must be an http(s) URL.");
  }
}

function buildDescription(request: ValidatedNpmTokenRequest): string {
  const target = request.packageName ? `package=${request.packageName}` : `scope=${request.scope}`;
  const principalContext = request.station ? `station=${request.station}` : `ci=${request.ci}`;
  return [
    "access npm token",
    `purpose=${request.purpose}`,
    `permission=${request.permission}`,
    target,
    `principal=${request.principal}`,
    principalContext,
    `rev=${request.revision}`,
  ].join("; ");
}

function assertApprovedAccessRequest(request: ValidatedNpmTokenRequest, accessRequest: NpmTokenApprovedAccessRequest | undefined): void {
  if (!accessRequest) {
    throw new ValidationError("execute requires an approved access request.");
  }
  if (accessRequest.status !== "approved") {
    throw new ValidationError("execute requires an approved access request.");
  }
  if (accessRequest.provider !== "npm") {
    throw new ValidationError("approved access request provider must be npm.");
  }
  if (accessRequest.resource_kind !== "token" && accessRequest.resource_kind !== "npm-token") {
    throw new ValidationError("approved access request resource_kind must be token or npm-token.");
  }
  if (accessRequest.secret_ref !== request.secretRef) {
    throw new ValidationError("approved access request secret_ref must match the npm-token request secretRef.");
  }
  if (accessRequest.resource_ref) {
    const target = request.packageName ?? request.scope;
    const allowedRefs = new Set([target, `npm:${target}`]);
    if (!allowedRefs.has(accessRequest.resource_ref)) {
      throw new ValidationError("approved access request resource_ref must match the bounded npm-token target.");
    }
  }
}

function expirySegment(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ValidationError("expiry must be an ISO date or timestamp.");
  }
  return date.toISOString().slice(0, 10).replaceAll("-", "");
}

function slugPart(value: string, field: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/^@/, "")
    .replaceAll("/", "-")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (!slug) {
    throw new ValidationError(`${field} must contain at least one slug-safe character.`);
  }
  return slug;
}

function renderShellCommand(command: string, args: string[]): string {
  return [command, ...args].map(shellQuote).join(" ");
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_/:=.,@%+-]+$/.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}
