import type { Database } from "bun:sqlite";
import type { Finding, Scan } from "../types/index.js";
import { ScanStatus, ScannerType, Severity } from "../types/index.js";
import {
  containsCredentialLikeText,
  opaqueIdentifierForStorage,
  sanitizeFindingForOutput,
  sanitizeFingerprintForOutput,
  sanitizeLocationForOutput,
  sanitizeScanForOutput,
  sanitizeTextForBoundary,
  sanitizeValueForBoundary,
} from "../lib/finding-safety.js";

type RawRow = Record<string, unknown>;
type IdTable = "baselines" | "findings" | "llm_cache" | "projects" | "rules" | "scans";

export interface LegacyCredentialScrubResult {
  baselineIds: Map<string, string>;
  findingIds: Map<string, string>;
  llmCacheIds: Map<string, string>;
  projectIds: Map<string, string>;
  ruleIds: Map<string, string>;
  scanIds: Map<string, string>;
}

export function legacyRowContainsCredential(row: RawRow): boolean {
  return Object.values(row).some((value) =>
    typeof value === "string" && containsCredentialLikeText(value));
}

function emptyResult(): LegacyCredentialScrubResult {
  return {
    baselineIds: new Map(),
    findingIds: new Map(),
    llmCacheIds: new Map(),
    projectIds: new Map(),
    ruleIds: new Map(),
    scanIds: new Map(),
  };
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    // The invalid legacy payload is replaced below rather than surfaced.
  }
  return [sanitizeTextForBoundary(value, 12_000)];
}

function sanitizeJsonText(value: string): string {
  try {
    return JSON.stringify(sanitizeValueForBoundary(JSON.parse(value)));
  } catch {
    return JSON.stringify(sanitizeTextForBoundary(value, 12_000));
  }
}

export function sanitizeCachedResultText(value: string): string {
  try {
    const parsed = sanitizeValueForBoundary(JSON.parse(value));
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return JSON.stringify(parsed);
    }
    return JSON.stringify({ legacy_cache_value: parsed });
  } catch {
    return JSON.stringify({
      legacy_cache_value: sanitizeTextForBoundary(value, 12_000),
    });
  }
}

function buildIdMap(
  db: Database,
  table: IdTable,
  kind: string,
  rows: RawRow[],
): Map<string, string> {
  const map = new Map<string, string>();
  const reserved = new Set(
    (db.prepare(`SELECT id FROM ${table}`).all() as Array<{ id: string }>).map(({ id }) => id),
  );
  for (const row of rows) {
    const oldId = String(row.id);
    if (!containsCredentialLikeText(oldId)) {
      map.set(oldId, oldId);
      continue;
    }
    let attempt = 0;
    let candidate = opaqueIdentifierForStorage(oldId, kind, attempt);
    while (reserved.has(candidate) && candidate !== oldId) {
      candidate = opaqueIdentifierForStorage(oldId, kind, ++attempt);
    }
    reserved.add(candidate);
    map.set(oldId, candidate);
  }
  return map;
}

function hasAnyUnsafeRows(db: Database): boolean {
  for (const table of [
    "projects",
    "scans",
    "rules",
    "findings",
    "baselines",
    "llm_cache",
  ] as const) {
    const rows = db.prepare(`SELECT * FROM ${table}`).all() as RawRow[];
    if (rows.some(legacyRowContainsCredential)) return true;
  }
  return false;
}

/**
 * Atomically replace every credential-bearing string in the connected
 * Project/Scan/Rule/Finding graph. Parent rows are inserted before foreign
 * keys move and deleted only after all children point at durable opaque IDs.
 */
