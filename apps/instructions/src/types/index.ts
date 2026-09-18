// Config kinds
export const CONFIG_KINDS = ["file", "reference"] as const;
export type ConfigKind = (typeof CONFIG_KINDS)[number];

// Config categories
export const CONFIG_CATEGORIES = [
  "agent",
  "rules",
  "mcp",
  "shell",
  "secrets_schema",
  "workspace",
  "git",
  "tools",
] as const;
export type ConfigCategory = (typeof CONFIG_CATEGORIES)[number];

// Config agents
export const CONFIG_AGENTS = [
  "claude",
  "codex",
  "opencode",
  "sumi",
  "cursor",
  "codewith",
  "aicopilot",
  "antigravity",
  "qwen",
  "grok",
  "copilot",
  "devin",
  "windsurf-legacy",
  "cline",
  "zsh",
  "git",
  "npm",
  "global",
] as const;
export type ConfigAgent = (typeof CONFIG_AGENTS)[number];

// Transform names used when a canonical config fans out to agent-specific files.
export const CONFIG_TRANSFORMS = [
  "passthrough",
  "claude-passthrough",
  "codex-flat",
  "opencode-flat",
  "sumi-flat",
  "cursor-mdc",
  "skill-neutral",
] as const;
export type ConfigTransform = (typeof CONFIG_TRANSFORMS)[number];

export interface ConfigOutput {
  agent: ConfigAgent;
  target_path: string;
  transform: ConfigTransform;
}

// Config formats
export const CONFIG_FORMATS = [
  "text",
  "json",
  "toml",
  "yaml",
  "markdown",
  "ini",
] as const;
export type ConfigFormat = (typeof CONFIG_FORMATS)[number];

// Core config entity
export interface Config {
  id: string;
  name: string;
  slug: string;
  kind: ConfigKind;
  category: ConfigCategory;
  agent: ConfigAgent;
  target_path: string | null; // null for reference kind
  outputs: ConfigOutput[];
  format: ConfigFormat;
  content: string;
  description: string | null;
  tags: string[];
  is_template: boolean;
  version: number;
  created_at: string;
  updated_at: string;
  synced_at: string | null;
}

/** Content-free collection projection used by CLI, MCP, and `/v1?view=summary`. */
export interface ConfigSummary {
  id: string;
  slug: string;
  name: string;
  category: ConfigCategory;
  agent: ConfigAgent;
  kind: ConfigKind;
  format: ConfigFormat;
  target_path: string | null;
  output_count: number;
  version: number;
  is_template: boolean;
  updated_at?: string;
  description?: string | null;
  tags?: string[];
  outputs?: ConfigOutput[];
}

/** Smallest content-free config projection for agent-facing collection reads. */
export interface ConfigIdentity {
  id: string;
  name: string;
  slug: string;
  kind: ConfigKind;
  category: ConfigCategory;
  agent: ConfigAgent;
  format: ConfigFormat;
  is_template: boolean;
  version: number;
  created_at: string;
  updated_at: string;
  synced_at: string | null;
}

// Raw DB row (tags as JSON string)
export interface ConfigRow {
  id: string;
  name: string;
  slug: string;
  kind: string;
  category: string;
  agent: string;
  target_path: string | null;
  outputs: string;
  format: string;
  content: string;
  description: string | null;
  tags: string;
  is_template: number;
  version: number;
  created_at: string;
  updated_at: string;
  synced_at: string | null;
}

export interface CreateConfigInput {
  name: string;
  kind?: ConfigKind;
  category: ConfigCategory;
  agent?: ConfigAgent;
  target_path?: string | null;
  outputs?: ConfigOutput[];
  format?: ConfigFormat;
  content: string;
  description?: string;
  tags?: string[];
  is_template?: boolean;
}

