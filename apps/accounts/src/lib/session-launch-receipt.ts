import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

import { AccountsError } from "../types.js";

/**
 * This is the Accounts-side admission contract for an Instructions-rendered
 * launch. The tool runtime owns the final session receipt; Accounts owns the
 * pre-launch target, adapter, and provenance checks.
 */
export const SESSION_LAUNCH_RECEIPT_SCHEMA =
  "hasna.accounts.session-launch-receipt/v1" as const;
export const SESSION_RENDER_MANIFEST_SCHEMA =
  "hasna.configs.session-render/v1" as const;
export const SESSION_RENDER_MANIFEST_RELATIVE_PATH =
  ".hasna/session-render-manifest.json" as const;
export const SESSION_LAUNCH_RECEIPT_MISMATCH = "session_launch_receipt_mismatch" as const;

const SHA256 = /^[a-f0-9]{64}$/;
const MAX_IDENTIFIER_BYTES = 1024;
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const MAX_SOURCES = 256;
const MAX_FILES = 512;
const MAX_RULES_PER_SOURCE = 256;
const MAX_CAPABILITIES = 64;
const SESSION_RENDERER_OWNER_ID = "instructions-session-renderer";

export const SESSION_LAUNCH_ADAPTERS = [
  "native-imports",
  "flattened-markdown",
  "cursor-mdc",
  "opencode-instructions",
  "antigravity-rules",
] as const;

export type SessionLaunchAdapter = (typeof SESSION_LAUNCH_ADAPTERS)[number];
export type SessionLaunchTool =
  | "claude"
  | "codex"
  | "cursor"
  | "opencode"
  | "codewith"
  | "qwen"
  | "aicopilot"
  | "antigravity";
export type SessionLaunchTargetKind = "session-home" | "project-root";

export type SessionLaunchCapabilityStatus =
  | "supported"
  | "unsupported_unknown"
  | "unavailable";

export interface SessionLaunchCapabilityRequest {
  name: string;
  required: boolean;
}

export interface SessionLaunchCapabilityReceipt extends SessionLaunchCapabilityRequest {
  status: SessionLaunchCapabilityStatus;
  reason?: string;
}

export interface SessionLaunchRoute {
  tool: SessionLaunchTool;
  profile: string;
  model: string;
  provider: string;
  reasoningEffort: string | null;
  serviceTier: string | null;
  profileIdentitySha256: string;
  permissionProfileSha256: string;
}

export interface SessionLaunchRuntimeReceipt {
  packageName: string;
  packageVersion: string;
  runtime: string;
}

export interface SessionLaunchTarget {
  tool: SessionLaunchTool;
  profile: string;
  targetHome: string;
  targetKind: SessionLaunchTargetKind;
  adapter: SessionLaunchAdapter;
}

export interface SessionInstructionsFileReceipt {
  relativePath: string;
  role: string;
  sha256: string;
  sourceIds: string[];
}

export interface SessionInstructionsRuleReceipt {
  id: string;
  label: string;
  contentSha256: string;
  flooredFromRulesVersionSha256?: string;
  flooredFromPayloadSha256?: string;
  payloadIntegritySha256?: string;
}

export interface SessionInstructionsSourceReceipt {
  id: string;
  label: string;
  layer: string;
  merge: string;
  order: number;
  renderedPayloadSha256: string;
  provenanceSha256?: string;
  metadataSha256?: string;
  replacementScopeSha256?: string;
  rules: SessionInstructionsRuleReceipt[];
}

export interface SessionInstructionsReceipt {
  schema: typeof SESSION_RENDER_MANIFEST_SCHEMA;
  adapter: SessionLaunchAdapter;
  manifestSha256: string;
  sourceHash: string;
  profileSha256: string;
  targetHomeSha256: string;
  targetOwnerSha256: string;
  sourceIds: string[];
  sources: SessionInstructionsSourceReceipt[];
  files: SessionInstructionsFileReceipt[];
}

export interface SessionLaunchReceipt {
  schema: typeof SESSION_LAUNCH_RECEIPT_SCHEMA;
  target: SessionLaunchTarget;
  requested: SessionLaunchRoute;
  effective: SessionLaunchRoute;
  mismatches: string[];
  capabilities: SessionLaunchCapabilityReceipt[];
  instructions: SessionInstructionsReceipt;
  runtime: SessionLaunchRuntimeReceipt;
}

