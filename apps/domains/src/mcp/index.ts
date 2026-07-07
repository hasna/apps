#!/usr/bin/env bun

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  createDomain as createDomainRouted,
  listDomains as listDomainsRouted,
  updateDomain as updateDomainRouted,
  deleteDomain as deleteDomainRouted,
} from "../db/cloud-store.js";
import {
  DOMAIN_EMAIL_TYPES,
  DOMAIN_OFFER_STATUSES,
  DOMAIN_STATUSES,
  createDomain,
  getDomain,
  getDomainDetails,
  getDomainByIdentifier,
  updateDomain,
  markDomainPremium,
  createDomainOffer,
  listDomainOffers,
  updateDomainLifecycleStatus,
  recordDomainPurchase,
  linkDomainEmail,
  listDomainEmailLinks,
  countDomains,
  searchDomains,
  getByRegistrar,
  listExpiring,
  listSslExpiring,
  getDomainStats,
  createDnsRecord,
  listDnsRecords,
  updateDnsRecord,
  deleteDnsRecord,
  createAlert,
  listAlerts,
  deleteAlert,
  whoisLookup,
  checkDnsPropagation,
  checkSsl,
  exportZoneFile,
  importZoneFile,
  discoverSubdomains,
  validateDns,
  exportPortfolio,
  checkAllDomains,
  getDomainByName,
  type Alert,
  type BulkCheckResult,
  type DnsRecord,
  type Domain,
  type DomainEmailLink,
  type DomainOffer,
} from "../db/domains.js";
import {
  syncToLocalDb,
  renewDomain as namecheapRenew,
  checkAvailability as namecheapCheck,
} from "../lib/namecheap.js";
import {
  syncToLocalDb as godaddySyncToLocalDb,
  renewDomain as godaddyRenewDomain,
} from "../lib/godaddy.js";
import {
  getAvailableProviders,
  getRegistrarProvider,
  getDnsProvider,
  syncAll,
} from "../lib/registrar.js";
import { loadConfig, resolveContact } from "../lib/config.js";
import { ensureZone as cfEnsureZone } from "../lib/cloudflare.js";
import {
  monitorBrand,
  getSimilarDomains,
  getThreatAssessment,
} from "../lib/brandsight.js";
import { getPackageVersion } from "../lib/version.js";
import {
  createDomainOwner,
  getDomainOwner,
  getDomainOwnerByDomain,
  listDomainOwners,
  updateDomainOwner,
  deleteDomainOwner,
  extractOwnerFromWhois,
  listDomainsWithOwners,
} from "../db/domain-owners.js";
import { DOMAIN_OWNER_SOURCES } from "../db/domain-owners.js";
import {
  checkAvailability as r53CheckAvailability,
  registerDomain as r53RegisterDomain,
  getRegistrationStatus as r53GetRegistrationStatus,
  listRegisteredDomains as r53ListRegisteredDomains,
  getDomainDetail as r53GetDomainDetail,
  createHostedZone as r53CreateHostedZone,
  listHostedZones as r53ListHostedZones,
  getHostedZone as r53GetHostedZone,
  deleteHostedZone as r53DeleteHostedZone,
  findHostedZoneByDomain as r53FindHostedZoneByDomain,
  listRecords as r53ListRecords,
  upsertRecord as r53UpsertRecord,
  deleteRecord as r53DeleteRecord,
  upsertRecords as r53UpsertRecords,
  createRoute53Provider,
  updateNameservers as r53UpdateNameservers,
  type HostedZoneInfo,
  type RegisteredDomain,
  type Route53Record,
} from "../lib/route53.js";
import { registerDomainsStorageTools } from "./storage-tools.js";
import { applySafeModeToolFilter } from "./tool-filter.js";
import { formatDate, pageItems, truncateText } from "../lib/compact-output.js";
import type { DomainOwner, DomainWithOwner } from "../db/domain-owners.js";

type ListParams = {
  limit?: number;
  offset?: number;
  all?: boolean;
  verbose?: boolean;
};

const listControls = {
  limit: z.number().int().nonnegative().optional().describe("Maximum number of items to return in compact output."),
  offset: z.number().int().nonnegative().optional().describe("Number of matching items to skip."),
  all: z.boolean().optional().describe("Return all matching items instead of the compact default page."),
  verbose: z.boolean().optional().describe("Return full records instead of compact summaries."),
};

