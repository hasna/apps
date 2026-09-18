/** Hosted, read-only access to the append-only memory audit log. */
import {
  AUDIT_EXPORT_CONTRACT,
  AUDIT_TRAIL_CONTRACT,
  AuditContractError,
  auditOperation,
  canonicalAuditTimestamp,
} from "../../audit-contract.js";
import {
  exportAuditLogPage,
  getAuditStats,
  getMemoryAuditTrailPage,
} from "../../db/audit.js";
import { addRoute } from "../router.js";
import { errorResponse, json } from "../helpers.js";

const MAX_LIMIT = 1000;
const MAX_CURSOR_LENGTH = 4096;

function exactQuery(url: URL, allowed: readonly string[]): void {
  const allow = new Set(allowed);
  for (const key of url.searchParams.keys()) {
    if (!allow.has(key)) throw new AuditContractError(`unsupported query parameter '${key}'`);
    if (url.searchParams.getAll(key).length !== 1) throw new AuditContractError(`query parameter '${key}' must appear exactly once`);
  }
}

function integerQuery(url: URL, name: string, fallback: number): number {
  const raw = url.searchParams.get(name);
  if (raw === null) return fallback;
  if (!/^\d+$/.test(raw)) throw new AuditContractError(`${name} must be an integer between 1 and ${MAX_LIMIT}`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_LIMIT) {
    throw new AuditContractError(`${name} must be an integer between 1 and ${MAX_LIMIT}`);
  }
  return value;
}

function cursorQuery(url: URL): string | undefined {
  const raw = url.searchParams.get("cursor");
  if (raw === null) return undefined;
  if (!raw || raw.length > MAX_CURSOR_LENGTH || !/^[A-Za-z0-9_-]+$/.test(raw)) {
    throw new AuditContractError("cursor is not a valid bounded audit cursor");
  }
  return raw;
}

function optionalIdentifier(url: URL, name: string): string | undefined {
  const raw = url.searchParams.get(name);
  if (raw === null) return undefined;
  if (!raw || raw.length > 512 || /[\u0000-\u001f\u007f]/.test(raw)) {
    throw new AuditContractError(`${name} must be a non-empty printable string of at most 512 characters`);
  }
  return raw;
}

function optionalTimestamp(url: URL, name: string): string | undefined {
  const raw = url.searchParams.get(name);
  return raw === null ? undefined : canonicalAuditTimestamp(raw, name);
}

function auditRequestError(error: unknown): Response {
  if (error instanceof AuditContractError) {
    return errorResponse(error.message, 400, { code: error.code });
  }
  throw error;
}

addRoute("GET", "/api/memories/:id/audit-trail", (_req, url, params) => {
  try {
    exactQuery(url, ["limit", "cursor"]);
    const memoryId = params.id;
    if (!memoryId || memoryId.length > 512 || /[\u0000-\u001f\u007f]/.test(memoryId)) {
      throw new AuditContractError("memory id must be a non-empty printable string of at most 512 characters");
    }
    const page = getMemoryAuditTrailPage(memoryId, {
      limit: integerQuery(url, "limit", 50),
      cursor: cursorQuery(url),
    });
    if (page.contract !== AUDIT_TRAIL_CONTRACT) throw new Error("audit trail contract mismatch");
    return json(page);
  } catch (error) {
    return auditRequestError(error);
  }
});

addRoute("GET", "/api/audit/export", (_req, url) => {
  try {
    exactQuery(url, ["since", "until", "operation", "agent_id", "limit", "cursor"]);
    const rawOperation = url.searchParams.get("operation");
    const page = exportAuditLogPage({
      since: optionalTimestamp(url, "since"),
      until: optionalTimestamp(url, "until"),
      operation: rawOperation === null ? undefined : auditOperation(rawOperation),
      agent_id: optionalIdentifier(url, "agent_id"),
      limit: integerQuery(url, "limit", 50),
      cursor: cursorQuery(url),
    });
    if (page.contract !== AUDIT_EXPORT_CONTRACT) throw new Error("audit export contract mismatch");
    return json(page);
  } catch (error) {
    return auditRequestError(error);
  }
});

addRoute("GET", "/api/audit/stats", (_req, url) => {
  try {
    exactQuery(url, []);
    return json(getAuditStats());
  } catch (error) {
    return auditRequestError(error);
  }
});
