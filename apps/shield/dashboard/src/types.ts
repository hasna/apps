export type Severity = "critical" | "high" | "medium" | "low" | "info";

export type ScanStatus = "pending" | "running" | "completed" | "failed";

export type ScannerType =
  | "secrets"
  | "dependencies"
  | "code"
  | "git-history"
  | "config"
  | "ai-safety";

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
