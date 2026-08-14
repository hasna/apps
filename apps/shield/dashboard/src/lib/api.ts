import type {
  Stats,
  Finding,
  Scan,
  Rule,
  Project,
  ScannerType,
  Severity,
  Advisory,
} from "../types";

const BASE = "/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || res.statusText);
  }
  return res.json();
}

export async function fetchStats(): Promise<Stats> {
  return request<Stats>("/stats");
}

export async function fetchFindings(params?: {
  scan_id?: string;
  severity?: Severity;
  scanner_type?: ScannerType;
  file?: string;
  limit?: number;
  offset?: number;
}): Promise<{ findings: Finding[]; count: number }> {
  const q = new URLSearchParams();
  if (params?.scan_id) q.set("scan_id", params.scan_id);
  if (params?.severity) q.set("severity", params.severity);
  if (params?.scanner_type) q.set("scanner_type", params.scanner_type);
  if (params?.file) q.set("file", params.file);
  if (params?.limit !== undefined) q.set("limit", String(params.limit));
  if (params?.offset !== undefined) q.set("offset", String(params.offset));
  const qs = q.toString();
  return request(`/findings${qs ? `?${qs}` : ""}`);
}

export async function fetchScans(params?: {
  project_id?: string;
  limit?: number;
}): Promise<{ scans: Scan[]; count: number }> {
  const q = new URLSearchParams();
  if (params?.project_id) q.set("project_id", params.project_id);
  if (params?.limit !== undefined) q.set("limit", String(params.limit));
  const qs = q.toString();
  return request(`/scans${qs ? `?${qs}` : ""}`);
}

export async function triggerScan(
  path: string,
  options?: { scanners?: ScannerType[]; llm_analyze?: boolean },
): Promise<Scan> {
  return request<Scan>("/scans", {
    method: "POST",
    body: JSON.stringify({ path, ...options }),
  });
}

export async function explainFinding(
  id: string,
): Promise<{ finding_id: string; explanation: string }> {
  return request(`/findings/${id}/explain`, { method: "POST" });
}

export async function fixFinding(
  id: string,
): Promise<{ finding_id: string; fix: string }> {
  return request(`/findings/${id}/fix`, { method: "POST" });
}

export async function suppressFinding(
  id: string,
  reason: string,
): Promise<Finding> {
  return request(`/findings/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ suppressed: true, suppressed_reason: reason }),
  });
}

export async function fetchRules(params?: {
  scanner_type?: ScannerType;
  enabled?: boolean;
}): Promise<{ rules: Rule[]; count: number }> {
  const q = new URLSearchParams();
  if (params?.scanner_type) q.set("scanner_type", params.scanner_type);
  if (params?.enabled !== undefined) q.set("enabled", String(params.enabled));
  const qs = q.toString();
  return request(`/rules${qs ? `?${qs}` : ""}`);
}

export async function createRule(rule: {
  name: string;
  scanner_type: ScannerType;
  severity: Severity;
  pattern?: string;
  description?: string;
}): Promise<Rule> {
  return request<Rule>("/rules", {
    method: "POST",
    body: JSON.stringify(rule),
  });
}

export async function toggleRule(
  id: string,
  enabled: boolean,
): Promise<Rule> {
  return request<Rule>(`/rules/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ enabled }),
  });
}

export async function fetchProjects(): Promise<{
  projects: Project[];
  count: number;
}> {
  return request("/projects");
}

export async function createProject(
  name: string,
  path: string,
): Promise<Project> {
  return request<Project>("/projects", {
    method: "POST",
    body: JSON.stringify({ name, path }),
  });
}

export async function fetchAdvisories(params?: {
  ecosystem?: string;
  severity?: string;
  limit?: number;
}): Promise<{ advisories: Advisory[]; count: number }> {
  const q = new URLSearchParams();
  if (params?.ecosystem) q.set("ecosystem", params.ecosystem);
  if (params?.severity) q.set("severity", params.severity);
  if (params?.limit !== undefined) q.set("limit", String(params.limit));
  const qs = q.toString();
  return request(`/advisories${qs ? `?${qs}` : ""}`);
}

export async function fetchAdvisory(id: string): Promise<Advisory> {
  return request<Advisory>(`/advisories/${id}`);
}

export async function searchAdvisories(q: string): Promise<{ advisories: Advisory[]; count: number }> {
  return request(`/advisories/search?q=${encodeURIComponent(q)}`);
}

export async function checkPackage(params: {
  name: string;
  version?: string;
  ecosystem?: string;
}): Promise<{
  status: "SAFE" | "COMPROMISED" | "HAS_ADVISORIES";
  package: string;
  advisory?: Partial<Advisory>;
  advisories?: Partial<Advisory>[];
  iocs?: Array<{ type: string; value: string; context: string | null }>;
  action?: string;
  message?: string;
}> {
  const q = new URLSearchParams({ name: params.name });
  if (params.version) q.set("version", params.version);
  if (params.ecosystem) q.set("ecosystem", params.ecosystem);
  return request(`/check-package?${q.toString()}`);
}
