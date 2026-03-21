import type {
  Finding,
  Scan,
  Rule,
  Policy,
  Project,
  SecurityScore,
  Stats,
} from "./types.js";

export class OpenSecurityClient {
  private baseUrl: string;

  constructor(baseUrl: string = "http://localhost:19428") {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: { "Content-Type": "application/json", ...options?.headers },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    return res.json() as Promise<T>;
  }

  private buildQuery(params: Record<string, string | number | boolean | undefined>): string {
    const entries = Object.entries(params).filter(
      ([, v]) => v !== undefined,
    );
    if (entries.length === 0) return "";
    return "?" + entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&");
  }

  // --- Scans ---

  async triggerScan(
    path: string,
    options?: { scanners?: string[]; llm_analyze?: boolean },
  ): Promise<Scan> {
    return this.request<Scan>("/api/scans", {
      method: "POST",
      body: JSON.stringify({ path, ...options }),
    });
  }

  async listScans(params?: {
    project_id?: string;
    limit?: number;
  }): Promise<Scan[]> {
    const query = this.buildQuery(params ?? {});
    const data = await this.request<{ scans: Scan[]; count: number }>(
      `/api/scans${query}`,
    );
    return data.scans;
  }

  async getScan(id: string): Promise<Scan & { score?: SecurityScore }> {
    return this.request<Scan & { score?: SecurityScore }>(`/api/scans/${id}`);
  }

  // --- Findings ---

  async listFindings(params?: {
    scan_id?: string;
    severity?: string;
    scanner_type?: string;
    file?: string;
    limit?: number;
    offset?: number;
  }): Promise<Finding[]> {
    const query = this.buildQuery(params ?? {});
    const data = await this.request<{ findings: Finding[]; count: number }>(
      `/api/findings${query}`,
    );
    return data.findings;
  }

  async getFinding(id: string): Promise<Finding> {
    return this.request<Finding>(`/api/findings/${id}`);
  }

  async explainFinding(
    id: string,
  ): Promise<{ finding_id: string; explanation: string }> {
    return this.request<{ finding_id: string; explanation: string }>(
      `/api/findings/${id}/explain`,
      { method: "POST" },
    );
  }

  async fixFinding(id: string): Promise<{ finding_id: string; fix: string }> {
    return this.request<{ finding_id: string; fix: string }>(
      `/api/findings/${id}/fix`,
      { method: "POST" },
    );
  }

  async suppressFinding(id: string, reason: string): Promise<Finding> {
    return this.request<Finding>(`/api/findings/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ suppressed: true, suppressed_reason: reason }),
    });
  }

  // --- Rules ---

  async listRules(params?: {
    scanner_type?: string;
    enabled?: boolean;
  }): Promise<Rule[]> {
    const query = this.buildQuery(params ?? {});
    const data = await this.request<{ rules: Rule[]; count: number }>(
      `/api/rules${query}`,
    );
    return data.rules;
  }

  async createRule(rule: {
    name: string;
    scanner_type: string;
    severity: string;
    pattern: string;
    description?: string;
    metadata?: Record<string, unknown>;
  }): Promise<Rule> {
    return this.request<Rule>("/api/rules", {
      method: "POST",
      body: JSON.stringify(rule),
    });
  }

  async toggleRule(id: string, enabled: boolean): Promise<Rule> {
    return this.request<Rule>(`/api/rules/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ enabled }),
    });
  }

  // --- Policies ---

  async listPolicies(): Promise<Policy[]> {
    const data = await this.request<{ policies: Policy[]; count: number }>(
      "/api/policies",
    );
    return data.policies;
  }

  async createPolicy(policy: {
    name: string;
    description?: string;
    block_on_severity?: string;
    auto_fix?: boolean;
    notify?: boolean;
  }): Promise<Policy> {
    return this.request<Policy>("/api/policies", {
      method: "POST",
      body: JSON.stringify(policy),
    });
  }

  async updatePolicy(
    id: string,
    updates: Partial<{
      name: string;
      description: string;
      block_on_severity: string | null;
      auto_fix: boolean;
      notify: boolean;
      enabled: boolean;
    }>,
  ): Promise<Policy> {
    return this.request<Policy>(`/api/policies/${id}`, {
      method: "PATCH",
      body: JSON.stringify(updates),
    });
  }

  // --- Projects ---

  async listProjects(): Promise<Project[]> {
    const data = await this.request<{ projects: Project[]; count: number }>(
      "/api/projects",
    );
    return data.projects;
  }

  async createProject(name: string, path: string): Promise<Project> {
    return this.request<Project>("/api/projects", {
      method: "POST",
      body: JSON.stringify({ name, path }),
    });
  }

  // --- Stats ---

  async getStats(): Promise<Stats> {
    return this.request<Stats>("/api/stats");
  }

  async getSecurityScore(scanId: string): Promise<SecurityScore> {
    const scan = await this.getScan(scanId);
    if (!scan.score) {
      throw new Error("No security score available for this scan");
    }
    return scan.score;
  }
}
