export type MonitorKind = "http" | "tcp";
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
  kind: MonitorKind;
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

export type UpdateMonitorInput = Partial<Omit<CreateMonitorInput, "kind">> & {
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
}

export interface CheckAttemptResult {
  status: CheckStatus;
  latencyMs: number | null;
  statusCode?: number | null;
  error?: string | null;
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
