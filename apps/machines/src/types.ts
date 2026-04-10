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
  packages?: ManifestPackageSpec[];
  apps?: ManifestAppSpec[];
  files?: ManifestFileSyncSpec[];
}

export interface FleetManifest {
  version: 1;
  generatedAt?: string;
  machines: MachineManifest[];
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
}
