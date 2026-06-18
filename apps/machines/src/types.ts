export type MachinePlatform = "linux" | "macos" | "windows";
export type MachineConnection = "local" | "ssh" | "tailscale";

export interface ManifestPackageSpec {
  name: string;
  manager?: "bun" | "brew" | "apt" | "custom";
  version?: string;
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
  platform?: string;
  manifestDeclared: boolean;
  heartbeatStatus: "online" | "offline" | "unknown";
  lastHeartbeatAt?: string;
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

export interface SelfTestResult {
  machineId: string;
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