export interface UpdateConfigInput {
  /** Apply only if the current version matches; omitted preserves unconditional updates. */
  expected_version?: number;
  name?: string;
  kind?: ConfigKind;
  category?: ConfigCategory;
  agent?: ConfigAgent;
  target_path?: string | null;
  outputs?: ConfigOutput[];
  format?: ConfigFormat;
  content?: string;
  description?: string | null;
  tags?: string[];
  is_template?: boolean;
  synced_at?: string | null;
}

export interface ConfigFilter {
  category?: ConfigCategory;
  agent?: ConfigAgent;
  kind?: ConfigKind;
  tags?: string[];
  search?: string;
  is_template?: boolean;
}

// Config snapshot (version history)
export interface ConfigSnapshot {
  id: string;
  config_id: string;
  content: string;
  version: number;
  created_at: string;
}

// Profile (named bundle of configs)
export interface Profile {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  selectors: ProfileSelector;
  variables: ProfileVariables;
  created_at: string;
  updated_at: string;
}

export interface ProfileRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  selectors: string;
  variables: string;
  created_at: string;
  updated_at: string;
}

export interface ProfileSelector {
  os?: string[];
  arch?: string[];
  hostnames?: string[];
}

export type ProfileVariables = Record<string, string>;

export interface CreateProfileInput {
  name: string;
  description?: string;
  selectors?: ProfileSelector;
  variables?: ProfileVariables;
}

export interface UpdateProfileInput {
  name?: string;
  description?: string | null;
  selectors?: ProfileSelector;
  variables?: ProfileVariables;
}

export interface BoundedReadOptions {
  limit?: unknown;
  cursor?: unknown;
}

export interface BoundedReadPage<T> {
  items: T[];
  total: number;
  limit: number;
  cursor: number;
  next_cursor: number | null;
  has_more: boolean;
  complete: boolean;
  truncated: false;
  source_bounded: boolean;
}

export interface ProfileResolutionRead {
  profile: Profile | null;
  scanned: number | null;
  total: number | null;
  batch_limit: number | null;
  source_bounded: boolean;
  complete: true;
  truncated: false;
}

// Profile ↔ Config join. The binding is deliberately separate from Config:
// one canonical config can participate in several profiles with different
// activation, provider and graph semantics without cloning its content.
export const PROFILE_CONFIG_BINDING_SCHEMA = "hasna.instructions.profile-config-binding/v1" as const;
export const INSTRUCTION_ACTIVATION_MODES = ["always", "glob", "model", "manual"] as const;
export type InstructionActivationMode = (typeof INSTRUCTION_ACTIVATION_MODES)[number];
export const INSTRUCTION_FALLBACKS = ["fail", "flatten", "promote-always", "omit"] as const;
export type InstructionFallback = (typeof INSTRUCTION_FALLBACKS)[number];

export interface InstructionActivation {
  mode: InstructionActivationMode;
  globs?: string[];
  models?: string[];
  description?: string;
  directory_scope?: string;
}

export interface InstructionProviderSelector {
  provider: ConfigAgent;
  version_range?: string;
}

export interface ProfileConfigBindingSpec {
  schema: typeof PROFILE_CONFIG_BINDING_SCHEMA;
  activation: InstructionActivation;
  required: boolean;
  fallback: InstructionFallback;
  providers?: InstructionProviderSelector[];
  depends_on?: string[];
  replaces?: string[];
  conflicts_with?: string[];
}

export interface ProfileConfigBinding {
  profile_id: string;
  config_id: string;
  sort_order: number;
  binding: ProfileConfigBindingSpec;
}

