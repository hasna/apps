export type MachinePlatform = "linux" | "macos" | "windows";
export type MachineConnection = "local" | "ssh" | "tailscale";

export interface ManifestPackageSpec {
  name: string;
  manager?: "bun" | "brew" | "apt" | "custom";
  version?: string;
  /** Distribution appId (hasna.app.v1 join key), e.g. "open-todos". Defaults to a slug derived from the package name. */
  appId?: string;
  /** CLI bin used to verify installs via `<bin> --version`. Defaults to the unscoped package name. */
  bin?: string;
  /**
   * Set false for library-only packages without a CLI: skips the
   * `<bin> --version` verification so rollouts succeed on install exit code
   * alone (an mcpHealthUrl, when declared, is still checked).
   */
  verify?: boolean;
  /** Optional MCP health endpoint checked after install/update (expects HTTP 200). */
  mcpHealthUrl?: string;
}

export interface FreezeEntry {
  name: string;
  reason?: string;
  frozenAt?: string;
  until?: string;
}

export interface ManifestAppSpec {
  name: string;
  manager?: "brew" | "cask" | "apt" | "winget" | "custom";
  packageName?: string;
}

export interface ManifestFileSyncSpec {
  source: string;
  target: string;
  mode?: "copy" | "symlink";
}

export interface MachineManifest {
  id: string;
  friendlyName?: string;
  updatedAt?: string;
  hostname?: string;
  sshAddress?: string;
  tailscaleName?: string;
  platform: MachinePlatform;
  connection?: MachineConnection;
  workspacePath: string;
  bunPath?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  packages?: ManifestPackageSpec[];
  apps?: ManifestAppSpec[];
  files?: ManifestFileSyncSpec[];
}

export interface FleetManifest {
  version: 1;
  generatedAt?: string;
  /** Fleet-wide desired-state packages applied to every machine; per-machine packages override by name. */
  packages?: ManifestPackageSpec[];
  /** Supply-chain freeze list; frozen packages are blocked from reconcile installs/updates. */
  freeze?: FreezeEntry[];
  machines: MachineManifest[];
}

export type ManifestSourceKind = "file" | "private-ref";

export interface ManifestSourceRef {
  kind: ManifestSourceKind;
  ref: string;
  backend: string | null;
  private: boolean;
  publicSafe: true;
}

export interface ManifestLoadInfo {
  source: ManifestSourceRef;
  loadedFrom: ManifestSourceKind | "default" | "fallback";
  fallbackSource?: ManifestSourceRef;
  warnings: string[];
}

export interface AgentHeartbeat {
  machineId: string;
  pid: number;
  status: "online" | "offline";
  updatedAt: string;
}

export interface SetupResult {
  machineId: string;
  mode: "plan" | "apply";
  planDigest?: string;
  steps: SetupStep[];
  executed: number;
}

export interface SetupStep {
  id: string;
  title: string;
  command: string;
  manager: "shell" | "bun" | "brew" | "apt" | "custom";
  privileged?: boolean;
}

export interface SyncResult {
  machineId: string;
  mode: "plan" | "apply";
  planDigest?: string;
  actions: SyncAction[];
  executed: number;
}

export interface SyncAction {
  id: string;
  title: string;
  command: string;
  status: "ok" | "missing" | "drifted";
  kind: "package" | "file" | "summary";
}

export interface MachineDiff {
  leftMachineId: string;
  rightMachineId: string;
  changedFields: string[];
  missingPackages: {
    leftOnly: string[];
    rightOnly: string[];
  };
  missingFiles: {
    leftOnly: string[];
    rightOnly: string[];
  };
}

export interface FleetStatusMachine {
  machineId: string;
  friendlyName?: string | null;
  displayName?: string;
  platform?: string;
  manifestDeclared: boolean;
  heartbeatStatus: "online" | "offline" | "unknown";
  lastHeartbeatAt?: string;
  updatedAt?: string | null;
  daemonVersion?: string | null;
  agentMode?: string | null;
  storageSyncStatus?: string | null;
  doctorSummary?: Record<string, unknown> | null;
  privateMetadata?: boolean;
}

