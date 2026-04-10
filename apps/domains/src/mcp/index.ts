#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  DOMAIN_EMAIL_TYPES,
  DOMAIN_OFFER_STATUSES,
  DOMAIN_STATUSES,
  createDomain,
  getDomain,
  getDomainDetails,
  getDomainByIdentifier,
  listDomains,
  updateDomain,
  markDomainPremium,
  createDomainOffer,
  listDomainOffers,
  updateDomainLifecycleStatus,
  recordDomainPurchase,
  linkDomainEmail,
  listDomainEmailLinks,
  deleteDomain,
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
import { createZone as cfCreateZone } from "../lib/cloudflare.js";
import {
  monitorBrand,
  getSimilarDomains,
  getThreatAssessment,
} from "../lib/brandsight.js";
import { getPackageVersion } from "../lib/version.js";

const server = new McpServer({
  name: "domains",
  version: getPackageVersion(),
});

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
    const domain = createDomain(params);
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
      limit: z.number().optional(),
      offset: z.number().optional(),
    },
  },
  async (params) => {
    const domains = listDomains(params);
    return {
      content: [
        { type: "text", text: JSON.stringify({ domains, count: domains.length }, null, 2) },
      ],
    };
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
    const domain = updateDomain(id, input);
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
    },
  },
  async ({ domain }) => {
    const existing = getDomainByIdentifier(domain);
    if (!existing) {
      return { content: [{ type: "text", text: `Domain '${domain}' not found.` }], isError: true };
    }
    const offers = listDomainOffers(existing.id);
    return {
      content: [{ type: "text", text: JSON.stringify({ domain: existing.name, offers, count: offers.length }, null, 2) }],
    };
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
      email_id: z.string().describe("Email ID from @hasna/emails"),
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
    },
  },
  async ({ domain }) => {
    const existing = getDomainByIdentifier(domain);
    if (!existing) {
      return { content: [{ type: "text", text: `Domain '${domain}' not found.` }], isError: true };
    }
    const emails = listDomainEmailLinks(existing.id);
    return {
      content: [{ type: "text", text: JSON.stringify({ domain: existing.name, emails, count: emails.length }, null, 2) }],
    };
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
    const deleted = deleteDomain(id);
    return { content: [{ type: "text", text: JSON.stringify({ id, deleted }) }] };
  }
);