// Profile ↔ executable/supporting asset join. Assets deliberately do not use
// profile_configs: instruction text and executable/provider assets have
// different trust, destination, enablement, and rollback contracts.
export const PROFILE_ASSET_BINDING_SCHEMA = "hasna.instructions.profile-asset-binding/v1" as const;
export const ASSET_KINDS = ["skill", "workflow", "plugin", "extension", "hook", "custom-agent"] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];
export const ASSET_DESTINATION_STRATEGIES = ["emit-file", "install-local", "install-marketplace", "unsupported"] as const;
export type AssetDestinationStrategy = (typeof ASSET_DESTINATION_STRATEGIES)[number];
export const ASSET_SCOPES = ["global", "project", "session"] as const;
export type AssetScope = (typeof ASSET_SCOPES)[number];
export const ASSET_UNINSTALL_POLICIES = ["remove-managed", "retain"] as const;
export type AssetUninstallPolicy = (typeof ASSET_UNINSTALL_POLICIES)[number];
export const ASSET_ROLLBACK_POLICIES = ["snapshot", "installer-receipt", "none"] as const;
export type AssetRollbackPolicy = (typeof ASSET_ROLLBACK_POLICIES)[number];

export interface AssetProviderSelector {
  provider: ConfigAgent;
  versionRange: string;
  surface: string;
  scope: AssetScope;
}

export interface AssetSourceSpec {
  kind: AssetKind;
  locator: string;
  digest: string;
  immutable: boolean;
  allowed: boolean;
}

export interface AssetDestinationSpec {
  strategy: AssetDestinationStrategy;
  root: "target-home" | "project-root";
  relativePath: string;
}

/** Native role metadata is separate from the canonical instruction body. */
export interface NativeAgentMetadata {
  name: string;
  description: string;
  /** Optional complete reviewed flat YAML header, preserved byte-for-byte. */
  frontmatter?: string;
}

export interface ProfileAssetBindingSpec {
  schema: typeof PROFILE_ASSET_BINDING_SCHEMA;
  assetKey: string;
  kind: AssetKind;
  enabled: boolean;
  required: boolean;
  selector: AssetProviderSelector;
  source: AssetSourceSpec;
  destination: AssetDestinationSpec;
  nativeAgent?: NativeAgentMetadata;
  uninstall: AssetUninstallPolicy;
  rollback: AssetRollbackPolicy;
}

export interface ProfileAssetBinding {
  profile_id: string;
  source_config_id: string;
  sort_order: number;
  binding: ProfileAssetBindingSpec;
}

/** @deprecated Use ProfileConfigBinding for persisted profile membership. */
export interface ProfileConfig {
  profile_id: string;
  config_id: string;
  order: number;
}

// Machine (where configs were applied)
export interface Machine {
  id: string;
  hostname: string;
  os: string | null;
  arch: string | null;
  last_applied_at: string | null;
  created_at: string;
}

export interface MachineContext extends Machine {
  os_family: string;
  home_dir: string;
  workspace_root: string;
  bun_bin_dir: string;
  bun_path: string;
  path_prefix: string;
}

// Apply result
export interface ApplyResult {
  config_id: string;
  path: string;
  previous_content: string | null;
  new_content: string;
  dry_run: boolean;
  /**
   * AGGREGATE: true when this config has any work to do — this target OR any of
   * its outputs. Profile/sync counters and the MCP surface consume it this way,
   * so its meaning is deliberately unchanged.
   */
  changed: boolean;
  /**
   * This target's OWN verdict: does the file at `path` differ from what would be
   * written? Distinct from `changed`, which ORs in the outputs — a config whose
   * primary file is byte-identical but whose outputs drifted has
   * `primary_changed: false` and `changed: true`. Display surfaces label a line
   * with `path`, so they must read this one; reading `changed` there reported
   * "changed" for a file that was not going to change.
   */
  primary_changed: boolean;
  agent?: ConfigAgent;
  transform?: ConfigTransform;
  outputs?: ApplyResult[];
  unresolved_template_vars?: string[];
}

// Sync result
export interface SyncResult {
  added: number;
  updated: number;
  unchanged: number;
  skipped: string[];
}

// Export/import
export interface ExportManifestV1 {
  version: string;
  exported_at: string;
  configs: Array<Omit<Config, "content">>;
}