export interface SessionLaunchReceiptRequest {
  target: SessionLaunchTarget;
  requested: SessionLaunchRoute;
  runtime: SessionLaunchRuntimeReceipt;
  capabilityRequests?: SessionLaunchCapabilityRequest[];
  availableCapabilities?: readonly string[];
}

export interface PreparedSessionLaunchReceipt {
  request: SessionLaunchReceiptRequest;
  instructions: SessionInstructionsReceipt;
  capabilities: SessionLaunchCapabilityReceipt[];
}

type ManifestRecord = Record<string, unknown>;

const EXPECTED_ADAPTERS: Readonly<Record<SessionLaunchTool, SessionLaunchAdapter[]>> = {
  claude: ["native-imports"],
  codex: ["flattened-markdown"],
  cursor: ["cursor-mdc"],
  opencode: ["opencode-instructions"],
  codewith: ["native-imports", "flattened-markdown"],
  qwen: ["flattened-markdown"],
  aicopilot: ["flattened-markdown"],
  antigravity: ["antigravity-rules"],
};

function mismatch(message: string): never {
  throw new AccountsError(`${SESSION_LAUNCH_RECEIPT_MISMATCH}: ${message}`);
}

function asRecord(value: unknown): ManifestRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as ManifestRecord)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function requiredString(record: ManifestRecord, field: string): string {
  const value = stringValue(record[field]);
  if (!value) mismatch(`manifest ${field} is missing`);
  return value;
}

function validateIdentifier(field: string, value: string): void {
  if (
    value.length === 0 ||
    value.length > MAX_IDENTIFIER_BYTES ||
    value.includes("\0") ||
    [...value].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < 0x20 || code === 0x7f;
    })
  ) {
    mismatch(`${field} is empty or exceeds its bound`);
  }
}

function validateSha256(field: string, value: string): void {
  if (!SHA256.test(value)) mismatch(`${field} is not a lowercase SHA-256 digest`);
}

