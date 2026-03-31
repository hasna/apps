export enum Severity {
  Critical = "critical",
  High = "high",
  Medium = "medium",
  Low = "low",
  Info = "info",
}

export enum ScanStatus {
  Pending = "pending",
  Running = "running",
  Completed = "completed",
  Failed = "failed",
}

export enum ScannerType {
  Secrets = "secrets",
  Dependencies = "dependencies",
  Code = "code",
  GitHistory = "git-history",
  Config = "config",
  AiSafety = "ai-safety",
  SupplyChain = "supply-chain",
  IOC = "ioc",
  Lockfile = "lockfile",
  CiCd = "ci-cd",
}

export enum ReportFormat {
  Terminal = "terminal",
  Json = "json",
  Sarif = "sarif",
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

export interface Baseline {
  id: string;
  finding_fingerprint: string;
  reason: string;
  created_by: string;
  created_at: string;
}

export interface LLMAnalysis {
  finding_id: string;
  exploitability: number;
  explanation: string;
  suggested_fix: string | null;
  confidence: number;
  model: string;
  cached: boolean;
  created_at: string;
}

export interface SecurityScore {
  total_findings: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
  suppressed: number;
  score: number; // 0-100, 100 = no findings
}

export interface ScanOptions {
  path: string;
  scanners?: ScannerType[];
  format?: ReportFormat;
  severity_threshold?: Severity;
  include_suppressed?: boolean;
  llm_analyze?: boolean;
  ignore_patterns?: string[];
}

export interface Scanner {
  name: string;
  type: ScannerType;
  description: string;
  scan: (path: string, options?: ScannerRunOptions) => Promise<FindingInput[]>;
}

export interface ScannerRunOptions {
  ignore_patterns?: string[];
  rules?: Rule[];
}

export interface FindingInput {
  rule_id: string;
  scanner_type: ScannerType;
  severity: Severity;
  file: string;
  line: number;
  column?: number;
  end_line?: number;
  message: string;
  code_snippet?: string;
}

export interface ConfigFile {
  enabled_scanners: ScannerType[];
  severity_threshold: Severity;
  cerebras_api_key?: string;
  cerebras_model?: string;
  output_format: ReportFormat;
  ignore_patterns: string[];
  auto_fix: boolean;
  llm_analyze: boolean;
}

export const DEFAULT_CONFIG: ConfigFile = {
  enabled_scanners: Object.values(ScannerType),
  severity_threshold: Severity.Info,
  output_format: ReportFormat.Terminal,
  ignore_patterns: ["node_modules", ".git", "dist", "build", "vendor", "__pycache__", "*.test.ts", "*.test.js", "*.test.tsx", "*.test.jsx", "*.spec.ts", "*.spec.js", "__tests__", "test/fixtures", "tests/fixtures"],
  auto_fix: false,
  llm_analyze: false,
};

export const SEVERITY_ORDER: Record<Severity, number> = {
  [Severity.Critical]: 0,
  [Severity.High]: 1,
  [Severity.Medium]: 2,
  [Severity.Low]: 3,
  [Severity.Info]: 4,
};

// --- Supply Chain Types ---

export enum AttackType {
  MaintainerHijack = "maintainer-hijack",
  CiCdCompromise = "ci-cd-compromise",
  TagHijack = "tag-hijack",
  Typosquatting = "typosquatting",
  DependencyConfusion = "dependency-confusion",
  MaliciousPackage = "malicious-package",
  PostinstallExploit = "postinstall-exploit",
  PthInjection = "pth-injection",
}

export enum Ecosystem {
  Npm = "npm",
  PyPI = "pypi",
  Go = "go",
  Crates = "crates.io",
  GitHubActions = "github-actions",
}

export enum IOCType {
  IP = "ip",
  Domain = "domain",
  FilePath = "file-path",
  ProcessName = "process",
  FileHash = "hash",
  URL = "url",
}

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
}

export interface AdvisoryIOC {
  id: string;
  advisory_id: string;
  type: IOCType;
  value: string;
  context: string | null;
  platform: string | null; // "macos", "windows", "linux", null = all
}

export interface MonitoredPackage {
  id: string;
  name: string;
  ecosystem: Ecosystem;
  last_checked_at: string | null;
  check_interval_ms: number;
  status: "active" | "paused" | "compromised";
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface RegistryEvent {
  id: string;
  package_name: string;
  version: string;
  ecosystem: Ecosystem;
  event_type: "publish" | "unpublish" | "maintainer-change" | "tag-update";
  timestamp: string;
  suspicious: boolean;
  analysis: string | null;
  advisory_id: string | null;
  created_at: string;
}
