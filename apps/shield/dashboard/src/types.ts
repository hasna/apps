export type Severity = "critical" | "high" | "medium" | "low" | "info";

export type ScanStatus = "pending" | "running" | "completed" | "failed";

export type ScannerType =
  | "secrets"
  | "dependencies"
  | "code"
  | "git-history"
  | "config"
  | "ai-safety"
  | "supply-chain"
  | "ioc"
  | "lockfile"
  | "ci-cd";

export type AttackType =
  | "maintainer-hijack"
  | "ci-cd-compromise"
  | "tag-hijack"
  | "typosquatting"
  | "dependency-confusion"
  | "malicious-package"
  | "postinstall-exploit"
  | "pth-injection";

export type Ecosystem = "npm" | "pypi" | "go" | "crates.io" | "github-actions";

export type IOCType = "ip" | "domain" | "file-path" | "process" | "hash" | "url";

export interface Advisory {
  id: string;
  package_name: string;
  ecosystem: Ecosystem;
  affected_versions: string[];
  safe_versions: string[];
  attack_type: AttackType;
  severity: Severity;
  title: string;
  description: string;
  source: string;
  cve_id: string | null;
  threat_actor: string | null;
  detected_at: string;
  resolved_at: string | null;
  tweet_id: string | null;
  created_at: string;
  updated_at: string;
  iocs?: AdvisoryIOC[];
}

export interface AdvisoryIOC {
  id: string;
  advisory_id: string;
  type: IOCType;
  value: string;
  context: string | null;
  platform: string | null;
}

export interface Project {
  id: string;
  name: string;
  path: string;
  created_at: string;
  updated_at: string;
}

export interface Scan {
  id: string;
  project_id: string;
  status: ScanStatus;
  scanner_types: ScannerType[];
  findings_count: number;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  error: string | null;
  created_at: string;
}

export interface Finding {
  id: string;
  scan_id: string;
  rule_id: string;
  scanner_type: ScannerType;
  severity: Severity;
  file: string;
  line: number;
  column: number | null;
  end_line: number | null;
  message: string;
  code_snippet: string | null;
  fingerprint: string;
  suppressed: boolean;
  suppressed_reason: string | null;
  llm_explanation: string | null;
  llm_fix: string | null;
  llm_exploitability: number | null;
  created_at: string;
}

export interface Rule {
  id: string;
  name: string;
  description: string;
  scanner_type: ScannerType;
  severity: Severity;
  pattern: string | null;
  enabled: boolean;
  builtin: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface Policy {
  id: string;
  name: string;
  description: string;
  block_on_severity: Severity | null;
  auto_fix: boolean;
  notify: boolean;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface SecurityScore {
  total_findings: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
  suppressed: number;
  score: number;
}

export interface Stats {
  total_findings: number;
  by_severity: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
  };
  by_scanner: Record<string, number>;
  recent_scans: Scan[];
  score: number | null;
}