server.registerTool(
  "search_domains",
  {
    title: "Search Domains",
    description: "Search domains by name, registrar, or notes.",
    inputSchema: { query: z.string() },
  },
  async ({ query }) => {
    const results = searchDomains(query);
    return {
      content: [
        { type: "text", text: JSON.stringify({ results, count: results.length }, null, 2) },
      ],
    };
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
    inputSchema: { days: z.number().default(30) },
  },
  async ({ days }) => {
    const domains = listExpiring(days);
    return {
      content: [
        { type: "text", text: JSON.stringify({ domains, count: domains.length }, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "list_ssl_expiring",
  {
    title: "List SSL Expiring",
    description: "List domains with SSL certificates expiring within N days.",
    inputSchema: { days: z.number().default(30) },
  },
  async ({ days }) => {
    const domains = listSslExpiring(days);
    return {
      content: [
        { type: "text", text: JSON.stringify({ domains, count: domains.length }, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "get_domains_by_registrar",
  {
    title: "Get Domains by Registrar",
    description: "List all domains from a specific registrar.",
    inputSchema: { registrar: z.string() },
  },
  async ({ registrar }) => {
    const domains = getByRegistrar(registrar);
    return {
      content: [
        { type: "text", text: JSON.stringify({ domains, count: domains.length }, null, 2) },
      ],
    };
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
    },
  },
  async ({ domain_id, type }) => {
    const records = listDnsRecords(domain_id, type);
    return {
      content: [
        { type: "text", text: JSON.stringify({ records, count: records.length }, null, 2) },
      ],
    };
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
    inputSchema: { domain_id: z.string() },
  },
  async ({ domain_id }) => {
    const alerts = listAlerts(domain_id);
    return {
      content: [
        { type: "text", text: JSON.stringify({ alerts, count: alerts.length }, null, 2) },
      ],
    };
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
    inputSchema: { domain: z.string().describe("Domain name") },
  },
  async ({ domain }) => {
    const result = await discoverSubdomains(domain);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
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
    inputSchema: {},
  },
  async () => {
    const results = checkAllDomains();
    return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
  }
);

// --- Namecheap Integration ---

server.registerTool(
  "sync_namecheap",
  {
    title: "Sync Namecheap Domains",
    description: "Sync all domains from Namecheap account to local database. Requires NAMECHEAP_API_KEY, NAMECHEAP_USERNAME, and NAMECHEAP_CLIENT_IP env vars.",
    inputSchema: {},
  },
  async () => {
    try {
      const result = await syncToLocalDb({
        getDomainByName,
        createDomain,
        updateDomain,
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
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
    inputSchema: {},
  },
  async () => {
    try {
      const result = await godaddySyncToLocalDb({
        getDomainByName,
        createDomain,
        updateDomain,
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
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
    description: "Sync domains from all configured registrar providers (Namecheap, GoDaddy, Route 53) to local database.",
    inputSchema: {},
  },
  async () => {
    try {
      const result = await syncAll({
        getDomainByName,
        createDomain,
        updateDomain,
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
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
    inputSchema: {},
  },
  async () => {
    const providers = getAvailableProviders();
    return { content: [{ type: "text", text: JSON.stringify(providers, null, 2) }] };
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
    },
  },
  async ({ brand }) => {
    try {
      const result = await monitorBrand(brand);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
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
    },
  },
  async ({ domain }) => {
    try {
      const result = await getSimilarDomains(domain);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
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
    },
  },
  async ({ domain }) => {
    try {
      const result = await getThreatAssessment(domain);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error: unknown) {
      return {
        content: [{ type: "text", text: `Threat assessment failed: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  }
);

// --- Route 53 Tools ---

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
} from "../lib/route53.js";

server.registerTool(
  "r53_check_availability",
  {
    title: "Check Domain Availability (Route 53)",
    description: "Check if one or more domains are available for purchase via AWS Route 53. Returns availability, registration, renewal, and transfer pricing.",
    inputSchema: {
      domains: z.array(z.string()).describe("One or more domains to check (e.g. [\"example.com\", \"example.io\"])"),
    },
  },
  async ({ domains }) => {
    try {
      const results = await Promise.allSettled(domains.map((d) => r53CheckAvailability(d)));
      const output = results.map((r, i) =>
        r.status === "fulfilled" ? r.value : { domain: domains[i], error: r.reason instanceof Error ? r.reason.message : String(r.reason) }
      );
      return { content: [{ type: "text", text: JSON.stringify(output, null, 2) }] };
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
    inputSchema: {},
  },
  async () => {
    try {
      const domains = await r53ListRegisteredDomains();
      return { content: [{ type: "text", text: JSON.stringify(domains, null, 2) }] };
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
    inputSchema: {},
  },
  async () => {
    try {
      const zones = await r53ListHostedZones();
      return { content: [{ type: "text", text: JSON.stringify(zones, null, 2) }] };
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
    },
  },
  async ({ domain }) => {
    try {
      const zone = await r53FindHostedZoneByDomain(domain);
      if (!zone) throw new Error(`No hosted zone found for ${domain}`);
      const records = await r53ListRecords(zone.id);
      return { content: [{ type: "text", text: JSON.stringify(records, null, 2) }] };
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
    },
  },
  async ({ domains, provider }) => {
    try {
      const providerName = provider ?? loadConfig().default_registrar ?? "route53";
      const reg = getRegistrarProvider(providerName);
      const results = await Promise.allSettled(domains.map((d) => reg.checkAvailability(d)));
      const output = results.map((r, i) =>
        r.status === "fulfilled" ? r.value : { domain: domains[i], error: r.reason instanceof Error ? r.reason.message : String(r.reason) }
      );
      return { content: [{ type: "text", text: JSON.stringify(output, null, 2) }] };
    } catch (error: unknown) {
      return { content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

server.registerTool(
  "domain_setup",
  {
    title: "Buy + Setup Domain",
    description: "Full setup: buy domain via registrar, create DNS zone, return nameservers. Uses contact info from config.",
    inputSchema: {
      domain: z.string().describe("Domain to purchase and set up"),
      registrar: z.string().optional().describe("Registrar provider (default: config default-registrar or route53)"),
      dns: z.string().optional().describe("DNS provider for zone creation (default: config default-dns or route53)"),
      years: z.number().optional().describe("Registration years (default: 1)"),
      wait: z.boolean().optional().describe("Poll until registration completes before creating zone"),
    },
  },
  async ({ domain, registrar, dns, years, wait }) => {
    try {
      const cfg = loadConfig();
      const registrarName = registrar ?? cfg.default_registrar ?? "route53";
      const dnsName = dns ?? cfg.default_dns ?? registrarName;

      if (registrarName !== "route53") throw new Error("Direct purchase currently only supported via route53");

      const contact = resolveContact({});
      const { registerDomain: r53Register, checkAvailability: r53Check, getRegistrationStatus: r53Status, createHostedZone } = await import("../lib/route53.js");

      const avail = await r53Check(domain);
      if (!avail.available) throw new Error(`${domain} is not available`);

      const reg = await r53Register(domain, contact, years ?? 1);

      if (wait) {
        let status = "IN_PROGRESS";
        while (status === "IN_PROGRESS" || status === "SUBMITTED") {
          await new Promise((r) => setTimeout(r, 10_000));
          status = (await r53Status(reg.operationId)).status;
        }
        if (status !== "SUCCESSFUL") throw new Error(`Registration ${status}`);
      }

      let nameservers: string[] = [];
      if (dnsName === "cloudflare") {
        const zone = await cfCreateZone(domain);
        nameservers = zone.nameservers ?? [];
      } else {
        const zone = await createHostedZone(domain, "Managed by @hasna/domains");
        nameservers = zone.name_servers ?? [];
      }

      createDomain({ name: domain, registrar: "AWS Route 53", status: "active", auto_renew: true, nameservers });

      return { content: [{ type: "text", text: JSON.stringify({ domain, operationId: reg.operationId, nameservers, dns_provider: dnsName }, null, 2) }] };
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
    },
  },
  async ({ domain, provider }) => {
    try {
      const providerName = provider ?? loadConfig().default_dns ?? "route53";
      const dns = getDnsProvider(providerName);
      const records = await dns.getDnsRecords(domain);
      return { content: [{ type: "text", text: JSON.stringify(records, null, 2) }] };
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
    inputSchema: {},
  },
  async () => {
    try {
      const provider = createRoute53Provider();
      const result = await provider.syncToLocalDb({
        getDomainByName,
        createDomain,
        updateDomain,
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error: unknown) {
      return { content: [{ type: "text", text: `Sync failed: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

// --- Start ---
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("domains MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