export const INSTRUCTIONS_DOMAIN_ARCHIVE_SCHEMA = "hasna.instructions.domain-archive/v2" as const;

export interface InstructionsDomainArchiveCounts {
  configs: number;
  config_snapshots: number;
  profiles: number;
  profile_config_bindings: number;
  profile_asset_bindings: number;
  machines: number;
}

export interface InstructionsDomainArchiveHashes {
  configs: string;
  config_snapshots: string;
  profiles: string;
  profile_config_bindings: string;
  profile_asset_bindings: string;
  machines: string;
}

export interface InstructionsDomainArchiveIntegrity {
  algorithm: "sha256";
  canonicalization:
    | "hasna.instructions.logical-json/v1"
    | "hasna.instructions.restorable-logical-json/v1";
  counts: InstructionsDomainArchiveCounts;
  hashes: InstructionsDomainArchiveHashes;
  domain_sha256: string;
}

export interface InstructionsDomainArchiveExclusion {
  entity: "api_keys" | "idempotency_receipts" | "feedback";
  classification: "security_state" | "transport_state" | "out_of_domain";
  reason: string;
}

export interface InstructionsDomainArchiveManifestV2 {
  schema: typeof INSTRUCTIONS_DOMAIN_ARCHIVE_SCHEMA;
  version: "2.0.0";
  exported_at: string;
  payload: {
    path: "domain.json";
    sha256: string;
    size_bytes: number;
  };
  integrity: InstructionsDomainArchiveIntegrity;
  exclusions: InstructionsDomainArchiveExclusion[];
}

export interface ArchivedConfigSnapshot extends Omit<ConfigSnapshot, "config_id"> {
  config_slug: string;
}

export interface ArchivedProfileConfigBinding extends Omit<ProfileConfigBinding, "profile_id" | "config_id"> {
  profile_slug: string;
  config_slug: string;
}

export interface ArchivedProfileAssetBinding extends Omit<ProfileAssetBinding, "profile_id" | "source_config_id"> {
  profile_slug: string;
  source_config_slug: string;
}

export interface InstructionsDomainArchiveV2 {
  schema: typeof INSTRUCTIONS_DOMAIN_ARCHIVE_SCHEMA;
  configs: Config[];
  config_snapshots: ArchivedConfigSnapshot[];
  profiles: Profile[];
  profile_config_bindings: ArchivedProfileConfigBinding[];
  profile_asset_bindings: ArchivedProfileAssetBinding[];
  machines: Machine[];
}

export type ExportManifest = ExportManifestV1 | InstructionsDomainArchiveManifestV2;

// Error types
export class InvalidExpectedVersionError extends Error {
  readonly code = "INVALID_EXPECTED_VERSION" as const;
  constructor() {
    super("expected_version must be a positive safe integer");
    this.name = "InvalidExpectedVersionError";
  }
}

export function validateExpectedConfigVersion(value: unknown): asserts value is number | undefined {
  if (value !== undefined && (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1)) {
    throw new InvalidExpectedVersionError();
  }
}

export class ConfigVersionConflictError extends Error {
  readonly code = "CONFIG_VERSION_CONFLICT" as const;
  readonly status = 409;
  constructor(readonly config_id: string, readonly expected_version: number) {
    super(`Config version conflict: ${config_id} no longer has expected version ${expected_version}`);
    this.name = "ConfigVersionConflictError";
  }
}

export class ConfigNotFoundError extends Error {
  constructor(id: string) {
    super(`Config not found: ${id}`);
    this.name = "ConfigNotFoundError";
  }
}

export class ProfileNotFoundError extends Error {
  constructor(id: string) {
    super(`Profile not found: ${id}`);
    this.name = "ProfileNotFoundError";
  }
}

export class ConfigApplyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigApplyError";
  }
}

export class TemplateRenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TemplateRenderError";
  }
}
