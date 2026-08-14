import type { Database } from "bun:sqlite";
import { getDatabase, now, uuid } from "./database.ts";
import type { Domain } from "../types/index.ts";
import { NotFoundError, ValidationError } from "../types/index.ts";

interface RawDomain {
  id: string; workspace_id: string | null; project_id: string | null;
  domain: string; verified: number; verified_at: string | null;
  tls_cert: string | null; tls_key: string | null; created_at: string;
}

function rowToDomain(r: RawDomain): Domain {
  return { id: r.id, workspace_id: r.workspace_id, project_id: r.project_id, domain: r.domain, verified: r.verified === 1, verified_at: r.verified_at, tls_cert: r.tls_cert, tls_key: r.tls_key, created_at: r.created_at };
}

export function createDomain(domain: string, options: { project_id?: string; workspace_id?: string } = {}, db?: Database): Domain {
  const database = db ?? getDatabase();
  if (!domain.trim()) throw new ValidationError("Domain is required");
  const clean = domain.toLowerCase().trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
  const id = uuid();
  const n = now();
  try {
    database.run(
      "INSERT INTO domains (id, workspace_id, project_id, domain, verified, created_at) VALUES (?, ?, ?, ?, 0, ?)",
      [id, options.workspace_id ?? null, options.project_id ?? null, clean, n]
    );
  } catch { throw new ValidationError(`Domain "${clean}" is already registered`); }
  return { id, workspace_id: options.workspace_id ?? null, project_id: options.project_id ?? null, domain: clean, verified: false, verified_at: null, tls_cert: null, tls_key: null, created_at: n };
}

export function getDomainByName(domain: string, db?: Database): Domain | null {
  const database = db ?? getDatabase();
  const clean = domain.toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "").split(":")[0]!; // strip port
  const row = database.query<RawDomain, [string]>("SELECT * FROM domains WHERE domain = ?").get(clean);
  return row ? rowToDomain(row) : null;
}

export function listDomains(options: { project_id?: string; workspace_id?: string } = {}, db?: Database): Domain[] {
  const database = db ?? getDatabase();
  if (options.project_id) return database.query<RawDomain, [string]>("SELECT * FROM domains WHERE project_id = ?").all(options.project_id).map(rowToDomain);
  if (options.workspace_id) return database.query<RawDomain, [string]>("SELECT * FROM domains WHERE workspace_id = ?").all(options.workspace_id).map(rowToDomain);
  return database.query<RawDomain, []>("SELECT * FROM domains ORDER BY created_at DESC").all().map(rowToDomain);
}

export function verifyDomain(id: string, db?: Database): Domain {
  const database = db ?? getDatabase();
  const row = database.query<RawDomain, [string]>("SELECT * FROM domains WHERE id = ?").get(id);
  if (!row) throw new NotFoundError("Domain", id);
  const n = now();
  database.run("UPDATE domains SET verified = 1, verified_at = ? WHERE id = ?", [n, id]);
  return rowToDomain({ ...row, verified: 1, verified_at: n });
}

export function deleteDomain(id: string, db?: Database): void {
  const database = db ?? getDatabase();
  const result = database.run("DELETE FROM domains WHERE id = ?", [id]);
  if (result.changes === 0) throw new NotFoundError("Domain", id);
}

/** Generate a DNS TXT verification token for a domain */
export function generateVerificationToken(domainId: string, secret: string): string {
  // Use HMAC-like deterministic token: hex of domainId+secret
  const combined = `${domainId}:${secret}`;
  let hash = 0;
  for (let i = 0; i < combined.length; i++) {
    hash = ((hash << 5) - hash) + combined.charCodeAt(i);
    hash |= 0;
  }
  return `tickets-verify=${Math.abs(hash).toString(16).padStart(8, "0")}${domainId.slice(0, 8)}`;
}
