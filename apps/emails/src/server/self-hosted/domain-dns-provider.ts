import { validateConnectionEvidence } from "./domain-connect.js";
import type { DomainDnsTask } from "./domain-connect-provider.js";

export class DomainDnsError extends Error {
  constructor(
    message: string,
    readonly status = 409,
  ) {
    super(message);
  }
}
export interface DomainDnsBinding {
  tenant_id: string;
  provider_id: string;
  domain: string;
  zone_id: string;
  zone_name: string;
  token_env: string;
  inbound_mx?: string;
}
export interface BoundDnsRecord {
  id: string;
  type: string;
  name: string;
  content: string;
  priority?: number;
  proxied?: boolean;
}
export interface DnsCreate {
  type: "CNAME" | "TXT" | "MX";
  name: string;
  content: string;
  priority?: number;
  ttl: number;
  proxied?: boolean;
}
export interface DomainDnsPlan {
  creates: DnsCreate[];
  deletes: Array<{ id: string }>;
  existing: BoundDnsRecord[];
}
const dnsName = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length <= 253 &&
  value.split(".").length >= 2 &&
  value
    .split(".")
    .every((part) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part));
const within = (name: string, parent: string) =>
  name === parent || name.endsWith(`.${parent}`);
const canonical = (value: string) => value.toLowerCase().replace(/\.$/, "");
const txt = (value: string) => value.replace(/^"(.*)"$/s, "$1");

/** Only explicit server references establish DNS authority. No ambient token fallback. */
export function resolveDnsBinding(
  env: NodeJS.ProcessEnv,
  tenant: string,
  provider: string,
  domain: string,
): DomainDnsBinding {
  let bindings: DomainDnsBinding[];
  try {
    const raw = env.EMAILS_DNS_BINDINGS;
    if (!raw || raw.length > 65536) throw new Error();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.length) throw new Error();
    for (const item of parsed) {
      if (
        !item ||
        typeof item !== "object" ||
        Array.isArray(item) ||
        Object.keys(item).some(
          (key) =>
            ![
              "tenant_id",
              "provider_id",
              "domain",
              "zone_id",
              "zone_name",
              "token_env",
              "inbound_mx",
            ].includes(key),
        ) ||
        !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(item.tenant_id) ||
        typeof item.provider_id !== "string" ||
        !item.provider_id.trim() ||
        item.provider_id.length > 256 ||
        !dnsName(item.domain) ||
        !dnsName(item.zone_name) ||
        !within(item.domain, item.zone_name) ||
        !/^[0-9a-f]{32}$/.test(item.zone_id) ||
        !/^[A-Z][A-Z0-9_]{1,127}$/.test(item.token_env) ||
        (item.inbound_mx !== undefined && !dnsName(item.inbound_mx))
      )
        throw new Error();
    }
    if (
      new Set(
        parsed.map((row) =>
          JSON.stringify([row.tenant_id, row.provider_id, row.domain]),
        ),
      ).size !== parsed.length
    )
      throw new Error();
    for (const first of parsed)
      for (const second of parsed)
        if (
          first !== second &&
          first.tenant_id !== second.tenant_id &&
          (first.zone_id === second.zone_id ||
            within(first.domain, second.domain) ||
            within(second.domain, first.domain))
        )
          throw new Error();
    bindings = parsed;
  } catch {
    throw new DomainDnsError(
      "Configure valid EMAILS_DNS_BINDINGS with exact tenant/provider/domain, zone identity and a token environment reference.",
      503,
    );
  }
  const binding = bindings.find(
    (row) =>
      row.tenant_id === tenant &&
      row.provider_id === provider &&
      row.domain === domain,
  );
  if (!binding)
    throw new DomainDnsError(
      "This tenant, provider and domain have no server DNS binding.",
      503,
    );
  if (!env[binding.token_env]?.trim())
    throw new DomainDnsError("The bound server DNS token is unavailable.", 503);
  return { ...binding };
}

export function dnsPlanConfirmed(
  plan: DomainDnsPlan,
  records: BoundDnsRecord[],
): boolean {
  return (
    plan.creates.every((target) =>
      records.some((record) => matches(record, target)),
    ) &&
    plan.deletes.every((target) =>
      records.every((record) => record.id !== target.id),
    )
  );
}
function matches(record: BoundDnsRecord, wanted: DnsCreate): boolean {
  return (
    record.type === wanted.type &&
    canonical(record.name) === wanted.name &&
    record.proxied !== true &&
    (wanted.type === "TXT"
      ? txt(record.content) === txt(wanted.content)
      : canonical(record.content) === canonical(wanted.content)) &&
    (wanted.type !== "MX" || record.priority === wanted.priority)
  );
}

