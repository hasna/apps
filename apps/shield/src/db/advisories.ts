import { getDb } from "./database.js";
import type {
  Advisory,
  AdvisoryIOC,
  MonitoredPackage,
  RegistryEvent,
  Severity,
  Ecosystem,
  IOCType,
  AttackType,
} from "../types/index.js";

// --- Advisories ---

export function createAdvisory(input: {
  package_name: string;
  ecosystem: Ecosystem;
  affected_versions: string[];
  safe_versions: string[];
  attack_type: AttackType;
  severity: Severity;
  title: string;
  description: string;
  source: string;
  cve_id?: string;
  threat_actor?: string;
  detected_at?: string;
  resolved_at?: string;
}): Advisory {
  const db = getDb();
  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 32);
  db.prepare(`
    INSERT INTO advisories (id, package_name, ecosystem, affected_versions, safe_versions, attack_type, severity, title, description, source, cve_id, threat_actor, detected_at, resolved_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.package_name,
    input.ecosystem,
    JSON.stringify(input.affected_versions),
    JSON.stringify(input.safe_versions),
    input.attack_type,
    input.severity,
    input.title,
    input.description,
    input.source,
    input.cve_id ?? null,
    input.threat_actor ?? null,
    input.detected_at ?? new Date().toISOString(),
    input.resolved_at ?? null,
  );
  return getAdvisory(id)!;
}

export function getAdvisory(id: string): Advisory | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM advisories WHERE id = ?").get(id) as any;
  if (!row) return null;
  return {
    ...row,
    affected_versions: JSON.parse(row.affected_versions),
    safe_versions: JSON.parse(row.safe_versions),
  };
}

export function getAdvisoryByPackage(packageName: string, ecosystem: string): Advisory[] {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM advisories WHERE package_name = ? AND ecosystem = ? ORDER BY detected_at DESC").all(packageName, ecosystem) as any[];
  return rows.map((row) => ({
    ...row,
    affected_versions: JSON.parse(row.affected_versions),
    safe_versions: JSON.parse(row.safe_versions),
  }));
}

export function listAdvisories(options?: {
  ecosystem?: string;
  severity?: string;
  attack_type?: string;
  limit?: number;
  offset?: number;
}): Advisory[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: any[] = [];

  if (options?.ecosystem) {
    conditions.push("ecosystem = ?");
    params.push(options.ecosystem);
  }
  if (options?.severity) {
    conditions.push("severity = ?");
    params.push(options.severity);
  }
  if (options?.attack_type) {
    conditions.push("attack_type = ?");
    params.push(options.attack_type);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = options?.limit ?? 100;
  const offset = options?.offset ?? 0;

  const rows = db.prepare(`SELECT * FROM advisories ${where} ORDER BY detected_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset) as any[];
  return rows.map((row) => ({
    ...row,
    affected_versions: JSON.parse(row.affected_versions),
    safe_versions: JSON.parse(row.safe_versions),
  }));
}

export function searchAdvisories(query: string): Advisory[] {
  const db = getDb();
  const pattern = `%${query}%`;
  const rows = db.prepare(`
    SELECT * FROM advisories
    WHERE package_name LIKE ? OR title LIKE ? OR description LIKE ? OR threat_actor LIKE ?
    ORDER BY detected_at DESC LIMIT 50
  `).all(pattern, pattern, pattern, pattern) as any[];
  return rows.map((row) => ({
    ...row,
    affected_versions: JSON.parse(row.affected_versions),
    safe_versions: JSON.parse(row.safe_versions),
  }));
}

export function isVersionAffected(packageName: string, ecosystem: string, version: string): Advisory | null {
  const advisories = getAdvisoryByPackage(packageName, ecosystem);
  for (const advisory of advisories) {
    if (advisory.affected_versions.includes(version)) {
      return advisory;
    }
  }
  return null;
}

// --- Advisory IOCs ---

