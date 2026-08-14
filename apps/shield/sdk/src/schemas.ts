import { z } from "zod";

export const SeveritySchema = z.enum(["critical", "high", "medium", "low", "info"]);

export const ScanStatusSchema = z.enum(["pending", "running", "completed", "failed"]);

export const ScannerTypeSchema = z.enum([
  "secrets",
  "dependencies",
  "code",
  "git-history",
  "config",
  "ai-safety",
]);

export const ProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const ScanSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  status: ScanStatusSchema,
  scanner_types: z.array(ScannerTypeSchema),
  findings_count: z.number(),
  started_at: z.string(),
  completed_at: z.string().nullable(),
  duration_ms: z.number().nullable(),
  error: z.string().nullable(),
  created_at: z.string(),
});

export const FindingSchema = z.object({
  id: z.string(),
  scan_id: z.string(),
  rule_id: z.string(),
  scanner_type: ScannerTypeSchema,
  severity: SeveritySchema,
  file: z.string(),
  line: z.number(),
  column: z.number().nullable(),
  end_line: z.number().nullable(),
  message: z.string(),
  code_snippet: z.string().nullable(),
  fingerprint: z.string(),
  suppressed: z.boolean(),
  suppressed_reason: z.string().nullable(),
  llm_explanation: z.string().nullable(),
  llm_fix: z.string().nullable(),
  llm_exploitability: z.number().nullable(),
  created_at: z.string(),
});

export const RuleSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  scanner_type: ScannerTypeSchema,
  severity: SeveritySchema,
  pattern: z.string().nullable(),
  enabled: z.boolean(),
  builtin: z.boolean(),
  metadata: z.record(z.unknown()),
  created_at: z.string(),
  updated_at: z.string(),
});

export const PolicySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  block_on_severity: SeveritySchema.nullable(),
  auto_fix: z.boolean(),
  notify: z.boolean(),
  enabled: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const SecurityScoreSchema = z.object({
  total_findings: z.number(),
  critical: z.number(),
  high: z.number(),
  medium: z.number(),
  low: z.number(),
  info: z.number(),
  suppressed: z.number(),
  score: z.number(),
});

export const StatsSchema = z.object({
  total_findings: z.number(),
  by_severity: z.object({
    critical: z.number(),
    high: z.number(),
    medium: z.number(),
    low: z.number(),
    info: z.number(),
  }),
  by_scanner: z.record(z.number()),
  recent_scans: z.array(ScanSchema),
  score: z.number().nullable(),
});
