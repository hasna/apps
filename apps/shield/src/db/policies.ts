import crypto from "crypto";
import { getDb } from "./database.js";
import type { Policy } from "../types/index.js";
import type { Severity } from "../types/index.js";

interface PolicyRow {
  id: string;
  name: string;
  description: string;
  block_on_severity: string | null;
  auto_fix: number;
  notify: number;
  enabled: number;
  created_at: string;
  updated_at: string;
}

function rowToPolicy(row: PolicyRow): Policy {
  return {
    ...row,
    block_on_severity: (row.block_on_severity as Severity) ?? null,
    auto_fix: row.auto_fix === 1,
    notify: row.notify === 1,
    enabled: row.enabled === 1,
  };
}

export function createPolicy(
  input: Omit<Policy, "id" | "created_at" | "updated_at">
): Policy {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const stmt = db.prepare(
    `INSERT INTO policies (id, name, description, block_on_severity, auto_fix, notify, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  stmt.run(
    id,
    input.name,
    input.description,
    input.block_on_severity,
    input.auto_fix ? 1 : 0,
    input.notify ? 1 : 0,
    input.enabled ? 1 : 0,
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

export function getPolicy(id: string): Policy | null {
  const db = getDb();
  const stmt = db.prepare(`SELECT * FROM policies WHERE id = ?`);
  const row = stmt.get(id) as PolicyRow | undefined;
  return row ? rowToPolicy(row) : null;
}

export function listPolicies(): Policy[] {
  const db = getDb();
  const stmt = db.prepare(`SELECT * FROM policies ORDER BY created_at DESC`);
  return (stmt.all() as PolicyRow[]).map(rowToPolicy);
}

export function updatePolicy(
  id: string,
  updates: Partial<Omit<Policy, "id" | "created_at" | "updated_at">>
): void {
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
  if (updates.block_on_severity !== undefined) {
    sets.push("block_on_severity = ?");
    params.push(updates.block_on_severity);
  }
  if (updates.auto_fix !== undefined) {
    sets.push("auto_fix = ?");
    params.push(updates.auto_fix ? 1 : 0);
  }
  if (updates.notify !== undefined) {
    sets.push("notify = ?");
    params.push(updates.notify ? 1 : 0);
  }
  if (updates.enabled !== undefined) {
    sets.push("enabled = ?");
    params.push(updates.enabled ? 1 : 0);
  }

  if (sets.length === 0) return;

  sets.push("updated_at = ?");
  params.push(new Date().toISOString());
  params.push(id);

  const stmt = db.prepare(`UPDATE policies SET ${sets.join(", ")} WHERE id = ?`);
  stmt.run(...params);
}

export function getActivePolicy(): Policy | null {
  const db = getDb();
  const stmt = db.prepare(`SELECT * FROM policies WHERE enabled = 1 ORDER BY created_at ASC LIMIT 1`);
  const row = stmt.get() as PolicyRow | undefined;
  return row ? rowToPolicy(row) : null;
}
