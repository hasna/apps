import type { ProviderDnsRecord } from "./registrar.js";

export interface DesiredDnsState {
  domain?: string;
  records: ProviderDnsRecord[];
}

export type DnsPlanOperationType = "create" | "delete" | "update" | "unchanged";

export interface DnsPlanOperation {
  op: DnsPlanOperationType;
  record: ProviderDnsRecord;
  current?: ProviderDnsRecord;
}

export interface DnsPlan {
  domain: string;
  creates: number;
  updates: number;
  deletes: number;
  unchanged: number;
  operations: DnsPlanOperation[];
}

export type DnsApplyBlockReason = "confirmation-required" | "delete-confirmation-required" | "delete-apply-unsupported";

function recordType(value: string): string {
  return value.trim().toUpperCase();
}

export function normalizeDnsRecord(record: ProviderDnsRecord, domain: string): ProviderDnsRecord {
  const type = recordType(record.type);
  let name = record.name.trim();
  const normalizedDomain = domain.replace(/\.$/, "").toLowerCase();
  const lowerName = name.replace(/\.$/, "").toLowerCase();
  if (name === normalizedDomain || name === "@" || lowerName === normalizedDomain) {
    name = "@";
  } else if (lowerName.endsWith(`.${normalizedDomain}`)) {
    name = name.replace(/\.$/, "").slice(0, -(normalizedDomain.length + 1));
  }
  const normalized: ProviderDnsRecord = {
    type,
    name,
    value: String(record.value).trim(),
    ttl: Number.isFinite(record.ttl) && record.ttl > 0 ? Math.trunc(record.ttl) : 300,
    priority: record.priority,
  };
  if (record.proxied !== undefined) normalized.proxied = record.proxied;
  return normalized;
}

export function parseDesiredDnsState(input: string, domainHint?: string): DesiredDnsState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch (error) {
    throw new Error(`DNS desired state must be JSON for now: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!parsed || typeof parsed !== "object") throw new Error("DNS desired state must be an object");
  const obj = parsed as { domain?: unknown; records?: unknown };
  if (!Array.isArray(obj.records)) throw new Error("DNS desired state requires a records array");
  const domain = typeof obj.domain === "string" ? obj.domain : domainHint;
  if (!domain) throw new Error("DNS desired state requires a domain field or CLI domain argument");
  return {
    domain,
    records: obj.records.map((raw, index) => {
      if (!raw || typeof raw !== "object") throw new Error(`records[${index}] must be an object`);
      const r = raw as Record<string, unknown>;
      if (typeof r["type"] !== "string" || typeof r["name"] !== "string" || typeof r["value"] !== "string") {
        throw new Error(`records[${index}] requires string type, name, and value`);
      }
      return normalizeDnsRecord({
        type: r["type"],
        name: r["name"],
        value: r["value"],
        ttl: typeof r["ttl"] === "number" ? r["ttl"] : Number(r["ttl"] ?? 300),
        priority: r["priority"] == null ? undefined : Number(r["priority"]),
        proxied: typeof r["proxied"] === "boolean" ? r["proxied"] : undefined,
      }, domain);
    }),
  };
}

function identity(record: ProviderDnsRecord): string {
  return [record.type, record.name, record.value, record.priority ?? ""].join("\u0000");
}

function sameMutableFields(a: ProviderDnsRecord, b: ProviderDnsRecord): boolean {
  return a.ttl === b.ttl && (b.proxied === undefined || a.proxied === b.proxied);
}

export function createDnsPlan(domain: string, current: ProviderDnsRecord[], desired: ProviderDnsRecord[]): DnsPlan {
  const normalizedCurrent = current.map((record) => normalizeDnsRecord(record, domain));
  const normalizedDesired = desired.map((record) => normalizeDnsRecord(record, domain));
  const currentById = new Map(normalizedCurrent.map((record) => [identity(record), record]));
  const desiredById = new Map(normalizedDesired.map((record) => [identity(record), record]));
  const operations: DnsPlanOperation[] = [];

  for (const desiredRecord of normalizedDesired) {
    const currentRecord = currentById.get(identity(desiredRecord));
    if (!currentRecord) {
      operations.push({ op: "create", record: desiredRecord });
    } else if (!sameMutableFields(currentRecord, desiredRecord)) {
      operations.push({ op: "update", record: desiredRecord, current: currentRecord });
    } else {
      operations.push({ op: "unchanged", record: desiredRecord, current: currentRecord });
    }
  }

  for (const currentRecord of normalizedCurrent) {
    if (!desiredById.has(identity(currentRecord))) {
      operations.push({ op: "delete", record: currentRecord });
    }
  }

  return {
    domain,
    creates: operations.filter((op) => op.op === "create").length,
    updates: operations.filter((op) => op.op === "update").length,
    deletes: operations.filter((op) => op.op === "delete").length,
    unchanged: operations.filter((op) => op.op === "unchanged").length,
    operations,
  };
}

export function planHasChanges(plan: DnsPlan): boolean {
  return plan.creates + plan.updates + plan.deletes > 0;
}

function dnsRecordGroupKey(record: ProviderDnsRecord): string {
  return `${record.type}\u0000${record.name}`;
}

export function selectChangedDnsRecords(plan: DnsPlan, desired: ProviderDnsRecord[]): ProviderDnsRecord[] {
  const changedGroups = new Set(
    plan.operations
      .filter((operation) => operation.op !== "unchanged")
      .map((operation) => dnsRecordGroupKey(operation.record)),
  );
  return desired.filter((record) =>
    changedGroups.has(dnsRecordGroupKey(normalizeDnsRecord(record, plan.domain))),
  );
}

export function getDnsApplyBlockReason(
  plan: DnsPlan,
  opts: { yes?: boolean; allowDelete?: boolean },
  deleteSupported = false,
): DnsApplyBlockReason | undefined {
  if (!planHasChanges(plan)) return undefined;
  if (!opts.yes) return "confirmation-required";
  if (plan.deletes > 0 && !opts.allowDelete) return "delete-confirmation-required";
  if (plan.deletes > 0 && !deleteSupported) return "delete-apply-unsupported";
  return undefined;
}
