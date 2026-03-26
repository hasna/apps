#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  createDomain,
  getDomain,
  listDomains,
  updateDomain,
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
  syncAll,
} from "../lib/registrar.js";
import {
  monitorBrand,
  getSimilarDomains,
  getThreatAssessment,
} from "../lib/brandsight.js";

const server = new McpServer({
  name: "domains",
  version: "0.0.1",
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
      status: z.enum(["active", "expired", "transferring", "redemption"]).optional(),
      registered_at: z.string().optional(),
      expires_at: z.string().optional(),
      auto_renew: z.boolean().optional(),
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
    description: "Get a domain by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const domain = getDomain(id);
    if (!domain) {
      return { content: [{ type: "text", text: `Domain '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(domain, null, 2) }] };
  }
);

server.registerTool(
  "list_domains",
  {
    title: "List Domains",
    description: "List domains with optional filters.",
    inputSchema: {
      search: z.string().optional(),
      status: z.enum(["active", "expired", "transferring", "redemption"]).optional(),
      registrar: z.string().optional(),
      limit: z.number().optional(),
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
      status: z.enum(["active", "expired", "transferring", "redemption"]).optional(),
      registered_at: z.string().optional(),
      expires_at: z.string().optional(),
      auto_renew: z.boolean().optional(),
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
    description: "Sync domains from all configured registrar providers (Namecheap, GoDaddy) to local database.",
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