export function scrubLegacyCredentialRows(db: Database): LegacyCredentialScrubResult {
  if (!hasAnyUnsafeRows(db)) return emptyResult();

  const transaction = db.transaction((): LegacyCredentialScrubResult => {
    const projects = db.prepare("SELECT * FROM projects").all() as RawRow[];
    const scans = db.prepare("SELECT * FROM scans").all() as RawRow[];
    const rules = db.prepare("SELECT * FROM rules").all() as RawRow[];
    const findings = db.prepare("SELECT * FROM findings").all() as RawRow[];
    const baselines = db.prepare("SELECT * FROM baselines").all() as RawRow[];
    const llmCache = db.prepare("SELECT * FROM llm_cache").all() as RawRow[];
    const projectIds = buildIdMap(db, "projects", "PROJECT-ID", projects);
    const scanIds = buildIdMap(db, "scans", "SCAN-ID", scans);
    const ruleIds = buildIdMap(db, "rules", "RULE-ID", rules);
    const findingIds = buildIdMap(db, "findings", "FINDING-ID", findings);
    const baselineIds = buildIdMap(db, "baselines", "BASELINE-ID", baselines);
    const llmCacheIds = buildIdMap(db, "llm_cache", "LLM-CACHE-ID", llmCache);

    for (const row of projects) {
      const oldId = String(row.id);
      const id = projectIds.get(oldId)!;
      const values = [
        id,
        sanitizeTextForBoundary(String(row.name), 256),
        sanitizeLocationForOutput(String(row.path)),
        sanitizeTextForBoundary(String(row.created_at), 128),
        sanitizeTextForBoundary(String(row.updated_at), 128),
      ];
      if (id === oldId) {
        db.prepare(
          "UPDATE projects SET name = ?, path = ?, created_at = ?, updated_at = ? WHERE id = ?",
        ).run(values[1], values[2], values[3], values[4], oldId);
      } else {
        db.prepare(
          "INSERT INTO projects (id, name, path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        ).run(...values);
      }
    }

    for (const row of scans) {
      const oldId = String(row.id);
      const id = scanIds.get(oldId)!;
      const rawScan: Scan = {
        id,
        project_id: projectIds.get(String(row.project_id)) ?? String(row.project_id),
        status: String(row.status) as ScanStatus,
        scanner_types: parseStringArray(String(row.scanner_types)) as ScannerType[],
        findings_count: Number(row.findings_count),
        started_at: String(row.started_at),
        completed_at: row.completed_at == null ? null : String(row.completed_at),
        duration_ms: row.duration_ms == null ? null : Number(row.duration_ms),
        error: row.error == null ? null : String(row.error),
        created_at: String(row.created_at),
      };
      const safe = sanitizeScanForOutput(rawScan);
      const values = [
        id,
        rawScan.project_id,
        safe.status,
        JSON.stringify(safe.scanner_types),
        safe.findings_count,
        safe.started_at,
        safe.completed_at,
        safe.duration_ms,
        safe.error,
        safe.created_at,
      ];
      if (id === oldId) {
        db.prepare(
          `UPDATE scans SET project_id = ?, status = ?, scanner_types = ?, findings_count = ?,
           started_at = ?, completed_at = ?, duration_ms = ?, error = ?, created_at = ? WHERE id = ?`,
        ).run(...values.slice(1), oldId);
      } else {
        db.prepare(
          `INSERT INTO scans
            (id, project_id, status, scanner_types, findings_count, started_at, completed_at, duration_ms, error, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(...values);
      }
    }

    for (const row of rules) {
      const oldId = String(row.id);
      const id = ruleIds.get(oldId)!;
      const values = [
        id,
        sanitizeTextForBoundary(String(row.name), 256),
        sanitizeTextForBoundary(String(row.description), 512),
        sanitizeTextForBoundary(String(row.scanner_type), 128),
        sanitizeTextForBoundary(String(row.severity), 128),
        row.pattern == null ? null : sanitizeTextForBoundary(String(row.pattern), 12_000),
        Number(row.enabled),
        Number(row.builtin),
        sanitizeJsonText(String(row.metadata)),
        sanitizeTextForBoundary(String(row.created_at), 128),
        sanitizeTextForBoundary(String(row.updated_at), 128),
      ];
      if (id === oldId) {
        db.prepare(
          `UPDATE rules SET name = ?, description = ?, scanner_type = ?, severity = ?, pattern = ?,
           enabled = ?, builtin = ?, metadata = ?, created_at = ?, updated_at = ? WHERE id = ?`,
        ).run(...values.slice(1), oldId);
      } else {
        db.prepare(
          `INSERT INTO rules
            (id, name, description, scanner_type, severity, pattern, enabled, builtin, metadata, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(...values);
      }
    }

    const fingerprintChanges = new Map<string, string>();
    for (const row of findings) {
      const oldId = String(row.id);
      const id = findingIds.get(oldId)!;
      const raw: Finding = {
        id,
        scan_id: scanIds.get(String(row.scan_id)) ?? String(row.scan_id),
        rule_id: ruleIds.get(String(row.rule_id)) ?? String(row.rule_id),
        scanner_type: String(row.scanner_type) as ScannerType,
        severity: String(row.severity) as Severity,
        file: String(row.file),
        line: Number(row.line),
        column: row.column == null ? null : Number(row.column),
        end_line: row.end_line == null ? null : Number(row.end_line),
        message: String(row.message),
        code_snippet: row.code_snippet == null ? null : String(row.code_snippet),
        fingerprint: String(row.fingerprint),
        suppressed: Number(row.suppressed) === 1,
        suppressed_reason: row.suppressed_reason == null ? null : String(row.suppressed_reason),
        llm_explanation: row.llm_explanation == null ? null : String(row.llm_explanation),
        llm_fix: row.llm_fix == null ? null : String(row.llm_fix),
        llm_exploitability: row.llm_exploitability == null ? null : Number(row.llm_exploitability),
        created_at: String(row.created_at),
      };
      const safe = sanitizeFindingForOutput(raw);
      fingerprintChanges.set(String(row.fingerprint), safe.fingerprint);
      db.prepare(
        `UPDATE findings SET id = ?, scan_id = ?, rule_id = ?, scanner_type = ?, severity = ?, file = ?,
         line = ?, "column" = ?, end_line = ?, message = ?, code_snippet = ?, fingerprint = ?, suppressed = ?,
         suppressed_reason = ?, llm_explanation = ?, llm_fix = ?, llm_exploitability = ?, created_at = ?
         WHERE id = ?`,
      ).run(
        id,
        raw.scan_id,
        raw.rule_id,
        safe.scanner_type,
        safe.severity,
        safe.file,
        safe.line,
        safe.column,
        safe.end_line,
        safe.message,
        safe.code_snippet,
        safe.fingerprint,
        safe.suppressed ? 1 : 0,
        safe.suppressed_reason,
        safe.llm_explanation,
        safe.llm_fix,
        safe.llm_exploitability,
        safe.created_at,
        oldId,
      );
    }

    for (const row of baselines) {
      const oldId = String(row.id);
      const id = baselineIds.get(oldId)!;
      const oldFingerprint = String(row.finding_fingerprint);
      const safeFingerprint = fingerprintChanges.get(oldFingerprint)
        ?? sanitizeFingerprintForOutput(oldFingerprint);
      db.prepare(
        `UPDATE baselines SET id = ?, finding_fingerprint = ?, reason = ?, created_by = ?, created_at = ?
         WHERE id = ?`,
      ).run(
        id,
        safeFingerprint,
        sanitizeTextForBoundary(String(row.reason), 512),
        sanitizeTextForBoundary(String(row.created_by), 256),
        sanitizeTextForBoundary(String(row.created_at), 128),
        oldId,
      );
    }

    const cachePlans = llmCache.map((row, index) => {
      const oldId = String(row.id);
      const oldFingerprint = String(row.finding_fingerprint);
      const baseSafeAnalysisType = sanitizeTextForBoundary(String(row.analysis_type), 128);
      return {
        index,
        row,
        oldId,
        id: llmCacheIds.get(oldId)!,
        oldFingerprint,
        safeFingerprint: fingerprintChanges.get(oldFingerprint)
          ?? sanitizeFingerprintForOutput(oldFingerprint),
        oldAnalysisType: String(row.analysis_type),
        baseSafeAnalysisType,
        safeAnalysisType: baseSafeAnalysisType,
      };
    });
    const reservedLookupKeys = new Set(
      cachePlans.map((plan) => JSON.stringify([plan.oldFingerprint, plan.oldAnalysisType])),
    );
    const canonicalLookupOwners = new Map<string, number>();
    for (const [index, plan] of cachePlans.entries()) {
      const safeKey = JSON.stringify([plan.safeFingerprint, plan.safeAnalysisType]);
      const currentKey = JSON.stringify([plan.oldFingerprint, plan.oldAnalysisType]);
      const existing = canonicalLookupOwners.get(safeKey);
      if (existing === undefined || (currentKey === safeKey && JSON.stringify([
        cachePlans[existing].oldFingerprint,
        cachePlans[existing].oldAnalysisType,
      ]) !== safeKey)) {
        canonicalLookupOwners.set(safeKey, index);
      }
    }
    for (const safeKey of canonicalLookupOwners.keys()) reservedLookupKeys.add(safeKey);
    for (const [index, plan] of cachePlans.entries()) {
      const safeKey = JSON.stringify([plan.safeFingerprint, plan.safeAnalysisType]);
      if (canonicalLookupOwners.get(safeKey) === index) continue;
      let attempt = 0;
      let collisionSafeType = opaqueIdentifierForStorage(
        `${plan.oldFingerprint}\0${plan.oldAnalysisType}\0${plan.oldId}`,
        "ANALYSIS-TYPE",
        attempt,
      );
      let collisionKey = JSON.stringify([plan.safeFingerprint, collisionSafeType]);
      while (reservedLookupKeys.has(collisionKey)) {
        collisionSafeType = opaqueIdentifierForStorage(
          `${plan.oldFingerprint}\0${plan.oldAnalysisType}\0${plan.oldId}`,
          "ANALYSIS-TYPE",
          ++attempt,
        );
        collisionKey = JSON.stringify([plan.safeFingerprint, collisionSafeType]);
      }
      plan.safeAnalysisType = collisionSafeType;
      reservedLookupKeys.add(collisionKey);
    }

    // Move colliding legacy keys away from every canonical target first. This
    // preserves every cache row without violating the production unique index.
    for (const plan of cachePlans) {
      const canonicalKey = JSON.stringify([
        plan.safeFingerprint,
        plan.baseSafeAnalysisType,
      ]);
      if (canonicalLookupOwners.get(canonicalKey) === plan.index) continue;
      db.prepare("UPDATE llm_cache SET analysis_type = ? WHERE id = ?")
        .run(plan.safeAnalysisType, plan.oldId);
    }

    for (const plan of cachePlans) {
      const { row, oldId, id, safeFingerprint, safeAnalysisType } = plan;
      db.prepare(
        `UPDATE llm_cache SET id = ?, finding_fingerprint = ?, analysis_type = ?, result = ?,
         model = ?, created_at = ? WHERE id = ?`,
      ).run(
        id,
        safeFingerprint,
        safeAnalysisType,
        sanitizeCachedResultText(String(row.result)),
        sanitizeTextForBoundary(String(row.model), 256),
        sanitizeTextForBoundary(String(row.created_at), 128),
        oldId,
      );
    }

    for (const [oldId, id] of scanIds) {
      if (oldId !== id) db.prepare("DELETE FROM scans WHERE id = ?").run(oldId);
    }
    for (const [oldId, id] of ruleIds) {
      if (oldId !== id) db.prepare("DELETE FROM rules WHERE id = ?").run(oldId);
    }
    for (const [oldId, id] of projectIds) {
      if (oldId !== id) db.prepare("DELETE FROM projects WHERE id = ?").run(oldId);
    }

    if ((db.prepare("PRAGMA foreign_key_check").all() as unknown[]).length > 0) {
      throw new Error("legacy credential scrub violated referential integrity");
    }
    if (hasAnyUnsafeRows(db)) {
      throw new Error("legacy credential scrub left unsafe rows");
    }
    return { baselineIds, findingIds, llmCacheIds, projectIds, ruleIds, scanIds };
  });

  try {
    const immediate = transaction as typeof transaction & { immediate?: () => LegacyCredentialScrubResult };
    return typeof immediate.immediate === "function" ? immediate.immediate() : transaction();
  } catch {
    // Fail closed and never surface SQLite diagnostics that may repeat a
    // credential-bearing legacy identifier.
    throw new Error("Unable to durably sanitize legacy credential data");
  }
}
