import crypto from "crypto";
import { getDb, onDbInit } from "./database.js";
import type { Rule } from "../types/index.js";
import { ScannerType, Severity } from "../types/index.js";

// Auto-seed builtin rules when DB is first initialized
onDbInit(() => seedBuiltinRules());

interface RuleRow {
  id: string;
  name: string;
  description: string;
  scanner_type: string;
  severity: string;
  pattern: string | null;
  enabled: number;
  builtin: number;
  metadata: string;
  created_at: string;
  updated_at: string;
}

function rowToRule(row: RuleRow): Rule {
  return {
    ...row,
    scanner_type: row.scanner_type as ScannerType,
    severity: row.severity as Severity,
    enabled: row.enabled === 1,
    builtin: row.builtin === 1,
    metadata: JSON.parse(row.metadata) as Record<string, unknown>,
  };
}

export function createRule(
  input: Omit<Rule, "id" | "created_at" | "updated_at">
): Rule {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const stmt = db.prepare(
    `INSERT INTO rules (id, name, description, scanner_type, severity, pattern, enabled, builtin, metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  stmt.run(
    id,
    input.name,
    input.description,
    input.scanner_type,
    input.severity,
    input.pattern,
    input.enabled ? 1 : 0,
    input.builtin ? 1 : 0,
    JSON.stringify(input.metadata),
    now,
    now
  );

  return {
    id,
    ...input,
    created_at: now,
    updated_at: now,
  };
}

export function getRule(id: string): Rule | null {
  const db = getDb();
  const stmt = db.prepare(`SELECT * FROM rules WHERE id = ?`);
  const row = stmt.get(id) as RuleRow | undefined;
  return row ? rowToRule(row) : null;
}

export function listRules(scanner_type?: ScannerType, enabled?: boolean): Rule[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (scanner_type) {
    conditions.push("scanner_type = ?");
    params.push(scanner_type);
  }
  if (enabled !== undefined) {
    conditions.push("enabled = ?");
    params.push(enabled ? 1 : 0);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const stmt = db.prepare(`SELECT * FROM rules ${where} ORDER BY scanner_type, severity`);
  return (stmt.all(...params) as RuleRow[]).map(rowToRule);
}

export function updateRule(id: string, updates: Partial<Omit<Rule, "id" | "created_at" | "updated_at">>): void {
  const db = getDb();
  const sets: string[] = [];
  const params: unknown[] = [];

  if (updates.name !== undefined) {
    sets.push("name = ?");
    params.push(updates.name);
  }
  if (updates.description !== undefined) {
    sets.push("description = ?");
    params.push(updates.description);
  }
  if (updates.scanner_type !== undefined) {
    sets.push("scanner_type = ?");
    params.push(updates.scanner_type);
  }
  if (updates.severity !== undefined) {
    sets.push("severity = ?");
    params.push(updates.severity);
  }
  if (updates.pattern !== undefined) {
    sets.push("pattern = ?");
    params.push(updates.pattern);
  }
  if (updates.enabled !== undefined) {
    sets.push("enabled = ?");
    params.push(updates.enabled ? 1 : 0);
  }
  if (updates.builtin !== undefined) {
    sets.push("builtin = ?");
    params.push(updates.builtin ? 1 : 0);
  }
  if (updates.metadata !== undefined) {
    sets.push("metadata = ?");
    params.push(JSON.stringify(updates.metadata));
  }

  if (sets.length === 0) return;

  sets.push("updated_at = ?");
  params.push(new Date().toISOString());
  params.push(id);

  const stmt = db.prepare(`UPDATE rules SET ${sets.join(", ")} WHERE id = ?`);
  stmt.run(...params);
}

export function toggleRule(id: string, enabled: boolean): void {
  const db = getDb();
  const stmt = db.prepare(`UPDATE rules SET enabled = ?, updated_at = ? WHERE id = ?`);
  stmt.run(enabled ? 1 : 0, new Date().toISOString(), id);
}

export function seedBuiltinRules(dbOverride?: ReturnType<typeof getDb>): void {
  const db = dbOverride ?? getDb();

  const existing = db.prepare(`SELECT COUNT(*) as count FROM rules WHERE builtin = 1`).get() as { count: number };
  if (existing.count > 0) return;

  const builtinRules: Array<Omit<Rule, "id" | "created_at" | "updated_at">> = [
    // Secrets scanner rules
    {
      name: "hardcoded-api-key",
      description: "Detects hardcoded API keys in source code",
      scanner_type: ScannerType.Secrets,
      severity: Severity.High,
      pattern: "(?i)(api[_-]?key|apikey)\\s*[:=]\\s*['\"][A-Za-z0-9]{16,}['\"]",
      enabled: true,
      builtin: true,
      metadata: { category: "credentials" },
    },
    {
      name: "hardcoded-password",
      description: "Detects hardcoded passwords in source code",
      scanner_type: ScannerType.Secrets,
      severity: Severity.Critical,
      pattern: "(?i)(password|passwd|pwd)\\s*[:=]\\s*['\"][^'\"]{8,}['\"]",
      enabled: true,
      builtin: true,
      metadata: { category: "credentials" },
    },
    // Dependencies scanner rules
    {
      name: "known-vulnerable-package",
      description: "Detects packages with known vulnerabilities",
      scanner_type: ScannerType.Dependencies,
      severity: Severity.High,
      pattern: null,
      enabled: true,
      builtin: true,
      metadata: { category: "supply-chain" },
    },
    {
      name: "outdated-package",
      description: "Detects severely outdated packages that may have unpatched vulnerabilities",
      scanner_type: ScannerType.Dependencies,
      severity: Severity.Medium,
      pattern: null,
      enabled: true,
      builtin: true,
      metadata: { category: "supply-chain" },
    },
    // Code scanner rules
    {
      name: "sql-injection",
      description: "Detects potential SQL injection vulnerabilities",
      scanner_type: ScannerType.Code,
      severity: Severity.Critical,
      pattern: "(?i)(query|exec|execute)\\s*\\(.*\\+.*\\)",
      enabled: true,
      builtin: true,
      metadata: { category: "injection", cwe: "CWE-89" },
    },
    {
      name: "xss-vulnerability",
      description: "Detects potential cross-site scripting vulnerabilities",
      scanner_type: ScannerType.Code,
      severity: Severity.High,
      pattern: "(?i)innerHTML\\s*=|document\\.write\\(",
      enabled: true,
      builtin: true,
      metadata: { category: "injection", cwe: "CWE-79" },
    },
    // Git history scanner rules
    {
      name: "secret-in-history",
      description: "Detects secrets committed in git history",
      scanner_type: ScannerType.GitHistory,
      severity: Severity.High,
      pattern: null,
      enabled: true,
      builtin: true,
      metadata: { category: "credentials" },
    },
    {
      name: "large-binary-committed",
      description: "Detects large binary files committed to the repository",
      scanner_type: ScannerType.GitHistory,
      severity: Severity.Low,
      pattern: null,
      enabled: true,
      builtin: true,
      metadata: { category: "hygiene" },
    },
    // Config scanner rules
    {
      name: "insecure-tls-config",
      description: "Detects insecure TLS/SSL configuration",
      scanner_type: ScannerType.Config,
      severity: Severity.High,
      pattern: "(?i)(ssl_verify|verify_ssl|tls_verify)\\s*[:=]\\s*(false|0|no)",
      enabled: true,
      builtin: true,
      metadata: { category: "encryption" },
    },
    {
      name: "permissive-cors",
      description: "Detects overly permissive CORS configuration",
      scanner_type: ScannerType.Config,
      severity: Severity.Medium,
      pattern: "(?i)(access-control-allow-origin|cors).*\\*",
      enabled: true,
      builtin: true,
      metadata: { category: "access-control" },
    },
    // AI Safety scanner rules
    {
      name: "prompt-injection-risk",
      description: "Detects patterns vulnerable to prompt injection attacks",
      scanner_type: ScannerType.AiSafety,
      severity: Severity.High,
      pattern: "(?i)(user_input|user_message|prompt).*\\+.*",
      enabled: true,
      builtin: true,
      metadata: { category: "ai-security" },
    },
    {
      name: "unvalidated-model-output",
      description: "Detects use of model output without validation or sanitization",
      scanner_type: ScannerType.AiSafety,
      severity: Severity.Medium,
      pattern: null,
      enabled: true,
      builtin: true,
      metadata: { category: "ai-security" },
    },
  ];

  const insertStmt = db.prepare(
    `INSERT INTO rules (id, name, description, scanner_type, severity, pattern, enabled, builtin, metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const txn = db.transaction(() => {
    const now = new Date().toISOString();
    for (const rule of builtinRules) {
      insertStmt.run(
        crypto.randomUUID(),
        rule.name,
        rule.description,
        rule.scanner_type,
        rule.severity,
        rule.pattern,
        rule.enabled ? 1 : 0,
        rule.builtin ? 1 : 0,
        JSON.stringify(rule.metadata),
        now,
        now
      );
    }
  });
  // SqliteAdapter auto-executes; bun:sqlite returns a callable
  if (typeof txn === "function") txn();
}