/** Create missing sending records. Only explicit, bound root-MX replacement deletes records. */
export function buildDnsPlan(
  binding: DomainDnsBinding,
  tasks: DomainDnsTask[],
  records: BoundDnsRecord[],
  addMx: boolean,
  forceMx: boolean,
): DomainDnsPlan {
  validateConnectionEvidence({
    registered: true,
    verified_for_sending: false,
    dns_tasks: tasks,
  });
  if (tasks.length > 100)
    throw new DomainDnsError(
      "Provider DNS task count exceeds the publication limit.",
    );
  const wanted: DnsCreate[] = tasks.map((task) => {
    const name = canonical(task.name);
    if (
      !within(name, binding.domain) ||
      (task.type === "MX" && name === binding.domain)
    )
      throw new DomainDnsError(
        "Provider sending DNS tasks escape the bound domain or change its inbound MX.",
      );
    return {
      type: task.type,
      name,
      content: task.value,
      ttl: 300,
      ...(task.type === "MX"
        ? { priority: task.priority }
        : task.type === "CNAME"
          ? { proxied: false }
          : {}),
    };
  });
  if (addMx) {
    if (!binding.inbound_mx)
      throw new DomainDnsError(
        "Inbound MX publication requires an exact target in the server DNS binding.",
      );
    wanted.push({
      type: "MX",
      name: binding.domain,
      content: binding.inbound_mx,
      priority: 10,
      ttl: 300,
    });
  }
  const plan: DomainDnsPlan = { creates: [], deletes: [], existing: [] };
  const observed = new Set<string>();
  for (const target of wanted) {
    const identity = JSON.stringify(target);
    if (observed.has(identity)) continue;
    observed.add(identity);
    const sameName = records.filter(
      (record) => canonical(record.name) === target.name,
    );
    const exact = sameName.filter((record) => matches(record, target));
    const rootMx =
      addMx && target.type === "MX" && target.name === binding.domain;
    const incompatible = sameName.filter((record) => {
      if (matches(record, target)) return false;
      if (record.type === "CNAME" || target.type === "CNAME") return true;
      if (target.type === "TXT")
        return (
          record.type === "TXT" &&
          (target.content.toLowerCase().startsWith("v=spf1")
            ? txt(record.content).toLowerCase().startsWith("v=spf1")
            : target.name.includes("._domainkey."))
        );
      return target.type === "MX" && record.type === "MX";
    });
    if (
      incompatible.length &&
      !(
        rootMx &&
        forceMx &&
        incompatible.every((record) => record.type === "MX")
      )
    )
      throw new DomainDnsError(
        "Existing DNS records conflict with this plan. Review them explicitly; no DNS changes were accepted.",
      );
    if (rootMx && forceMx)
      for (const record of incompatible) plan.deletes.push({ id: record.id });
    if (exact.length) plan.existing.push(...exact);
    else plan.creates.push(target);
  }
  return plan;
}

export interface BoundDnsClient {
  getZone(): Promise<void>;
  listRecords(): Promise<BoundDnsRecord[]>;
  applyBatch(plan: DomainDnsPlan): Promise<void>;
}
export function createBoundDnsClient(
  binding: DomainDnsBinding,
  env: NodeJS.ProcessEnv,
  signal: AbortSignal,
  send: typeof fetch = fetch,
): BoundDnsClient {
  const token = env[binding.token_env]?.trim();
  if (!token)
    throw new DomainDnsError("The bound server DNS token is unavailable.", 503);
  const base = `https://api.cloudflare.com/client/v4/zones/${binding.zone_id}`;
  const call = async (path: string, body?: unknown) => {
    const response = await send(base + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: "error",
      signal,
    });
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new DomainDnsError(
        "The bound DNS provider did not confirm the request.",
        502,
      );
    }
    const reader = response.body.getReader(),
      chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 2 * 1048576) {
        await reader.cancel();
        throw new DomainDnsError(
          "DNS provider response exceeds the bounded inventory size.",
          502,
        );
      }
      chunks.push(value);
    }
    let result: any;
    try {
      result = JSON.parse(Buffer.concat(chunks).toString());
    } catch {
      throw new DomainDnsError(
        "The DNS provider returned malformed evidence.",
        502,
      );
    }
    if (result?.success !== true || !Object.hasOwn(result, "result"))
      throw new DomainDnsError(
        "The DNS provider did not confirm the operation.",
        502,
      );
    return result;
  };
  return {
    getZone: async () => {
      const { result } = await call("");
      if (
        result?.id !== binding.zone_id ||
        result.name !== binding.zone_name ||
        result.status !== "active"
      )
        throw new DomainDnsError(
          "The configured Cloudflare zone identity must match and be active before DNS publication.",
        );
    },
    listRecords: async () => {
      const records: BoundDnsRecord[] = [],
        seen = new Set<string>();
      let expectedPages: number | undefined,
        totalBytes = 0;
      for (let page = 1; page <= 1000; page++) {
        const { result, result_info: info } = await call(
          `/dns_records?page=${page}&per_page=100`,
        );
        if (
          !Array.isArray(result) ||
          info?.page !== page ||
          !Number.isInteger(info?.total_pages) ||
          info.total_pages < 0 ||
          info.total_pages > 1000 ||
          (expectedPages !== undefined && expectedPages !== info.total_pages)
        )
          throw new DomainDnsError(
            "DNS inventory changed or could not be read completely; retry before publishing.",
          );
        expectedPages = info.total_pages;
        totalBytes += Buffer.byteLength(JSON.stringify(result));
        if (totalBytes > 16 * 1048576)
          throw new DomainDnsError(
            "Complete DNS inventory exceeds the 16 MiB memory bound; no changes were accepted.",
          );
        for (const record of result) {
          if (
            !record ||
            typeof record.id !== "string" ||
            !record.id ||
            seen.has(record.id) ||
            typeof record.type !== "string" ||
            typeof record.name !== "string" ||
            typeof record.content !== "string" ||
            !within(canonical(record.name), binding.zone_name) ||
            (record.type === "MX" &&
              (!Number.isInteger(record.priority) ||
                record.priority < 0 ||
                record.priority > 65535))
          )
            throw new DomainDnsError(
              "DNS inventory has ambiguous or malformed record evidence.",
            );
          seen.add(record.id);
          records.push(record);
        }
        if (page >= info.total_pages) return records;
      }
      throw new DomainDnsError(
        "DNS inventory exceeds the complete-read bound.",
      );
    },
    applyBatch: async (plan) => {
      if (plan.creates.length + plan.deletes.length > 200)
        throw new DomainDnsError("DNS plan exceeds the batch limit.");
      if (plan.creates.length || plan.deletes.length)
        await call("/dns_records/batch", {
          posts: plan.creates,
          deletes: plan.deletes,
        });
    },
  };
}
