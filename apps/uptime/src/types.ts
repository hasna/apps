export type MonitorKind = "http" | "tcp" | "browser_page";
export type CreateMonitorKind = "http" | "tcp";
export type MonitorStatus = "unknown" | "up" | "down" | "paused";
export type CheckStatus = "up" | "down";
export type IncidentStatus = "open" | "closed";

export interface Monitor {
  id: string;
  workspaceId: string;
  name: string;
  kind: MonitorKind;
  url: string | null;
  host: string | null;
  port: number | null;
  method: string;
  expectedStatus: number | null;
  intervalSeconds: number;
  timeoutMs: number;
  retryCount: number;
  enabled: boolean;
  status: MonitorStatus;
  lastCheckedAt: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateMonitorInput {
  workspaceId?: string;
  name: string;
  kind: CreateMonitorKind;
  url?: string;
  host?: string;
  port?: number;
  method?: string;
  expectedStatus?: number | null;
  intervalSeconds?: number;
  timeoutMs?: number;
  retryCount?: number;
  enabled?: boolean;
}

export interface ImportedMonitorInput extends Omit<CreateMonitorInput, "kind"> {
  kind: MonitorKind;
}

export type UpdateMonitorInput = Partial<Omit<CreateMonitorInput, "kind">> & {
  kind?: CreateMonitorKind;
};

export type ImportedUpdateMonitorInput = Partial<Omit<ImportedMonitorInput, "kind">> & {
  kind?: MonitorKind;
};

export interface CheckResult {
  id: string;
  monitorId: string;
  checkedAt: string;
  status: CheckStatus;
  latencyMs: number | null;
  statusCode: number | null;
  error: string | null;
  attemptCount: number;
  evidence: CheckEvidence | null;
}

export interface CheckAttemptResult {
  status: CheckStatus;
  latencyMs: number | null;
  statusCode?: number | null;
  error?: string | null;
  evidence?: CheckEvidence | null;
}

export interface ProbeIdentity {
  id: string;
  name: string;
  publicKeyPem: string;
  publicKeyFingerprint: string;
  enabled: boolean;
  createdAt: string;
  lastSeenAt: string | null;
}

export interface CreateProbeInput {
  name: string;
  publicKeyPem?: string;
  enabled?: boolean;
}

export interface CreateProbeResult extends ProbeIdentity {
  privateKeyPem?: string;
}

export interface ProbeResultSubmission {
  probeId: string;
  jobId: string;
  scheduleSlot: string;
  fencingToken: string;
  monitorId: string;
  nonce: string;
  checkedAt: string;
  status: CheckStatus;
  latencyMs: number | null;
  statusCode?: number | null;
  error?: string | null;
  attemptCount?: number;
  monitorRevision: number;
  evidence?: CheckEvidence | null;
  signature: string;
}

export interface ProbeSubmissionReceipt {
  id: string;
  probeId: string;
  jobId: string;
  monitorId: string;
  checkResultId: string;
  nonce: string;
  checkedAt: string;
  submittedAt: string;
}

export type ProbeCheckJobStatus = "pending" | "claimed" | "submitted" | "expired" | "cancelled";

export interface ProbeCheckJob {
  id: string;
  monitorId: string;
  monitorRevision: number;
  scheduleSlot: string;
  status: ProbeCheckJobStatus;
  claimedByProbeId: string | null;
  fencingToken: string | null;
  dueAt: string;
  claimedAt: string | null;
  leaseExpiresAt: string | null;
  submittedResultId: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ReportScheduleStatus = "enabled" | "disabled";
export type ReportRunStatus = "success" | "failed";
export type ReportDeliveryChannel = "email" | "sms" | "logs";

export interface ReportDeliveryRecord {
  channel: ReportDeliveryChannel;
  ok: boolean;
  status?: number;
  id?: string;
  error?: string;
}

export interface ReportEmailChannelConfig {
  apiUrl?: string;
  from?: string;
  to?: string | string[];
  subject?: string;
  providerId?: string;
}

export interface ReportSmsChannelConfig {
  apiUrl?: string;
  from?: string;
  to?: string | string[];
}

export interface ReportLogsChannelConfig {
  apiUrl?: string;
  projectId?: string;
  environment?: string;
  service?: string;
}

export interface ReportScheduleChannels {
  email?: boolean | ReportEmailChannelConfig;
  sms?: boolean | ReportSmsChannelConfig;
  logs?: boolean | ReportLogsChannelConfig;
}

export interface ReportSchedule {
  id: string;
  name: string;
  enabled: boolean;
  intervalSeconds: number;
  nextRunAt: string;
  lastRunAt: string | null;
  subject: string | null;
  channels: ReportScheduleChannels;
  createdAt: string;
  updatedAt: string;
}

export interface CreateReportScheduleInput {
  name: string;
  intervalSeconds: number;
  nextRunAt?: string;
  enabled?: boolean;
  subject?: string | null;
  channels: ReportScheduleChannels;
}

export type UpdateReportScheduleInput = Partial<CreateReportScheduleInput>;

export interface ReportRun {
  id: string;
  scheduleId: string | null;
  status: ReportRunStatus;
  startedAt: string;
  finishedAt: string;
  deliveries: ReportDeliveryRecord[];
  error: string | null;
  reportJson: Record<string, unknown> | null;
}

export interface ListReportRunsOptions {
  scheduleId?: string;
  limit?: number;
}

export interface AuditEvent {
  id: string;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  message: string | null;
  metadata: Record<string, unknown>;
  actor: string | null;
  createdAt: string;
}

export interface RecordAuditEventInput {
  action: string;
  resourceType?: string | null;
  resourceId?: string | null;
  message?: string | null;
  metadata?: Record<string, unknown>;
  actor?: string | null;
  createdAt?: string;
}

export interface ListAuditEventsOptions {
  resourceType?: string;
  resourceId?: string;
  limit?: number;
}

export type CheckEvidence = BrowserPageEvidence | HttpTargetPolicyEvidence;

export interface HttpTargetPolicyEvidence {
  kind: "http_target_policy";
  mode: "hosted";
  finalUrl: string | null;
  redirectCount: number;
  decisions: HttpTargetPolicyDecision[];
  redacted: boolean;
  redactionStatus: "redacted";
  retentionClass: "short";
}

export interface HttpTargetPolicyDecision {
  stage: "request" | "redirect";
  decision: "allowed" | "blocked";
  url: string;
  host: string;
  targetClass: "public_http";
  probeClass: "public";
  protocol: "http:" | "https:";
  resolvedAddresses: Array<{
    address: string;
    family: 4 | 6;
  }>;
  ruleId: string;
  reason: string | null;
}

export interface BrowserPageEvidence {
  kind: "browser_page";
  finalUrl: string | null;
  navigationStatus: number | null;
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: BrowserFailedRequest[];
  screenshot: EvidenceArtifact | null;
  artifacts: EvidenceArtifact[];
  redacted: boolean;
  redactionStatus: "redacted";
  retentionClass: "short";
}

export interface BrowserFailedRequest {
  url: string;
  statusCode: number | null;
  error: string | null;
}

export interface EvidenceArtifact {
  ref: string;
  sha256: string;
  bytes: number;
  contentType: string;
  retentionClass: "short";
}

export interface Incident {
  id: string;
  monitorId: string;
  status: IncidentStatus;
  openedAt: string;
  closedAt: string | null;
  lastFailureAt: string;
  failureCount: number;
  recoveryCheckId: string | null;
  reason: string | null;
}

export interface MonitorSummary {
  monitor: Monitor;
  totalChecks: number;
  upChecks: number;
  downChecks: number;
  uptimePercent: number | null;
  averageLatencyMs: number | null;
  openIncident: Incident | null;
}

export interface UptimeSummary {
  generatedAt: string;
  monitors: MonitorSummary[];
  totals: {
    monitors: number;
    enabled: number;
    up: number;
    down: number;
    paused: number;
    unknown: number;
    openIncidents: number;
  };
}

export interface ListResultsOptions {
  monitorId?: string;
  workspaceId?: string;
  limit?: number;
}

export interface SchedulerHandle {
  stop: () => void;
}
