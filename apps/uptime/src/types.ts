export type MonitorKind = "http" | "tcp" | "browser_page";
export type CreateMonitorKind = "http" | "tcp";
export type MonitorStatus = "unknown" | "up" | "down" | "paused";
export type CheckStatus = "up" | "down";
export type IncidentStatus = "open" | "closed";

export interface Monitor {
  id: string;
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

export type CheckEvidence = BrowserPageEvidence;

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
  limit?: number;
}

export interface SchedulerHandle {
  stop: () => void;
}