function canonicalize(value: unknown): string {
  if (value === undefined || typeof value === "function" || typeof value === "symbol") {
    mismatch("cannot canonicalize an unsupported JSON value");
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    mismatch("cannot canonicalize a non-finite JSON number");
  }
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
    .join(",")}}`;
}

export function sessionLaunchSha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function sessionLaunchJsonSha256(value: unknown): string {
  return sessionLaunchSha256(canonicalize(value));
}

export function sessionLaunchProfileSha256(profile: string): string {
  validateIdentifier("profile", profile);
  return sessionLaunchSha256(profile);
}

function adapterForManifest(tool: SessionLaunchTool, value: string): SessionLaunchAdapter {
  if (!SESSION_LAUNCH_ADAPTERS.includes(value as SessionLaunchAdapter)) {
    mismatch(`unsupported Instructions adapter "${value}"`);
  }
  const adapter = value as SessionLaunchAdapter;
  if (!EXPECTED_ADAPTERS[tool].includes(adapter)) {
    mismatch(`adapter "${adapter}" is not supported for ${tool}`);
  }
  return adapter;
}

function isSessionLaunchTool(value: unknown): value is SessionLaunchTool {
  return [
    "claude",
    "codex",
    "cursor",
    "opencode",
    "codewith",
    "qwen",
    "aicopilot",
    "antigravity",
  ].includes(value as SessionLaunchTool);
}

function isSessionLaunchTargetKind(value: unknown): value is SessionLaunchTargetKind {
  return value === "session-home" || value === "project-root";
}

function validateTarget(target: SessionLaunchTarget): void {
  if (!isSessionLaunchTool(target.tool)) mismatch("target tool is unsupported");
  if (!isSessionLaunchTargetKind(target.targetKind)) mismatch("target kind is unsupported");
  validateIdentifier("target tool", target.tool);
  validateIdentifier("target profile", target.profile);
  validateIdentifier("target home", target.targetHome);
  if (!isAbsolute(target.targetHome)) mismatch("target home must be absolute");
  if (!EXPECTED_ADAPTERS[target.tool].includes(target.adapter)) {
    mismatch(`requested adapter "${target.adapter}" is not supported for ${target.tool}`);
  }
  if (target.tool === "antigravity" && target.targetKind !== "project-root") {
    mismatch("Antigravity rules require a project-root target");
  }
}

function validateRoute(route: SessionLaunchRoute, label: string): void {
  if (!isSessionLaunchTool(route.tool)) mismatch(`${label} tool is unsupported`);
  for (const [field, value] of [
    ["tool", route.tool],
    ["profile", route.profile],
    ["model", route.model],
    ["provider", route.provider],
    ["profile identity digest", route.profileIdentitySha256],
    ["permission profile digest", route.permissionProfileSha256],
  ] as const) {
    validateIdentifier(`${label} ${field}`, value);
  }
  for (const [field, value] of [
    ["reasoning effort", route.reasoningEffort],
    ["service tier", route.serviceTier],
  ] as const) {
    if (value !== null) validateIdentifier(`${label} ${field}`, value);
  }
  validateSha256(`${label} profile identity digest`, route.profileIdentitySha256);
  validateSha256(`${label} permission profile digest`, route.permissionProfileSha256);
}

function validateRuntime(runtime: SessionLaunchRuntimeReceipt): void {
  validateIdentifier("runtime package name", runtime.packageName);
  validateIdentifier("runtime package version", runtime.packageVersion);
  validateIdentifier("runtime", runtime.runtime);
}

function resolveCapabilities(
  requests: readonly SessionLaunchCapabilityRequest[],
  available: readonly string[],
): SessionLaunchCapabilityReceipt[] {
  if (requests.length > MAX_CAPABILITIES) {
    mismatch("launch capability declarations exceed the bounded count");
  }
  const seen = new Set<string>();
  const availableSet = new Set(available);
  const knownCapabilities = new Set([
    "durable_launch_receipt_v1",
    "background_agent_thread",
    "instructions_manifest_v1",
    "workflow_route_attestation",
    "auth_profile_binding",
    "restart_stable_account_binding",
  ]);
  return requests.map((request) => {
    validateIdentifier("capability name", request.name);
    if (seen.has(request.name)) mismatch("duplicate launch capability declaration");
    seen.add(request.name);
    const known = knownCapabilities.has(request.name);
    const status: SessionLaunchCapabilityStatus = known
      ? (availableSet.has(request.name) ? "supported" : "unavailable")
      : "unsupported_unknown";
    const reason =
      status === "supported"
        ? undefined
        : status === "unsupported_unknown"
          ? "unknown_optional_capability"
          : "capability_unavailable_for_launch";
    if (request.required && status !== "supported") {
      mismatch(`required capability "${request.name}" is not supported`);
    }
    return { ...request, status, ...(reason ? { reason } : {}) };
  });
}

function safeRelativePath(targetHome: string, value: string): string {
  if (
    value.length === 0 ||
    value.includes("\0") ||
    value.includes("\\") ||
    isAbsolute(value)
  ) {
    mismatch("manifest file has an unsafe relative path");
  }
  const absolute = resolve(targetHome, value);
  const rel = relative(resolve(targetHome), absolute);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
    mismatch("manifest file escapes target home");
  }
  return rel;
}

function canonicalPath(field: string, value: string): string {
  try {
    return realpathSync(value);
  } catch {
    mismatch(`${field} cannot be resolved`);
  }
}

function isWithinPath(child: string, parent: string): boolean {
  return child === parent || child.startsWith(`${parent.endsWith("/") ? parent : `${parent}/`}`);
}

function validateTargetOwner(
  manifest: ManifestRecord,
  target: SessionLaunchTarget,
  canonicalTargetHome: string,
): string {
  const owner = asRecord(manifest.targetOwner);
  if (!owner) mismatch("Instructions target ownership is absent");
  const expectedKind = target.targetKind === "project-root" ? "project" : "provider-profile";
  if (
    owner.kind !== expectedKind ||
    owner.tool !== target.tool ||
    owner.profile !== target.profile ||
    canonicalPath("Instructions owner target home", requiredString(owner, "targetHome")) !== canonicalTargetHome ||
    owner.ownedBy !== "open-configs" ||
    owner.canonicalOwner !== "instructions"
  ) {
    mismatch("Instructions target ownership does not match the canonical writer");
  }
  const projectRoot = owner.projectRoot;
  if (
    target.targetKind === "project-root"
      ? typeof projectRoot !== "string" ||
        canonicalPath("Instructions owner project root", projectRoot) !== canonicalTargetHome
      : projectRoot !== null
  ) {
    mismatch("Instructions target ownership project root is inconsistent");
  }
  const writer = asRecord(owner.writer);
  if (
    !writer ||
    writer.id !== SESSION_RENDERER_OWNER_ID ||
    writer.canonical !== true ||
    !Array.isArray(writer.legacyAliases) ||
    writer.legacyAliases.length !== 1 ||
    writer.legacyAliases[0] !== "open-configs" ||
    writer.scope !==
      (target.tool === "opencode" ? "managed-instruction-fields" : "managed-provider-files")
  ) {
    mismatch("Instructions target ownership writer is not canonical");
  }
  validateIdentifier("Instructions target owner reason", requiredString(owner, "reason"));
  return sessionLaunchJsonSha256(owner);
}

function parseSourceReceipt(
  source: ManifestRecord,
  knownFileSourceIds: Set<string>,
): SessionInstructionsSourceReceipt {
  const id = requiredString(source, "id");
  const label = requiredString(source, "label");
  const layer = requiredString(source, "layer");
  const merge = requiredString(source, "merge");
  const order = source.order;
  if (typeof order !== "number" || !Number.isSafeInteger(order)) {
    mismatch(`Instructions source "${id}" has an invalid order`);
  }
  const renderedPayloadSha256 = requiredString(source, "renderedPayloadSha256");
  validateIdentifier("Instructions source id", id);
  validateIdentifier("Instructions source label", label);
  validateIdentifier("Instructions source layer", layer);
  validateIdentifier("Instructions source merge", merge);
  validateSha256("Instructions rendered payload digest", renderedPayloadSha256);
  if (!knownFileSourceIds.add(id)) {
    mismatch("Instructions manifest contains an ambiguous source or rule id");
  }

  const rules = source.rules;
  if (!Array.isArray(rules) || rules.length > MAX_RULES_PER_SOURCE) {
    mismatch(`Instructions source "${id}" rules are missing or exceed their bound`);
  }
  const ruleReceipts: SessionInstructionsRuleReceipt[] = [];
  for (const rawRule of rules) {
    const rule = asRecord(rawRule) ?? mismatch("invalid Instructions rule entry");
    const ruleId = requiredString(rule, "id");
    const ruleLabel = requiredString(rule, "label");
    const contentSha256 = requiredString(rule, "contentSha256");
    validateIdentifier("Instructions rule id", ruleId);
    validateIdentifier("Instructions rule label", ruleLabel);
    validateSha256("Instructions rule content digest", contentSha256);
    if (!knownFileSourceIds.add(ruleId)) {
      mismatch("Instructions manifest contains an ambiguous source or rule id");
    }
    const flooredFromRulesVersion = stringValue(rule.flooredFromRulesVersion);
    const flooredFromPayload = stringValue(rule.flooredFromPayloadSha256);
    if (flooredFromPayload) validateSha256("Instructions rule floor digest", flooredFromPayload);
    const payloadIntegrity = rule.payloadIntegrity;
    ruleReceipts.push({
      id: ruleId,
      label: ruleLabel,
      contentSha256,
      ...(flooredFromRulesVersion
        ? { flooredFromRulesVersionSha256: sessionLaunchSha256(flooredFromRulesVersion) }
        : {}),
      ...(flooredFromPayload
        ? { flooredFromPayloadSha256: flooredFromPayload }
        : {}),
      ...(payloadIntegrity !== undefined && payloadIntegrity !== null
        ? { payloadIntegritySha256: sessionLaunchJsonSha256(payloadIntegrity) }
        : {}),
    });
  }
  const replacementScope = stringValue(source.replacementScope);
  return {
    id,
    label,
    layer,
    merge,
    order,
    renderedPayloadSha256,
    ...(source.provenance !== undefined && source.provenance !== null
      ? { provenanceSha256: sessionLaunchJsonSha256(source.provenance) }
      : {}),
    ...(source.metadata !== undefined && source.metadata !== null
      ? { metadataSha256: sessionLaunchJsonSha256(source.metadata) }
      : {}),
    ...(replacementScope
      ? { replacementScopeSha256: sessionLaunchSha256(replacementScope) }
      : {}),
    rules: ruleReceipts,
  };
}

function readManifest(target: SessionLaunchTarget): SessionInstructionsReceipt {
  const targetHome = resolve(target.targetHome);
  const manifestPath = join(targetHome, SESSION_RENDER_MANIFEST_RELATIVE_PATH);
  if (!existsSync(manifestPath)) mismatch("Instructions manifest is absent");
  const canonicalTargetHome = canonicalPath("Instructions target home", targetHome);
  const canonicalManifestPath = canonicalPath("Instructions manifest", manifestPath);
  if (!isWithinPath(canonicalManifestPath, canonicalTargetHome)) {
    mismatch("Instructions manifest escapes target home");
  }
  const metadata = statSync(manifestPath);
  if (metadata.size > MAX_MANIFEST_BYTES) mismatch("Instructions manifest exceeds the bounded size");
  const raw = readFileSync(manifestPath);
  const manifestSha256 = sessionLaunchSha256(raw);
  let manifest: ManifestRecord;
  try {
    manifest = JSON.parse(raw.toString("utf8")) as ManifestRecord;
  } catch {
    mismatch("Instructions manifest is not valid JSON");
  }
  if (manifest.schema !== SESSION_RENDER_MANIFEST_SCHEMA) {
    mismatch("unsupported Instructions manifest schema");
  }
  if (manifest.tool !== target.tool) mismatch("manifest tool differs from requested target");
  if (manifest.profile !== target.profile) mismatch("manifest profile differs from requested target");
  if (canonicalPath("Instructions manifest target home", requiredString(manifest, "targetHome")) !== canonicalTargetHome) {
    mismatch("manifest target home differs from requested target");
  }
  if (manifest.targetKind !== target.targetKind) {
    mismatch("manifest target kind differs from requested target");
  }
  if (manifest.writable !== true || manifest.blocked === true) {
    mismatch("Instructions manifest is not writable and unblocked");
  }
  if (!Array.isArray(manifest.blockers) || manifest.blockers.length !== 0) {
    mismatch("Instructions manifest contains blockers");
  }
  const adapter = adapterForManifest(target.tool, requiredString(manifest, "adapterMode"));
  if (adapter !== target.adapter) mismatch("manifest adapter differs from requested target");
  const sourceHash = requiredString(manifest, "sourceHash");
  validateSha256("Instructions source hash", sourceHash);
  const targetOwnerSha256 = validateTargetOwner(manifest, target, canonicalTargetHome);

  const sources = manifest.sources;
  const files = manifest.files;
  if (!Array.isArray(sources) || sources.length > MAX_SOURCES) {
    mismatch("Instructions manifest sources are missing or exceed their bound");
  }
  if (!Array.isArray(files) || files.length > MAX_FILES) {
    mismatch("Instructions manifest files are missing or exceed their bound");
  }
  const knownFileSourceIds = new Set<string>();
  const sourceReceipts = sources.map((source) => {
    const record = asRecord(source) ?? mismatch("invalid Instructions source entry");
    return parseSourceReceipt(record, knownFileSourceIds);
  });
  const sourceIds = sourceReceipts.map((source) => source.id);
  if (sourceIds.length === 0 || files.length === 0) {
    mismatch("Instructions manifest contains no managed sources or files");
  }

  const knownFiles = new Set<string>();
  const referencedFileSourceIds = new Set<string>();
  const fileReceipts = files.map((file) => {
    const record = asRecord(file) ?? mismatch("invalid Instructions file entry");
    const relativePath = safeRelativePath(targetHome, requiredString(record, "relativePath"));
    const role = requiredString(record, "role");
    const sha256 = requiredString(record, "sha256");
    if (!knownFiles.add(relativePath)) mismatch("duplicate Instructions rendered file");
    validateIdentifier("Instructions file role", role);
    validateSha256("Instructions file digest", sha256);
    const declaredPath = requiredString(record, "path");
    const expectedPath = resolve(canonicalTargetHome, relativePath);
    if (canonicalPath("Instructions rendered file", declaredPath) !== canonicalPath("Instructions rendered file", expectedPath)) {
      mismatch("Instructions rendered file path differs from target-relative path");
    }
    if (!["index", "fragment", "rule", "config"].includes(role)) {
      mismatch("Instructions rendered file has an unsupported role");
    }
    const sourceIdsForFile = record.sourceIds;
    if (
      !Array.isArray(sourceIdsForFile) ||
      sourceIdsForFile.length === 0 ||
      new Set(sourceIdsForFile).size !== sourceIdsForFile.length ||
      sourceIdsForFile.some((id) => typeof id !== "string" || !knownFileSourceIds.has(id))
    ) {
      mismatch("Instructions file references an unknown source");
    }
    const normalizedSourceIds = sourceIdsForFile.map((id) => {
      if (typeof id !== "string") mismatch("Instructions file source id is not a string");
      referencedFileSourceIds.add(id);
      return id;
    });
    const path = join(canonicalTargetHome, relativePath);
    if (!existsSync(path)) mismatch(`managed file is missing: ${relativePath}`);
    const canonicalFile = canonicalPath("Instructions rendered file", path);
    if (!isWithinPath(canonicalFile, canonicalTargetHome)) {
      mismatch("Instructions rendered file escapes target home");
    }
    const actual = sessionLaunchSha256(readFileSync(canonicalFile));
    if (actual !== sha256) mismatch(`managed file digest does not match disk: ${relativePath}`);
    return {
      relativePath,
      role,
      sha256,
      sourceIds: normalizedSourceIds,
    };
  });
  if (
    referencedFileSourceIds.size !== knownFileSourceIds.size ||
    [...knownFileSourceIds].some((id) => !referencedFileSourceIds.has(id))
  ) {
    mismatch("Instructions manifest contains an unreferenced source or rule id");
  }

  return {
    schema: SESSION_RENDER_MANIFEST_SCHEMA,
    adapter,
    manifestSha256,
    sourceHash,
    profileSha256: sessionLaunchProfileSha256(target.profile),
    targetHomeSha256: sessionLaunchSha256(canonicalTargetHome),
    targetOwnerSha256,
    sourceIds,
    sources: sourceReceipts,
    files: fileReceipts,
  };
}

export function prepareSessionLaunchReceipt(
  request: SessionLaunchReceiptRequest,
): PreparedSessionLaunchReceipt {
  validateTarget(request.target);
  validateRoute(request.requested, "requested");
  validateRuntime(request.runtime);
  if (request.requested.tool !== request.target.tool) {
    mismatch("requested route tool differs from target");
  }
  if (request.requested.profile !== request.target.profile) {
    mismatch("requested route profile differs from target");
  }
  if (request.requested.profileIdentitySha256 !== sessionLaunchProfileSha256(request.target.profile)) {
    mismatch("requested route profile identity differs from target");
  }
  return {
    request: {
      target: { ...request.target },
      requested: { ...request.requested },
      runtime: { ...request.runtime },
      capabilityRequests: [...(request.capabilityRequests ?? [])],
      availableCapabilities: [...(request.availableCapabilities ?? [])],
    },
    instructions: readManifest(request.target),
    capabilities: resolveCapabilities(
      request.capabilityRequests ?? [],
      request.availableCapabilities ?? [],
    ),
  };
}

function routeMismatches(
  requested: SessionLaunchRoute,
  effective: SessionLaunchRoute,
): string[] {
  const fields: Array<keyof SessionLaunchRoute> = [
    "tool",
    "profile",
    "model",
    "provider",
    "reasoningEffort",
    "serviceTier",
    "profileIdentitySha256",
    "permissionProfileSha256",
  ];
  return fields.filter((field) => requested[field] !== effective[field]);
}

export function bindSessionLaunchReceipt(
  prepared: PreparedSessionLaunchReceipt,
  effective: SessionLaunchRoute,
): SessionLaunchReceipt {
  validateRoute(effective, "effective");
  const mismatches = routeMismatches(prepared.request.requested, effective);
  if (mismatches.length > 0) {
    mismatch(`effective route differs from requested route: ${mismatches.join(", ")}`);
  }
  if (effective.tool !== prepared.request.target.tool) {
    mismatch("effective route tool differs from target");
  }
  if (effective.profile !== prepared.request.target.profile) {
    mismatch("effective route profile differs from target");
  }
  return {
    schema: SESSION_LAUNCH_RECEIPT_SCHEMA,
    target: { ...prepared.request.target },
    requested: { ...prepared.request.requested },
    effective: { ...effective },
    mismatches,
    capabilities: prepared.capabilities.map((capability) => ({ ...capability })),
    instructions: {
      ...prepared.instructions,
      sourceIds: [...prepared.instructions.sourceIds],
      sources: prepared.instructions.sources.map((source) => ({
        ...source,
        rules: source.rules.map((rule) => ({ ...rule })),
      })),
      files: prepared.instructions.files.map((file) => ({
        ...file,
        sourceIds: [...file.sourceIds],
      })),
    },
    runtime: { ...prepared.request.runtime },
  };
}
