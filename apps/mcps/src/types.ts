export interface McpServerEntry {
  id: string;
  name: string;
  description: string | null;
  command: string;
  args: string[];
  env: Record<string, string>;
  transport: "stdio" | "sse" | "streamable-http";
  url: string | null;
  source: "local" | "registry";
  enabled: boolean;
  created_at: string;
  updated_at: string;
  last_connected_at?: string | null;
  last_error?: string | null;
}

export interface AddServerOptions {
  name?: string;
  description?: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  transport?: "stdio" | "sse" | "streamable-http";
  url?: string;
  source?: "local" | "registry";
}

export interface McpTool {
  server_id: string;
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface RegistryPackage {
  registryType: string;
  identifier: string;
  transport?: { type: string };
}

export interface RegistryServerInner {
  name: string;
  description: string;
  repository: { url: string; source?: string };
  version?: string;
  packages?: RegistryPackage[];
}

export interface RegistryServerEntry {
  server: RegistryServerInner;
  _meta?: Record<string, unknown>;
}

export interface RegistryServer {
  id: string;
  name: string;
  description: string;
  repository: { url: string };
  packages: RegistryPackage[];
}

export interface ConnectedServer {
  entry: McpServerEntry;
  tools: McpTool[];
  disconnect: () => Promise<void>;
}

export type TuiView = "servers" | "detail" | "search" | "call" | "find";

export interface FinderResult {
  name: string;
  description: string;
  /** Where this result came from */
  source: "registry" | "npm" | "awesome" | "github";
  /** DB id of the source that returned this result */
  sourceId?: string;
  /** Homepage / repository URL */
  url?: string;
  /** GitHub repo URL if known */
  githubRepo?: string;
  /** npm package name if known */
  npmPackage?: string;
  /** Ready-to-run install command, e.g. `npx -y @package/name` */
  installCmd?: string;
  /** GitHub star count if available */
  stars?: number;
}

export interface McpSource {
  id: string;
  name: string;
  /** mcp-registry | awesome-list | npm-search | github-topic */
  type: "mcp-registry" | "awesome-list" | "npm-search" | "github-topic";
  /** The URL endpoint for this source */
  url: string;
  description: string | null;
  enabled: boolean;
  created_at: string;
}

export interface AddSourceOptions {
  name: string;
  type: "mcp-registry" | "awesome-list" | "npm-search" | "github-topic";
  url: string;
  description?: string;
}

export type ProviderProfileTransport = "stdio" | "sse" | "streamable-http";
export type ProviderProfileAuthType = "none" | "oauth2" | "api_key" | "bearer_token" | "custom";
export type ProviderProfileTokenMode = "none" | "user" | "workspace" | "service";
export type ProviderProfileSource =
  | "curated"
  | "official-registry"
  | "npm"
  | "github"
  | "manual";

export interface ProviderInstallFallback {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  packageName?: string;
  registryId?: string;
  url?: string;
}

export interface ProviderSafetyMetadata {
  readOnly?: boolean;
  requiresApproval?: boolean;
  destructiveTools?: string[];
  sensitiveScopes?: string[];
  dataClasses?: string[];
  notes?: string;
}

export interface ProviderSourceProvenance {
  source: ProviderProfileSource;
  sourceUrl?: string;
  repositoryUrl?: string;
  packageName?: string;
  verifiedAt?: string;
}

export interface ProviderProfile {
  id: string;
  displayName: string;
  description: string | null;
  endpoint: string | null;
  transport: ProviderProfileTransport;
  authType: ProviderProfileAuthType;
  scopes: string[];
  tokenMode: ProviderProfileTokenMode;
  installFallback: ProviderInstallFallback | null;
  docsUrl: string | null;
  safety: ProviderSafetyMetadata;
  provenance: ProviderSourceProvenance;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface UpsertProviderProfileOptions {
  id: string;
  displayName: string;
  description?: string;
  endpoint?: string;
  transport: ProviderProfileTransport;
  authType: ProviderProfileAuthType;
  scopes?: string[];
  tokenMode?: ProviderProfileTokenMode;
  installFallback?: ProviderInstallFallback | null;
  docsUrl?: string;
  safety?: ProviderSafetyMetadata;
  provenance: ProviderSourceProvenance;
  enabled?: boolean;
}

export type MachinePlatform = "linux" | "darwin" | "unknown";
export type MachineArch = "arm64" | "x64" | "unknown";
export type MachineInstaller = "auto" | "bun" | "npm";

export interface MachineEntry {
  id: string;
  name: string;
  host: string;
  username: string;
  port: number;
  platform: MachinePlatform;
  arch: MachineArch;
  bun_path: string | null;
  npm_path: string | null;
  installer: MachineInstaller;
  ssh_key_path: string | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
  last_seen_at: string | null;
  last_error: string | null;
}

export interface AddMachineOptions {
  id?: string;
  name?: string;
  host: string;
  username?: string;
  port?: number;
  platform?: MachinePlatform;
  arch?: MachineArch;
  bun_path?: string;
  npm_path?: string;
  installer?: MachineInstaller;
  ssh_key_path?: string;
  enabled?: boolean;
}

export interface HasnaMcpCatalogEntry {
  name: string;
  version: string;
  description: string;
  keywords: string[];
  repository: string | null;
  bins: Record<string, string>;
  mcpBin: string | null;
}

export interface MachinePackageHealth {
  packageName: string;
  latestVersion: string;
  installedVersion: string | null;
  drift: "missing" | "outdated" | "current";
  binaryName: string | null;
  binaryPath: string | null;
  handshakeOk: boolean | null;
  handshakeError: string | null;
}

export interface FleetHealthReport {
  machine: MachineEntry;
  checkedAt: string;
  runtime: {
    hostname: string | null;
    platform: MachinePlatform;
    arch: MachineArch;
    nodePath: string | null;
    npmPath: string | null;
    bunPath: string | null;
  };
  packages: MachinePackageHealth[];
  summary: {
    total: number;
    current: number;
    missing: number;
    outdated: number;
    unresponsive: number;
  };
  error: string | null;
}

export interface FleetInstallPackageResult {
  packageName: string;
  requestedVersion: string;
  installer: Exclude<MachineInstaller, "auto">;
  command: string;
  success: boolean;
  stdout: string;
  stderr: string;
}

export interface FleetInstallReport {
  machine: MachineEntry;
  installer: Exclude<MachineInstaller, "auto"> | null;
  attempted: number;
  results: FleetInstallPackageResult[];
  error: string | null;
}