export function createAdvisoryIOC(input: {
  advisory_id: string;
  type: IOCType;
  value: string;
  context?: string;
  platform?: string;
}): AdvisoryIOC {
  const db = getDb();
  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 32);
  db.prepare(`
    INSERT INTO advisory_iocs (id, advisory_id, type, value, context, platform)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, input.advisory_id, input.type, input.value, input.context ?? null, input.platform ?? null);
  return db.prepare("SELECT * FROM advisory_iocs WHERE id = ?").get(id) as AdvisoryIOC;
}

export function getIOCsForAdvisory(advisoryId: string): AdvisoryIOC[] {
  const db = getDb();
  return db.prepare("SELECT * FROM advisory_iocs WHERE advisory_id = ?").all(advisoryId) as AdvisoryIOC[];
}

export function getAllIOCs(): AdvisoryIOC[] {
  const db = getDb();
  return db.prepare("SELECT * FROM advisory_iocs ORDER BY type").all() as AdvisoryIOC[];
}

export function findIOCByValue(value: string): AdvisoryIOC[] {
  const db = getDb();
  return db.prepare("SELECT * FROM advisory_iocs WHERE value = ? OR value LIKE ?").all(value, `%${value}%`) as AdvisoryIOC[];
}

// --- Monitored Packages ---

export function addMonitoredPackage(input: {
  name: string;
  ecosystem: Ecosystem;
  check_interval_ms?: number;
  metadata?: Record<string, unknown>;
}): MonitoredPackage {
  const db = getDb();
  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 32);
  db.prepare(`
    INSERT INTO monitored_packages (id, name, ecosystem, check_interval_ms, metadata)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, input.name, input.ecosystem, input.check_interval_ms ?? 300000, JSON.stringify(input.metadata ?? {}));
  return db.prepare("SELECT * FROM monitored_packages WHERE id = ?").get(id) as any;
}

export function listMonitoredPackages(status?: string): MonitoredPackage[] {
  const db = getDb();
  if (status) {
    return db.prepare("SELECT * FROM monitored_packages WHERE status = ?").all(status) as any[];
  }
  return db.prepare("SELECT * FROM monitored_packages").all() as any[];
}

export function updateMonitoredPackage(id: string, updates: Partial<Pick<MonitoredPackage, "status" | "last_checked_at">>): void {
  const db = getDb();
  const sets: string[] = [];
  const params: any[] = [];
  if (updates.status !== undefined) { sets.push("status = ?"); params.push(updates.status); }
  if (updates.last_checked_at !== undefined) { sets.push("last_checked_at = ?"); params.push(updates.last_checked_at); }
  if (sets.length === 0) return;
  params.push(id);
  db.prepare(`UPDATE monitored_packages SET ${sets.join(", ")} WHERE id = ?`).run(...params);
}

// --- Registry Events ---

export function createRegistryEvent(input: {
  package_name: string;
  version: string;
  ecosystem: Ecosystem;
  event_type: "publish" | "unpublish" | "maintainer-change" | "tag-update";
  timestamp?: string;
  suspicious?: boolean;
  analysis?: string;
  advisory_id?: string;
}): RegistryEvent {
  const db = getDb();
  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 32);
  db.prepare(`
    INSERT INTO registry_events (id, package_name, version, ecosystem, event_type, timestamp, suspicious, analysis, advisory_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.package_name,
    input.version,
    input.ecosystem,
    input.event_type,
    input.timestamp ?? new Date().toISOString(),
    input.suspicious ? 1 : 0,
    input.analysis ?? null,
    input.advisory_id ?? null,
  );
  return db.prepare("SELECT * FROM registry_events WHERE id = ?").get(id) as any;
}

export function listRegistryEvents(options?: {
  package_name?: string;
  suspicious_only?: boolean;
  limit?: number;
}): RegistryEvent[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: any[] = [];

  if (options?.package_name) {
    conditions.push("package_name = ?");
    params.push(options.package_name);
  }
  if (options?.suspicious_only) {
    conditions.push("suspicious = 1");
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = options?.limit ?? 100;

  return db.prepare(`SELECT * FROM registry_events ${where} ORDER BY timestamp DESC LIMIT ?`).all(...params, limit) as any[];
}