function json(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function mcpHint(
  page: { shown: number; total: number; limit: number; offset: number; hasMore: boolean },
  noun: string,
  detailHint: string,
): string {
  const paging = page.hasMore ? `; set limit=${page.limit} and offset=${page.offset + page.shown} for more` : "";
  return `Showing ${page.shown}/${page.total} ${noun}${paging}. ${detailHint}`;
}

function pagedJson<T, U>(
  key: string,
  items: T[],
  params: ListParams | undefined,
  summarize: (item: T) => U,
  noun: string,
  detailHint: string,
  extra: Record<string, unknown> = {},
) {
  const page = pageItems(items, {
    limit: params?.limit,
    offset: params?.offset,
    all: params?.all,
  });
  return json({
    ...extra,
    [key]: params?.verbose ? page.items : page.items.map(summarize),
    count: page.shown,
    total: page.total,
    limit: page.limit,
    offset: page.offset,
    has_more: page.hasMore,
    next_offset: page.hasMore ? page.offset + page.shown : null,
    compact: !params?.verbose,
    hint: mcpHint(page, noun, detailHint),
  });
}

function compactDomain(domain: Domain) {
  return {
    id: domain.id,
    name: domain.name,
    status: domain.status,
    registrar: domain.registrar ?? undefined,
    expires_at: domain.expires_at ? formatDate(domain.expires_at) : undefined,
    ssl_expires_at: domain.ssl_expires_at ? formatDate(domain.ssl_expires_at) : undefined,
    auto_renew: domain.auto_renew,
    premium: domain.is_premium || undefined,
    notes: domain.notes ? truncateText(domain.notes, 90) : undefined,
  };
}

function compactDnsRecord(record: DnsRecord) {
  return {
    id: record.id,
    type: record.type,
    name: record.name,
    value: truncateText(record.value, 90),
    ttl: record.ttl,
    priority: record.priority ?? undefined,
  };
}

function compactOffer(offer: DomainOffer) {
  return {
    id: offer.id,
    status: offer.status,
    our_offer: offer.our_offer ?? undefined,
    their_ask: offer.their_ask ?? undefined,
    created_at: formatDate(offer.created_at),
    notes: offer.notes ? truncateText(offer.notes, 100) : undefined,
  };
}

function compactEmailLink(email: DomainEmailLink) {
  return {
    id: email.id,
    type: email.type,
    email_id: email.email_id,
    thread_id: email.thread_id ?? undefined,
    created_at: formatDate(email.created_at),
  };
}

function compactAlert(alert: Alert) {
  return {
    id: alert.id,
    type: alert.type,
    trigger_days_before: alert.trigger_days_before ?? undefined,
    sent_at: alert.sent_at ? formatDate(alert.sent_at) : undefined,
  };
}

function compactOwner(owner: DomainOwner) {
  return {
    id: owner.id,
    domain_id: owner.domain_id,
    owner: truncateText(owner.owner_name ?? owner.owner_email ?? "unknown", 80),
    organization: owner.owner_organization ? truncateText(owner.owner_organization, 80) : undefined,
    source: owner.source,
    verified: owner.verified,
    notes: owner.notes ? truncateText(owner.notes, 100) : undefined,
  };
}

function compactDomainOwner(owner: DomainWithOwner) {
  return {
    domain_name: owner.domain_name,
    domain_status: owner.domain_status,
    premium: owner.is_premium || undefined,
    premium_price: owner.premium_price ?? undefined,
    owner: truncateText(owner.owner_name ?? owner.owner_email ?? "unknown", 80),
    organization: owner.owner_organization ? truncateText(owner.owner_organization, 80) : undefined,
    source: owner.source ?? undefined,
    verified: Boolean(owner.verified),
  };
}

function compactRegisteredDomain(domain: RegisteredDomain) {
  return {
    domain: domain.domain,
    expiry: domain.expiry ? formatDate(domain.expiry) : undefined,
    auto_renew: domain.auto_renew,
    transfer_lock: domain.transfer_lock,
  };
}

function compactHostedZone(zone: HostedZoneInfo) {
  return {
    id: zone.id,
    name: zone.name,
    record_count: zone.record_count,
    private_zone: zone.private_zone || undefined,
    comment: zone.comment ? truncateText(zone.comment, 90) : undefined,
  };
}

function compactRoute53Record(record: Route53Record) {
  return {
    name: record.name,
    type: record.type,
    ttl: record.alias_target ? undefined : record.ttl,
    value: record.alias_target
      ? `ALIAS ${truncateText(record.alias_target.dns_name, 90)}`
      : truncateText(record.values.join(", "), 120),
  };
}

function compactBulkCheck(result: BulkCheckResult) {
  return {
    domain: result.domain,
    domain_id: result.domain_id,
    whois_error: result.whois?.error ? truncateText(result.whois.error, 100) : undefined,
    ssl_error: result.ssl?.error ? truncateText(result.ssl.error, 100) : undefined,
    dns_valid: result.dns_validation?.valid,
    dns_issue_count: result.dns_validation?.issue_count,
  };
}

function compactAvailabilityResult(result: unknown) {
  const record = result && typeof result === "object" ? result as Record<string, unknown> : {};
  return {
    domain: record.domain,
    available: record.available,
    premium: record.premium ?? record.registryPremiumPricing,
    price: record.price ?? record.registration_price,
    currency: record.currency,
    error: record.error ? truncateText(String(record.error), 140) : undefined,
  };
}

function compactSyncResult(result: unknown): Record<string, unknown> {
  const record = result && typeof result === "object" ? result as Record<string, unknown> : {};
  if (Array.isArray(record.providers)) {
    const providers = record.providers.map((entry) => {
      const provider = entry && typeof entry === "object" ? entry as Record<string, unknown> : {};
      const providerResult = provider.result && typeof provider.result === "object" ? provider.result as Record<string, unknown> : {};
      const errors = Array.isArray(providerResult.errors) ? providerResult.errors.map(String) : [];
      return {
        name: provider.name,
        synced: providerResult.synced ?? 0,
        created: providerResult.created ?? 0,
        updated: providerResult.updated ?? 0,
        error_count: errors.length,
        errors: errors.slice(0, 5).map((error) => truncateText(error, 160)),
      };
    });
    const totalErrors = Array.isArray(record.totalErrors) ? record.totalErrors.map(String) : [];
    return {
      total_synced: record.totalSynced ?? 0,
      provider_count: providers.length,
      providers,
      total_error_count: totalErrors.length,
      total_errors: totalErrors.slice(0, 10).map((error) => truncateText(error, 160)),
      compact: true,
      hint: "Set verbose=true for full provider-specific sync details.",
    };
  }

  const errors = Array.isArray(record.errors) ? record.errors.map(String) : [];
  const domains = Array.isArray(record.domains) ? record.domains.map(String) : [];
  return {
    synced: record.synced ?? 0,
    created: record.created ?? undefined,
    updated: record.updated ?? undefined,
    domain_count: domains.length || undefined,
    sample_domains: domains.slice(0, 10),
    error_count: errors.length,
    errors: errors.slice(0, 10).map((error) => truncateText(error, 160)),
    compact: true,
    hint: "Set verbose=true for full provider-specific sync details.",
  };
}

function compactGenericRecord(item: unknown) {
  const record = item && typeof item === "object" ? item as Record<string, unknown> : {};
  const value = "value" in record ? record.value : "data" in record ? record.data : "values" in record ? record.values : undefined;
  return {
    type: record.type,
    name: record.name,
    value: value === undefined ? undefined : truncateText(Array.isArray(value) ? value.join(", ") : String(value), 120),
    ttl: record.ttl,
    priority: record.priority,
  };
}

export function buildServer(): McpServer {
const server = new McpServer({
  name: "domains",
  version: getPackageVersion(),
});
applySafeModeToolFilter(server);
registerDomainsStorageTools(server);

// --- Domains ---

server.registerTool(
  "create_domain",
  {
    title: "Create Domain",
    description: "Add a new domain to the portfolio.",
    inputSchema: {
      name: z.string(),
      registrar: z.string().optional(),
      status: z.enum(DOMAIN_STATUSES).optional(),
      registered_at: z.string().optional(),
      expires_at: z.string().optional(),
      auto_renew: z.boolean().optional(),
      is_premium: z.boolean().optional(),
      premium_price: z.number().optional(),
      standard_price: z.number().optional(),
      purchase_price: z.number().optional(),
      purchase_date: z.string().optional(),
      nameservers: z.array(z.string()).optional(),
      ssl_expires_at: z.string().optional(),
      ssl_issuer: z.string().optional(),
      notes: z.string().optional(),
    },
  },
  async (params) => {
    const domain = await createDomainRouted(params);
    return { content: [{ type: "text", text: JSON.stringify(domain, null, 2) }] };
  }
);

server.registerTool(
  "get_domain",
  {
    title: "Get Domain",
    description: "Get a domain by ID or name, including linked offers and emails.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const details = getDomainDetails(id);
    if (!details) {
      return { content: [{ type: "text", text: `Domain '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(details, null, 2) }] };
  }
);

server.registerTool(
  "list_domains",
  {
    title: "List Domains",
    description: "List domains with optional filters.",
    inputSchema: {
      search: z.string().optional(),
      status: z.enum(DOMAIN_STATUSES).optional(),
      registrar: z.string().optional(),
      is_premium: z.boolean().optional(),
      ...listControls,
    },
  },
  async (params) => {
    const { limit, offset, all, verbose, ...filters } = params;
    const domains = await listDomainsRouted(filters);
    return pagedJson("domains", domains, { limit, offset, all, verbose }, compactDomain, "domain(s)", "Set verbose=true or call get_domain for full details.");
  }
);

server.registerTool(
  "update_domain",
  {
    title: "Update Domain",
    description: "Update an existing domain.",
    inputSchema: {
      id: z.string(),
      name: z.string().optional(),
      registrar: z.string().optional(),
      status: z.enum(DOMAIN_STATUSES).optional(),
      registered_at: z.string().optional(),
      expires_at: z.string().optional(),
      auto_renew: z.boolean().optional(),
      is_premium: z.boolean().optional(),
      premium_price: z.number().nullable().optional(),
      standard_price: z.number().nullable().optional(),
      purchase_price: z.number().nullable().optional(),
      purchase_date: z.string().nullable().optional(),
      nameservers: z.array(z.string()).optional(),
      ssl_expires_at: z.string().optional(),
      ssl_issuer: z.string().optional(),
      notes: z.string().optional(),
    },
  },
  async ({ id, ...input }) => {
    const domain = await updateDomainRouted(id, input);
    if (!domain) {
      return { content: [{ type: "text", text: `Domain '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(domain, null, 2) }] };
  }
);

server.registerTool(
  "mark_domain_premium",
  {
    title: "Mark Domain Premium",
    description: "Mark a tracked domain as premium-priced.",
    inputSchema: {
      domain: z.string().describe("Domain ID or name"),
      price: z.number().describe("Premium asking price"),
      standard_price: z.number().optional().describe("Optional standard registration price"),
    },
  },
  async ({ domain, price, standard_price }) => {
    const updated = markDomainPremium(domain, price, standard_price);
    if (!updated) {
      return { content: [{ type: "text", text: `Domain '${domain}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(updated, null, 2) }] };
  }
);

server.registerTool(
  "add_domain_offer",
  {
    title: "Add Domain Offer",
    description: "Log a negotiation step for a tracked domain.",
    inputSchema: {
      domain: z.string().describe("Domain ID or name"),
      our_offer: z.number().optional(),
      their_ask: z.number().optional(),
      status: z.enum(DOMAIN_OFFER_STATUSES).optional(),
      notes: z.string().optional(),
    },
  },
  async ({ domain, ...input }) => {
    const existing = getDomainByIdentifier(domain);
    if (!existing) {
      return { content: [{ type: "text", text: `Domain '${domain}' not found.` }], isError: true };
    }
    const offer = createDomainOffer({ domain_id: existing.id, ...input });
    if (existing.status === "discovered" || existing.status === "researching" || existing.status === "offered") {
      updateDomainLifecycleStatus(existing.id, input.our_offer !== undefined || input.their_ask !== undefined ? "negotiating" : "offered");
    }
    return { content: [{ type: "text", text: JSON.stringify(offer, null, 2) }] };
  }
);

server.registerTool(
  "list_domain_offers",
  {
    title: "List Domain Offers",
    description: "Get negotiation history for a tracked domain.",
    inputSchema: {
      domain: z.string().describe("Domain ID or name"),
      ...listControls,
    },
  },
  async ({ domain, ...params }) => {
    const existing = getDomainByIdentifier(domain);
    if (!existing) {
      return { content: [{ type: "text", text: `Domain '${domain}' not found.` }], isError: true };
    }
    const offers = listDomainOffers(existing.id);
    return pagedJson("offers", offers, params, compactOffer, "offer(s)", "Set verbose=true for full offer records.", { domain: existing.name });
  }
);

server.registerTool(
  "update_domain_status",
  {
    title: "Update Domain Status",
    description: "Move a tracked domain through its acquisition lifecycle.",
    inputSchema: {
      domain: z.string().describe("Domain ID or name"),
      status: z.enum(DOMAIN_STATUSES),
      notes: z.string().optional(),
    },
  },
  async ({ domain, status, notes }) => {
    const updated = updateDomainLifecycleStatus(domain, status, notes);
    if (!updated) {
      return { content: [{ type: "text", text: `Domain '${domain}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(updated, null, 2) }] };
  }
);

server.registerTool(
  "record_domain_purchase",
  {
    title: "Record Domain Purchase",
    description: "Record a completed domain acquisition without performing the registrar checkout.",
    inputSchema: {
      domain: z.string().describe("Domain ID or name"),
      price: z.number().describe("Purchase price"),
      registrar: z.string().describe("Registrar or seller"),
      purchase_date: z.string().optional(),
      expires_at: z.string().optional(),
      auto_renew: z.boolean().optional(),
      notes: z.string().optional(),
      standard_price: z.number().optional(),
    },
  },
  async ({ domain, ...input }) => {
    const updated = recordDomainPurchase(domain, input);
    if (!updated) {
      return { content: [{ type: "text", text: `Domain '${domain}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(updated, null, 2) }] };
  }
);

server.registerTool(
  "link_domain_email",
  {
    title: "Link Domain Email",
    description: "Link an email or email thread to a tracked domain.",
    inputSchema: {
      domain: z.string().describe("Domain ID or name"),
      email_id: z.string().describe("Email ID from the connected email system"),
      thread_id: z.string().optional().describe("Optional email thread ID"),
      type: z.enum(DOMAIN_EMAIL_TYPES),
    },
  },
  async ({ domain, email_id, thread_id, type }) => {
    const existing = getDomainByIdentifier(domain);
    if (!existing) {
      return { content: [{ type: "text", text: `Domain '${domain}' not found.` }], isError: true };
    }
    const link = linkDomainEmail({ domain_id: existing.id, email_id, thread_id, type });
    return { content: [{ type: "text", text: JSON.stringify(link, null, 2) }] };
  }
);

server.registerTool(
  "get_domain_emails",
  {
    title: "Get Domain Emails",
    description: "Retrieve all email threads linked to a tracked domain.",
    inputSchema: {
      domain: z.string().describe("Domain ID or name"),
      ...listControls,
    },
  },
  async ({ domain, ...params }) => {
    const existing = getDomainByIdentifier(domain);
    if (!existing) {
      return { content: [{ type: "text", text: `Domain '${domain}' not found.` }], isError: true };
    }
    const emails = listDomainEmailLinks(existing.id);
    return pagedJson("emails", emails, params, compactEmailLink, "email link(s)", "Set verbose=true for full email link records.", { domain: existing.name });
  }
);

server.registerTool(
  "delete_domain",
  {
    title: "Delete Domain",
    description: "Delete a domain by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const deleted = await deleteDomainRouted(id);
    return { content: [{ type: "text", text: JSON.stringify({ id, deleted }) }] };
  }
);

server.registerTool(
  "search_domains",
  {
    title: "Search Domains",
    description: "Search domains by name, registrar, or notes.",
    inputSchema: { query: z.string(), ...listControls },
  },
  async ({ query, ...params }) => {
    const results = searchDomains(query);
    return pagedJson("results", results, params, compactDomain, "result(s)", "Set verbose=true or call get_domain for full details.", { query });
  }
);

server.registerTool(
  "count_domains",
  {
    title: "Count Domains",
    description: "Get the total number of domains.",
    inputSchema: {},
  },
  async () => {
    const count = countDomains();
    return { content: [{ type: "text", text: JSON.stringify({ count }) }] };
  }
);

server.registerTool(
  "list_expiring_domains",
  {
    title: "List Expiring Domains",
    description: "List domains expiring within N days.",
    inputSchema: { days: z.number().default(30), ...listControls },
  },
  async ({ days, ...params }) => {
    const domains = listExpiring(days);
    return pagedJson("domains", domains, params, compactDomain, "domain(s)", "Set verbose=true or call get_domain for full details.", { days });
  }
);

server.registerTool(
  "list_ssl_expiring",
  {
    title: "List SSL Expiring",
    description: "List domains with SSL certificates expiring within N days.",
    inputSchema: { days: z.number().default(30), ...listControls },
  },
  async ({ days, ...params }) => {
    const domains = listSslExpiring(days);
    return pagedJson("domains", domains, params, compactDomain, "domain(s)", "Set verbose=true or call get_domain for full details.", { days });
  }
);

server.registerTool(
  "get_domains_by_registrar",
  {
    title: "Get Domains by Registrar",
    description: "List all domains from a specific registrar.",
    inputSchema: { registrar: z.string(), ...listControls },
  },
  async ({ registrar, ...params }) => {
    const domains = getByRegistrar(registrar);
    return pagedJson("domains", domains, params, compactDomain, "domain(s)", "Set verbose=true or call get_domain for full details.", { registrar });
  }
);

server.registerTool(
  "get_domain_stats",
  {
    title: "Get Domain Stats",
    description: "Get domain portfolio statistics.",
    inputSchema: {},
  },
  async () => {
    const stats = getDomainStats();
    return { content: [{ type: "text", text: JSON.stringify(stats, null, 2) }] };
  }
);

// --- DNS Records ---

server.registerTool(
  "create_dns_record",
  {
    title: "Create DNS Record",
    description: "Create a new DNS record for a domain.",
    inputSchema: {
      domain_id: z.string(),
      type: z.enum(["A", "AAAA", "CNAME", "MX", "TXT", "NS", "SRV"]),
      name: z.string(),
      value: z.string(),
      ttl: z.number().optional(),
      priority: z.number().optional(),
    },
  },
  async (params) => {
    const record = createDnsRecord(params);
    return { content: [{ type: "text", text: JSON.stringify(record, null, 2) }] };
  }
);

server.registerTool(
  "list_dns_records",
  {
    title: "List DNS Records",
    description: "List DNS records for a domain.",
    inputSchema: {
      domain_id: z.string(),
      type: z.enum(["A", "AAAA", "CNAME", "MX", "TXT", "NS", "SRV"]).optional(),
      ...listControls,
    },
  },
  async ({ domain_id, type, ...params }) => {
    const records = listDnsRecords(domain_id, type);
    return pagedJson("records", records, params, compactDnsRecord, "record(s)", "Set verbose=true for full DNS record values.", { domain_id, type });
  }
);

server.registerTool(
  "update_dns_record",
  {
    title: "Update DNS Record",
    description: "Update a DNS record.",
    inputSchema: {
      id: z.string(),
      type: z.enum(["A", "AAAA", "CNAME", "MX", "TXT", "NS", "SRV"]).optional(),
      name: z.string().optional(),
      value: z.string().optional(),
      ttl: z.number().optional(),
      priority: z.number().optional(),
    },
  },
  async ({ id, ...input }) => {
    const record = updateDnsRecord(id, input);
    if (!record) {
      return { content: [{ type: "text", text: `DNS record '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(record, null, 2) }] };
  }
);

server.registerTool(
  "delete_dns_record",
  {
    title: "Delete DNS Record",
    description: "Delete a DNS record by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const deleted = deleteDnsRecord(id);
    return { content: [{ type: "text", text: JSON.stringify({ id, deleted }) }] };
  }
);

// --- Alerts ---

server.registerTool(
  "create_alert",
  {
    title: "Create Alert",
    description: "Set an alert for a domain (expiry, SSL expiry, or DNS change).",
    inputSchema: {
      domain_id: z.string(),
      type: z.enum(["expiry", "ssl_expiry", "dns_change"]),
      trigger_days_before: z.number().optional(),
    },
  },
  async (params) => {
    const alert = createAlert(params);
    return { content: [{ type: "text", text: JSON.stringify(alert, null, 2) }] };
  }
);

server.registerTool(
  "list_alerts",
  {
    title: "List Alerts",
    description: "List alerts for a domain.",
    inputSchema: { domain_id: z.string(), ...listControls },
  },
  async ({ domain_id, ...params }) => {
    const alerts = listAlerts(domain_id);
    return pagedJson("alerts", alerts, params, compactAlert, "alert(s)", "Set verbose=true for full alert records.", { domain_id });
  }
);

server.registerTool(
  "delete_alert",
  {
    title: "Delete Alert",
    description: "Delete an alert by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const deleted = deleteAlert(id);
    return { content: [{ type: "text", text: JSON.stringify({ id, deleted }) }] };
  }
);

// --- WHOIS Lookup ---

server.registerTool(
  "whois_lookup",
  {
    title: "WHOIS Lookup",
    description: "Run a WHOIS lookup for a domain. Parses registrar, expiry, nameservers. Updates DB record if found.",
    inputSchema: { domain: z.string().describe("Domain name (e.g. example.com)") },
  },
  async ({ domain }) => {
    try {
      const result = whoisLookup(domain);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error: unknown) {
      return {
        content: [{ type: "text", text: `WHOIS lookup failed: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  }
);

// --- DNS Propagation Check ---

server.registerTool(
  "check_dns_propagation",
  {
    title: "Check DNS Propagation",
    description: "Check DNS propagation by querying multiple DNS servers (Google, Cloudflare, Quad9, OpenDNS).",
    inputSchema: {
      domain: z.string().describe("Domain name to check"),
      record_type: z.string().default("A").describe("DNS record type (A, AAAA, CNAME, MX, TXT, NS)"),
    },
  },
  async ({ domain, record_type }) => {
    const result = checkDnsPropagation(domain, record_type);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// --- SSL Check ---

server.registerTool(
  "check_ssl",
  {
    title: "Check SSL Certificate",
    description: "Check SSL certificate for a domain. Extracts issuer and expiry. Updates DB record if found.",
    inputSchema: { domain: z.string().describe("Domain name (e.g. example.com)") },
  },
  async ({ domain }) => {
    const result = checkSsl(domain);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// --- Zone File Export ---

server.registerTool(
  "export_zone_file",
  {
    title: "Export Zone File",
    description: "Export DNS records for a domain as a BIND-format zone file.",
    inputSchema: { domain_id: z.string().describe("Domain ID") },
  },
  async ({ domain_id }) => {
    const zone = exportZoneFile(domain_id);
    if (!zone) {
      return { content: [{ type: "text", text: `Domain '${domain_id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: zone }] };
  }
);

// --- Zone File Import ---

server.registerTool(
  "import_zone_file",
  {
    title: "Import Zone File",
    description: "Import DNS records from BIND zone file content into a domain.",
    inputSchema: {
      domain_id: z.string().describe("Domain ID"),
      content: z.string().describe("Zone file content"),
    },
  },
  async ({ domain_id, content }) => {
    const result = importZoneFile(domain_id, content);
    if (!result) {
      return { content: [{ type: "text", text: `Domain '${domain_id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// --- Subdomain Discovery ---

server.registerTool(
  "discover_subdomains",
  {
    title: "Discover Subdomains",
    description: "Discover subdomains via certificate transparency logs (crt.sh).",
    inputSchema: { domain: z.string().describe("Domain name"), ...listControls },
  },
  async ({ domain, ...params }) => {
    const result = await discoverSubdomains(domain);
    return pagedJson("subdomains", result.subdomains, params, (name) => name, "subdomain(s)", "Set all=true for every discovered name or verbose=true for the same list with pagination metadata.", {
      domain: result.domain,
      source: result.source,
      error: result.error ? truncateText(result.error, 160) : undefined,
    });
  }
);

// --- DNS Validation ---

server.registerTool(
  "validate_dns",
  {
    title: "Validate DNS",
    description: "Validate DNS records for common issues (CNAME conflicts, missing MX, orphan records).",
    inputSchema: { domain_id: z.string().describe("Domain ID") },
  },
  async ({ domain_id }) => {
    const result = validateDns(domain_id);
    if (!result) {
      return { content: [{ type: "text", text: `Domain '${domain_id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// --- Portfolio Export ---

server.registerTool(
  "export_portfolio",
  {
    title: "Export Portfolio",
    description: "Export all domains as CSV or JSON with expiry, SSL, registrar, and auto-renew info.",
    inputSchema: {
      format: z.enum(["csv", "json"]).default("json").describe("Export format"),
    },
  },
  async ({ format }) => {
    const output = exportPortfolio(format);
    return { content: [{ type: "text", text: output }] };
  }
);

// --- Bulk Domain Check ---

server.registerTool(
  "check_all_domains",
  {
    title: "Check All Domains",
    description: "Run WHOIS + SSL + DNS validation on all domains. Returns a summary of issues found.",
    inputSchema: { ...listControls },
  },
  async (params) => {
    const results = checkAllDomains();
    return pagedJson("results", results, params, compactBulkCheck, "domain check result(s)", "Set verbose=true for full WHOIS/SSL/DNS validation details.");
  }
);

// --- Namecheap Integration ---

server.registerTool(
  "sync_namecheap",
  {
    title: "Sync Namecheap Domains",
    description: "Sync all domains from Namecheap account to local database. Requires NAMECHEAP_API_KEY, NAMECHEAP_USERNAME, and NAMECHEAP_CLIENT_IP env vars.",
    inputSchema: {
      verbose: z.boolean().optional().describe("Return full sync details including provider-specific arrays."),
    },
  },
  async ({ verbose }) => {
    try {
      const result = await syncToLocalDb({
        getDomainByName,
        createDomain,
        updateDomain,
      });
      return json(verbose ? result : compactSyncResult(result));
    } catch (error: unknown) {
      return {
        content: [{ type: "text", text: `Sync failed: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "renew_via_namecheap",
  {
    title: "Renew Domain via Namecheap",
    description: "Renew a domain through the Namecheap API.",
    inputSchema: {
      domain: z.string().describe("Domain name to renew (e.g. example.com)"),
      years: z.number().default(1).describe("Number of years to renew"),
    },
  },
  async ({ domain, years }) => {
    try {
      const result = await namecheapRenew(domain, years);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error: unknown) {
      return {
        content: [{ type: "text", text: `Renewal failed: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "check_availability_namecheap",
  {
    title: "Check Domain Availability",
    description: "Check if a domain name is available for registration via Namecheap.",
    inputSchema: {
      domain: z.string().describe("Domain name to check (e.g. example.com)"),
    },
  },
  async ({ domain }) => {
    try {
      const result = await namecheapCheck(domain);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error: unknown) {
      return {
        content: [{ type: "text", text: `Check failed: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  }
);

// --- GoDaddy Integration ---

server.registerTool(
  "sync_godaddy",
  {
    title: "Sync GoDaddy Domains",
    description: "Sync all domains from GoDaddy account to local database. Requires GODADDY_API_KEY and GODADDY_API_SECRET env vars.",
    inputSchema: {
      verbose: z.boolean().optional().describe("Return full sync details including provider-specific arrays."),
    },
  },
  async ({ verbose }) => {
    try {
      const result = await godaddySyncToLocalDb({
        getDomainByName,
        createDomain,
        updateDomain,
      });
      return json(verbose ? result : compactSyncResult(result));
    } catch (error: unknown) {
      return {
        content: [{ type: "text", text: `Sync failed: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "renew_via_godaddy",
  {
    title: "Renew Domain via GoDaddy",
    description: "Renew a domain through the GoDaddy API for 1 year.",
    inputSchema: {
      domain: z.string().describe("Domain name to renew (e.g. example.com)"),
    },
  },
  async ({ domain }) => {
    try {
      const result = await godaddyRenewDomain(domain);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error: unknown) {
      return {
        content: [{ type: "text", text: `Renewal failed: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  }
);

// --- Unified Provider Tools ---

server.registerTool(
  "sync_all_providers",
  {
    title: "Sync All Providers",
    description: "Sync domains from all configured domain inventory providers (Route 53, Cloudflare zones, Namecheap, GoDaddy, Brandsight) to local database.",
    inputSchema: {
      verbose: z.boolean().optional().describe("Return full sync details for each provider."),
    },
  },
  async ({ verbose }) => {
    try {
      const result = await syncAll({
        getDomainByName,
        createDomain,
        updateDomain,
      });
      return json(verbose ? result : compactSyncResult(result));
    } catch (error: unknown) {
      return {
        content: [{ type: "text", text: `Sync failed: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "list_providers",
  {
    title: "List Providers",
    description: "Show which registrar providers are configured (have API keys set).",
    inputSchema: { ...listControls },
  },
  async (params) => {
    const providers = getAvailableProviders();
    return pagedJson(
      "providers",
      providers,
      params,
      (provider) => ({
        name: provider.name,
        type: provider.type,
        configured: provider.configured,
        inventory: provider.inventory || undefined,
      }),
      "provider(s)",
      "Set verbose=true to include provider environment variable names.",
    );
  }
);

// --- Brandsight Tools ---

server.registerTool(
  "monitor_brand",
  {
    title: "Monitor Brand",
    description: "Monitor a brand name for new domain registrations that are similar (typosquats, homoglyphs, keyword matches).",
    inputSchema: {
      brand: z.string().describe("Brand name to monitor"),
      ...listControls,
    },
  },
  async ({ brand, ...params }) => {
    try {
      const result = await monitorBrand(brand);
      return pagedJson(
        "alerts",
        result.alerts,
        params,
        (alert) => ({
          domain: alert.domain,
          type: alert.type,
          registered_at: formatDate(alert.registered_at),
        }),
        "alert(s)",
        "Set all=true for every alert or verbose=true for full alert records.",
        { brand: result.brand, stub: result.stub },
      );
    } catch (error: unknown) {
      return {
        content: [{ type: "text", text: `Monitor failed: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "similar_domains",
  {
    title: "Similar Domains",
    description: "Find typosquat/competing domains similar to the given domain.",
    inputSchema: {
      domain: z.string().describe("Domain to find similar domains for"),
      ...listControls,
    },
  },
  async ({ domain, ...params }) => {
    try {
      const result = await getSimilarDomains(domain);
      return pagedJson("similar", result.similar, params, (name) => name, "domain(s)", "Set all=true for every similar domain.", { domain: result.domain, stub: result.stub });
    } catch (error: unknown) {
      return {
        content: [{ type: "text", text: `Similar domains check failed: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "domain_threats",
  {
    title: "Domain Threats",
    description: "Get a threat assessment for a domain including risk level, threats, and recommendation.",
    inputSchema: {
      domain: z.string().describe("Domain to assess threats for"),
      ...listControls,
    },
  },
  async ({ domain, ...params }) => {
    try {
      const result = await getThreatAssessment(domain);
      return pagedJson("threats", result.threats, params, (threat) => truncateText(threat, 120), "threat(s)", "Set all=true for every threat or verbose=true for untruncated threat strings.", {
        domain: result.domain,
        risk_level: result.risk_level,
        recommendation: truncateText(result.recommendation, 180),
        stub: result.stub,
      });
    } catch (error: unknown) {
      return {
        content: [{ type: "text", text: `Threat assessment failed: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  }
);

// --- Route 53 Tools ---

server.registerTool(
  "r53_check_availability",
  {
    title: "Check Domain Availability (Route 53)",
    description: "Check if one or more domains are available for purchase via AWS Route 53. Returns availability, registration, renewal, and transfer pricing.",
    inputSchema: {
      domains: z.array(z.string()).describe("One or more domains to check (e.g. [\"example.com\", \"example.io\"])"),
      ...listControls,
    },
  },
  async ({ domains, ...params }) => {
    try {
      const results = await Promise.allSettled(domains.map((d) => r53CheckAvailability(d)));
      const output = results.map((r, i) =>
        r.status === "fulfilled" ? r.value : { domain: domains[i], error: r.reason instanceof Error ? r.reason.message : String(r.reason) }
      );
      return pagedJson("results", output, params, compactAvailabilityResult, "availability result(s)", "Set verbose=true for full pricing and transfer fields.");
    } catch (error: unknown) {
      return { content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

server.registerTool(
  "r53_register_domain",
  {
    title: "Register Domain (Route 53)",
    description: "Purchase and register a domain via AWS Route 53. Returns an operation ID to track progress.",
    inputSchema: {
      domain: z.string().describe("Domain to register"),
      first_name: z.string(),
      last_name: z.string(),
      email: z.string(),
      phone: z.string().describe("E.164 format, e.g. +1.5551234567"),
      address_line_1: z.string(),
      city: z.string(),
      state: z.string(),
      country_code: z.string().describe("Two-letter country code, e.g. US"),
      zip_code: z.string(),
      organization_name: z.string().optional(),
      duration_years: z.number().min(1).max(10).optional().describe("Registration years (default: 1)"),
      auto_renew: z.boolean().optional().describe("Auto-renew (default: true)"),
    },
  },
  async (params) => {
    try {
      const result = await r53RegisterDomain(
        params.domain,
        {
          first_name: params.first_name,
          last_name: params.last_name,
          email: params.email,
          phone: params.phone,
          address_line_1: params.address_line_1,
          city: params.city,
          state: params.state,
          country_code: params.country_code,
          zip_code: params.zip_code,
          organization_name: params.organization_name,
        },
        params.duration_years ?? 1,
        params.auto_renew ?? true,
      );
      return { content: [{ type: "text", text: JSON.stringify({ domain: params.domain, ...result }, null, 2) }] };
    } catch (error: unknown) {
      return { content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

server.registerTool(
  "r53_registration_status",
  {
    title: "Registration Status (Route 53)",
    description: "Check the status of a domain registration operation.",
    inputSchema: {
      operation_id: z.string().describe("Operation ID from r53_register_domain"),
    },
  },
  async ({ operation_id }) => {
    try {
      const result = await r53GetRegistrationStatus(operation_id);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error: unknown) {
      return { content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

server.registerTool(
  "r53_list_registered_domains",
  {
    title: "List Registered Domains (Route 53)",
    description: "List all domains registered via AWS Route 53.",
    inputSchema: { ...listControls },
  },
  async (params) => {
    try {
      const domains = await r53ListRegisteredDomains();
      return pagedJson("domains", domains, params, compactRegisteredDomain, "domain(s)", "Set all=true for every Route 53 domain or call r53_get_domain_detail.");
    } catch (error: unknown) {
      return { content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

server.registerTool(
  "r53_get_domain_detail",
  {
    title: "Get Domain Detail (Route 53)",
    description: "Get full details for a Route 53 registered domain: nameservers, created/expiry dates, auto-renew, transfer lock.",
    inputSchema: {
      domain: z.string().describe("Domain name (e.g. example.com)"),
    },
  },
  async ({ domain }) => {
    try {
      const detail = await r53GetDomainDetail(domain);
      return { content: [{ type: "text", text: JSON.stringify(detail, null, 2) }] };
    } catch (error: unknown) {
      return { content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

server.registerTool(
  "r53_create_hosted_zone",
  {
    title: "Create Hosted Zone (Route 53)",
    description: "Create a Route 53 hosted zone for a domain. Returns zone ID and name servers.",
    inputSchema: {
      domain: z.string().describe("Domain name"),
      comment: z.string().optional().describe("Zone comment"),
    },
  },
  async ({ domain, comment }) => {
    try {
      const zone = await r53CreateHostedZone(domain, comment);
      return { content: [{ type: "text", text: JSON.stringify(zone, null, 2) }] };
    } catch (error: unknown) {
      return { content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

server.registerTool(
  "r53_list_hosted_zones",
  {
    title: "List Hosted Zones (Route 53)",
    description: "List all Route 53 hosted zones.",
    inputSchema: { ...listControls },
  },
  async (params) => {
    try {
      const zones = await r53ListHostedZones();
      return pagedJson("zones", zones, params, compactHostedZone, "zone(s)", "Set all=true for every zone or call r53_get_hosted_zone.");
    } catch (error: unknown) {
      return { content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

server.registerTool(
  "r53_get_hosted_zone",
  {
    title: "Get Hosted Zone (Route 53)",
    description: "Get details of a Route 53 hosted zone including name servers.",
    inputSchema: {
      hosted_zone_id: z.string().describe("Hosted zone ID"),
    },
  },
  async ({ hosted_zone_id }) => {
    try {
      const zone = await r53GetHostedZone(hosted_zone_id);
      return { content: [{ type: "text", text: JSON.stringify(zone, null, 2) }] };
    } catch (error: unknown) {
      return { content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

server.registerTool(
  "r53_delete_hosted_zone",
  {
    title: "Delete Hosted Zone (Route 53)",
    description: "Delete a Route 53 hosted zone.",
    inputSchema: {
      hosted_zone_id: z.string().describe("Hosted zone ID"),
    },
  },
  async ({ hosted_zone_id }) => {
    try {
      await r53DeleteHostedZone(hosted_zone_id);
      return { content: [{ type: "text", text: `Hosted zone ${hosted_zone_id} deleted.` }] };
    } catch (error: unknown) {
      return { content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

server.registerTool(
  "r53_list_records",
  {
    title: "List DNS Records (Route 53)",
    description: "List all DNS records in a Route 53 hosted zone for a domain.",
    inputSchema: {
      domain: z.string().describe("Domain name (will find the hosted zone automatically)"),
      ...listControls,
    },
  },
  async ({ domain, ...params }) => {
    try {
      const zone = await r53FindHostedZoneByDomain(domain);
      if (!zone) throw new Error(`No hosted zone found for ${domain}`);
      const records = await r53ListRecords(zone.id);
      return pagedJson("records", records, params, compactRoute53Record, "record(s)", "Set all=true for every DNS record or verbose=true for full Route 53 record values.", { domain, zone_id: zone.id });
    } catch (error: unknown) {
      return { content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

server.registerTool(
  "r53_upsert_record",
  {
    title: "Upsert DNS Record (Route 53)",
    description: "Create or update a DNS record in a Route 53 hosted zone.",
    inputSchema: {
      domain: z.string().describe("Domain name (hosted zone)"),
      record_type: z.string().describe("Record type (A, AAAA, CNAME, TXT, MX, NS)"),
      record_name: z.string().describe("Record name (FQDN)"),
      record_values: z.array(z.string()).optional().describe("Record values (one or more). Omit when using alias_target."),
      ttl: z.number().optional().describe("TTL in seconds (default: 300). Ignored for alias records."),
      alias_hosted_zone_id: z.string().optional().describe("For alias records: hosted zone ID of the target (e.g. Z2FDTNDATAQYW2 for CloudFront)"),
      alias_dns_name: z.string().optional().describe("For alias records: DNS name of the alias target (e.g. d1234.cloudfront.net)"),
    },
  },
  async ({ domain, record_type, record_name, record_values, ttl, alias_hosted_zone_id, alias_dns_name }) => {
    try {
      if (!record_values?.length && !(alias_hosted_zone_id && alias_dns_name)) {
        throw new Error("Provide either record_values or both alias_hosted_zone_id and alias_dns_name.");
      }
      const zone = await r53FindHostedZoneByDomain(domain);
      if (!zone) throw new Error(`No hosted zone found for ${domain}`);
      const aliasTarget = alias_hosted_zone_id && alias_dns_name
        ? { hosted_zone_id: alias_hosted_zone_id, dns_name: alias_dns_name }
        : undefined;
      await r53UpsertRecord(zone.id, { name: record_name, type: record_type, ttl: ttl ?? 300, values: record_values ?? [], alias_target: aliasTarget });
      const desc = aliasTarget ? `alias → ${aliasTarget.dns_name}` : `${record_values!.length} value(s)`;
      return { content: [{ type: "text", text: `Record upserted: ${record_type} ${record_name} (${desc})` }] };
    } catch (error: unknown) {
      return { content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

server.registerTool(
  "r53_delete_record",
  {
    title: "Delete DNS Record (Route 53)",
    description: "Delete a DNS record from a Route 53 hosted zone. Fetches the existing record set automatically to ensure an exact match (required by AWS).",
    inputSchema: {
      domain: z.string().describe("Domain name (hosted zone)"),
      record_type: z.string().describe("Record type (A, AAAA, CNAME, TXT, MX, NS)"),
      record_name: z.string().describe("Record name (FQDN)"),
    },
  },
  async ({ domain, record_type, record_name }) => {
    try {
      const zone = await r53FindHostedZoneByDomain(domain);
      if (!zone) throw new Error(`No hosted zone found for ${domain}`);
      const records = await r53ListRecords(zone.id);
      const normName = record_name.endsWith(".") ? record_name : `${record_name}.`;
      const existing = records.find(
        (r) => r.type === record_type.toUpperCase() && (r.name === record_name || r.name === normName),
      );
      if (!existing) throw new Error(`No ${record_type} record found for ${record_name}`);
      await r53DeleteRecord(zone.id, {
        name: existing.name,
        type: existing.type,
        ttl: existing.ttl,
        values: existing.values,
        alias_target: existing.alias_target,
      });
      return { content: [{ type: "text", text: `Record deleted: ${existing.type} ${existing.name}` }] };
    } catch (error: unknown) {
      return { content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

server.registerTool(
  "r53_upsert_records",
  {
    title: "Batch Upsert DNS Records (Route 53)",
    description: "Create or update multiple DNS records in a single Route 53 API call. More efficient than calling r53_upsert_record repeatedly.",
    inputSchema: {
      domain: z.string().describe("Domain name (hosted zone)"),
      records: z.array(z.object({
        record_type: z.string().describe("Record type (A, AAAA, CNAME, TXT, MX, NS)"),
        record_name: z.string().describe("Record name (FQDN)"),
        record_values: z.array(z.string()).describe("Record values"),
        ttl: z.number().optional().describe("TTL in seconds (default: 300)"),
        alias_hosted_zone_id: z.string().optional().describe("Alias target hosted zone ID"),
        alias_dns_name: z.string().optional().describe("Alias target DNS name"),
      })).describe("Records to upsert"),
    },
  },
  async ({ domain, records }) => {
    try {
      const zone = await r53FindHostedZoneByDomain(domain);
      if (!zone) throw new Error(`No hosted zone found for ${domain}`);
      const r53Records = records.map((r) => ({
        name: r.record_name,
        type: r.record_type,
        ttl: r.ttl ?? 300,
        values: r.record_values,
        alias_target: r.alias_hosted_zone_id && r.alias_dns_name
          ? { hosted_zone_id: r.alias_hosted_zone_id, dns_name: r.alias_dns_name }
          : undefined,
      }));
      await r53UpsertRecords(zone.id, r53Records);
      return { content: [{ type: "text", text: `Upserted ${records.length} record(s) in ${domain}` }] };
    } catch (error: unknown) {
      return { content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

// --- Unified Provider-Agnostic Tools ---

server.registerTool(
  "domain_check",
  {
    title: "Check Domain Availability",
    description: "Check if one or more domains are available via the configured registrar provider.",
    inputSchema: {
      domains: z.array(z.string()).describe("Domain names to check"),
      provider: z.string().optional().describe("Registrar provider name (default: config default-registrar or route53)"),
      ...listControls,
    },
  },
  async ({ domains, provider, ...params }) => {
    try {
      const providerName = provider ?? loadConfig().default_registrar ?? "route53";
      const reg = getRegistrarProvider(providerName);
      const results = await Promise.allSettled(domains.map((d) => reg.checkAvailability(d)));
      const output = results.map((r, i) =>
        r.status === "fulfilled" ? r.value : { domain: domains[i], error: r.reason instanceof Error ? r.reason.message : String(r.reason) }
      );
      return pagedJson("results", output, params, compactAvailabilityResult, "availability result(s)", "Set verbose=true for full provider-specific availability details.", { provider: providerName });
    } catch (error: unknown) {
      return { content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

server.registerTool(
  "domain_setup",
  {
    title: "Buy + Setup Domain",
    description: "Full setup: buy domain via registrar, create/reuse DNS zone, and delegate nameservers when registration is complete. Uses contact info from config.",
    inputSchema: {
      domain: z.string().describe("Domain to purchase and set up"),
      registrar: z.string().optional().describe("Registrar provider (default: config default-registrar or route53)"),
      dns: z.string().optional().describe("DNS provider for zone creation (default: config default-dns or cloudflare)"),
      years: z.number().optional().describe("Registration years (default: 1)"),
      wait: z.boolean().optional().describe("Poll until registration completes before creating zone"),
    },
  },
  async ({ domain, registrar, dns, years, wait }) => {
    try {
      const cfg = loadConfig();
      const registrarName = registrar ?? cfg.default_registrar ?? "route53";
      const dnsName = dns ?? cfg.default_dns ?? "cloudflare";

      if (registrarName !== "route53") throw new Error("Direct purchase currently only supported via route53");

      const contact = resolveContact({});

      const avail = await r53CheckAvailability(domain);
      if (!avail.available) throw new Error(`${domain} is not available`);

      const reg = await r53RegisterDomain(domain, contact, years ?? 1);

      if (wait) {
        let status = "IN_PROGRESS";
        while (status === "IN_PROGRESS" || status === "SUBMITTED") {
          await new Promise((r) => setTimeout(r, 10_000));
          status = (await r53GetRegistrationStatus(reg.operationId)).status;
        }
        if (status !== "SUCCESSFUL") throw new Error(`Registration ${status}`);
      }

      let nameservers: string[] = [];
      let zoneId: string | undefined;
      if (dnsName === "cloudflare") {
        const zone = await cfEnsureZone(domain);
        zoneId = zone.id;
        nameservers = zone.nameservers ?? [];
      } else {
        const zone = await r53CreateHostedZone(domain, "Managed by domains MCP");
        zoneId = zone.id;
        nameservers = zone.name_servers ?? [];
      }

      let delegationOperationId: string | undefined;
      if (wait && nameservers.length > 0) {
        const nsUpdate = await r53UpdateNameservers(domain, nameservers);
        delegationOperationId = nsUpdate.operationId;
      }

      const existing = getDomainByName(domain);
      const dbInput = { registrar: "AWS Route 53", status: "active" as const, auto_renew: true, nameservers };
      if (existing) updateDomain(existing.id, dbInput);
      else createDomain({ name: domain, ...dbInput });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                domain,
                operationId: reg.operationId,
                nameservers,
                dns_provider: dnsName,
                zone_id: zoneId,
                nameservers_delegated: Boolean(delegationOperationId),
                delegation_operation_id: delegationOperationId,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error: unknown) {
      return { content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

server.registerTool(
  "dns_list",
  {
    title: "List DNS Records",
    description: "List live DNS records for a domain from a DNS provider.",
    inputSchema: {
      domain: z.string().describe("Domain name"),
      provider: z.string().optional().describe("DNS provider (route53, cloudflare — default: config default-dns)"),
      ...listControls,
    },
  },
  async ({ domain, provider, ...params }) => {
    try {
      const providerName = provider ?? loadConfig().default_dns ?? "route53";
      const dns = getDnsProvider(providerName);
      const records = await dns.getDnsRecords(domain);
      return pagedJson("records", records, params, compactGenericRecord, "record(s)", "Set all=true for every live DNS record or verbose=true for full provider-specific records.", { domain, provider: providerName });
    } catch (error: unknown) {
      return { content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

server.registerTool(
  "dns_set",
  {
    title: "Set DNS Records",
    description: "Create or update DNS records via a DNS provider.",
    inputSchema: {
      domain: z.string().describe("Domain name"),
      records: z.array(z.object({
        type: z.string(), name: z.string(), value: z.string(), ttl: z.number().optional(), priority: z.number().optional(),
      })),
      provider: z.string().optional().describe("DNS provider (default: config default-dns)"),
    },
  },
  async ({ domain, records, provider }) => {
    try {
      const providerName = provider ?? loadConfig().default_dns ?? "route53";
      const dns = getDnsProvider(providerName);
      await dns.setDnsRecords(domain, records.map((r) => ({ ...r, ttl: r.ttl ?? 300 })));
      return { content: [{ type: "text", text: `Set ${records.length} record(s) on ${domain} via ${providerName}` }] };
    } catch (error: unknown) {
      return { content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

server.registerTool(
  "sync_route53",
  {
    title: "Sync Route 53",
    description: "Sync domains registered in AWS Route 53 to the local database.",
    inputSchema: {
      verbose: z.boolean().optional().describe("Return full sync details including provider-specific arrays."),
    },
  },
  async ({ verbose }) => {
    try {
      const provider = createRoute53Provider();
      const result = await provider.syncToLocalDb({
        getDomainByName,
        createDomain,
        updateDomain,
      });
      return json(verbose ? result : compactSyncResult(result));
    } catch (error: unknown) {
      return { content: [{ type: "text", text: `Sync failed: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

// --- Domain Owner Tracking ---

server.registerTool(
  "list_domain_owners",
  {
    title: "List Domain Owners",
    description: "List all premium domain owners with optional search and filters.",
    inputSchema: {
      search: z.string().optional(),
      source: z.enum(["whois", "manual", "brandsight", "import"]).optional(),
      verified_only: z.boolean().optional(),
      with_domains: z.boolean().optional(),
      ...listControls,
    },
  },
  async (params) => {
    const { limit, offset, all, verbose } = params;
    if (params.with_domains) {
      const results = listDomainsWithOwners();
      return pagedJson("owners", results, { limit, offset, all, verbose }, compactDomainOwner, "owner/domain row(s)", "Set verbose=true for full joined owner fields.");
    }
    const owners = listDomainOwners({
      search: params.search,
      source: params.source as (typeof DOMAIN_OWNER_SOURCES)[number] | undefined,
      verified: params.verified_only ? true : undefined,
    });
    return pagedJson("owners", owners, { limit, offset, all, verbose }, compactOwner, "owner(s)", "Set verbose=true or call get_domain_owner for full contact fields.");
  }
);

server.registerTool(
  "get_domain_owner",
  {
    title: "Get Domain Owner",
    description: "Get owner info for a domain or by owner ID.",
    inputSchema: {
      identifier: z.string().optional(),
      owner_id: z.string().optional(),
    },
  },
  async ({ identifier, owner_id }) => {
    if (owner_id) {
      const o = getDomainOwner(owner_id);
      if (!o) return { content: [{ type: "text", text: `Owner '${owner_id}' not found.` }], isError: true };
      return { content: [{ type: "text", text: JSON.stringify(o, null, 2) }] };
    }
    if (identifier) {
      const domain = getDomainByIdentifier(identifier);
      if (!domain) return { content: [{ type: "text", text: `Domain '${identifier}' not found.` }], isError: true };
      const o = getDomainOwnerByDomain(domain.id);
      if (!o) return { content: [{ type: "text", text: `No owner info for ${domain.name}.` }] };
      return { content: [{ type: "text", text: JSON.stringify(o, null, 2) }] };
    }
    return { content: [{ type: "text", text: "Provide identifier or owner_id." }], isError: true };
  }
);

server.registerTool(
  "create_domain_owner",
  {
    title: "Create Domain Owner",
    description: "Add owner info for a tracked domain.",
    inputSchema: {
      domain_id: z.string(),
      contact_id: z.string().optional(),
      owner_name: z.string().optional(),
      owner_email: z.string().optional(),
      owner_phone: z.string().optional(),
      owner_organization: z.string().optional(),
      source: z.enum(["whois", "manual", "brandsight", "import"]).optional(),
      verified: z.boolean().optional(),
      notes: z.string().optional(),
    },
  },
  async (params) => {
    if (!params.owner_name && !params.owner_email && !params.owner_organization && !params.contact_id) {
      return { content: [{ type: "text", text: "At least one of owner_name, owner_email, owner_organization, or contact_id is required." }], isError: true };
    }
    const o = createDomainOwner(params as Parameters<typeof createDomainOwner>[0]);
    return { content: [{ type: "text", text: JSON.stringify(o, null, 2) }] };
  }
);

server.registerTool(
  "update_domain_owner",
  {
    title: "Update Domain Owner",
    description: "Update an existing domain owner record.",
    inputSchema: {
      owner_id: z.string(),
      contact_id: z.string().optional(),
      owner_name: z.string().optional(),
      owner_email: z.string().optional(),
      owner_phone: z.string().optional(),
      owner_organization: z.string().optional(),
      verified: z.boolean().optional(),
      notes: z.string().optional(),
    },
  },
  async ({ owner_id, ...rest }) => {
    const o = updateDomainOwner(owner_id, rest);
    if (!o) return { content: [{ type: "text", text: `Owner '${owner_id}' not found.` }], isError: true };
    return { content: [{ type: "text", text: JSON.stringify(o, null, 2) }] };
  }
);

server.registerTool(
  "delete_domain_owner",
  {
    title: "Delete Domain Owner",
    description: "Delete a domain owner record.",
    inputSchema: { owner_id: z.string() },
  },
  async ({ owner_id }) => {
    const deleted = deleteDomainOwner(owner_id);
    if (!deleted) return { content: [{ type: "text", text: `Owner '${owner_id}' not found.` }], isError: true };
    return { content: [{ type: "text", text: `Deleted owner ${owner_id}` }] };
  }
);

server.registerTool(
  "extract_domain_owner_from_whois",
  {
    title: "Extract Owner from WHOIS",
    description: "Run WHOIS lookup and extract owner info, saving it to the database.",
    inputSchema: { domain_name: z.string() },
  },
  async ({ domain_name }) => {
    const whois = whoisLookup(domain_name);
    if (!whois.raw) return { content: [{ type: "text", text: "WHOIS returned no data." }], isError: true };
    const o = extractOwnerFromWhois(domain_name, whois.raw);
    if (!o) return { content: [{ type: "text", text: "No owner information found in WHOIS data." }] };
    return { content: [{ type: "text", text: JSON.stringify(o, null, 2) }] };
  }
);

return server;
}

// --- Start ---
async function main() {
  const argv = process.argv.slice(2);
  const { isStdioMode } = await import("./http.js");
  if (isStdioMode(argv)) {
    const transport = new StdioServerTransport();
    await buildServer().connect(transport);
    console.error("domains MCP server running on stdio");
    return;
  }
  // Default: shared Streamable HTTP server (one process per MCP, many agents).
  const { resolveMcpHttpPort, startHttpServer } = await import("./http.js");
  const port = resolveMcpHttpPort(argv);
  await startHttpServer(buildServer, port);
  await new Promise(() => {});
}

if (import.meta.main) {
  main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}