export interface FleetStatus {
  machineId: string;
  manifestPath: string;
  dbPath: string;
  notificationsPath: string;
  manifestMachineCount: number;
  heartbeatCount: number;
  machines: FleetStatusMachine[];
  recentSetupRuns: number;
  recentSyncRuns: number;
  warnings?: string[];
}

export type NotificationChannelType = "email" | "webhook" | "command";

export interface NotificationChannel {
  id: string;
  type: NotificationChannelType;
  target: string;
  commandArgs?: string[];
  events: string[];
  enabled: boolean;
}

export interface NotificationConfig {
  version: 1;
  updatedAt?: string;
  channels: NotificationChannel[];
}

export interface NotificationTestResult {
  channelId: string;
  mode: "plan" | "apply";
  delivered: boolean;
  preview: string;
  detail: string;
}

export interface InstalledAppStatus {
  name: string;
  packageName: string;
  manager: "brew" | "cask" | "apt" | "winget" | "custom";
  installed: boolean;
  version?: string;
}

export interface AppsStatusResult {
  machineId: string;
  source: "local" | "lan" | "tailscale" | "ssh";
  apps: InstalledAppStatus[];
}

export interface AppsDiffResult extends AppsStatusResult {
  missing: string[];
  installed: string[];
}

export interface CliToolStatus {
  tool: "claude" | "codex" | "gemini";
  packageName: string;
  installed: boolean;
  version?: string;
}

export interface ClaudeCliStatusResult {
  machineId: string;
  source: "local" | "lan" | "tailscale" | "ssh";
  tools: CliToolStatus[];
}

export interface ClaudeCliDiffResult extends ClaudeCliStatusResult {
  missing: string[];
  installed: string[];
}

export interface NotificationDispatchResult {
  channelId: string;
  event: string;
  delivered: boolean;
  transport: NotificationChannelType;
  detail: string;
}

export interface NotificationDispatchSummary {
  event: string;
  message: string;
  deliveries: NotificationDispatchResult[];
}

export interface DoctorCheck {
  id: string;
  status: "ok" | "warn" | "fail";
  summary: string;
  detail: string;
  optional?: boolean;
  source?: string;
  data?: Record<string, unknown>;
  remediation?: string[];
}

export interface DoctorReport {
  machineId: string;
  source: "local" | "lan" | "tailscale" | "ssh";
  schemaVersion?: 1;
  generatedAt?: string;
  manifestSource?: ManifestLoadInfo;
  manifestPath?: string;
  dbPath?: string;
  notificationsPath?: string;
  checks: DoctorCheck[];
}

export interface SelfTestCheck {
  id: string;
  status: "ok" | "warn" | "fail";
  summary: string;
  detail: string;
}

export interface SelfTestCounts {
  ok: number;
  warn: number;
  fail: number;
}

export interface SelfTestResult {
  machineId: string;
  overall: SelfTestCheck["status"];
  counts: SelfTestCounts;
  checks: SelfTestCheck[];
}

export interface ClipboardEntry {
  hash: string;
  content: string;
  contentType: "text" | "rich" | "url";
  sourceMachine: string;
  timestamp: string;
}

export interface ClipboardConfig {
  version: 1;
  enabled: boolean;
  port: number;
  maxHistory: number;
  maxSizeBytes: number;
  skipPatterns: string[];
}

export interface ClipboardStatus {
  running: boolean;
  pid?: number;
  port: number;
  lastSync?: string;
  historyCount: number;
}

export interface ClipboardSyncEvent {
  hash: string;
  content: string;
  contentType: "text" | "rich" | "url";
  sourceMachine: string;
  timestamp: string;
}
