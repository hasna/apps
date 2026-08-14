import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const READ_ONLY_TOOLS = new Set([
  "get_domain",
  "list_domains",
  "list_domain_offers",
  "get_domain_emails",
  "search_domains",
  "count_domains",
  "list_expiring_domains",
  "list_ssl_expiring",
  "get_domains_by_registrar",
  "get_domain_stats",
  "list_dns_records",
  "list_alerts",
  "whois_lookup",
  "check_dns_propagation",
  "check_ssl",
  "export_zone_file",
  "discover_subdomains",
  "validate_dns",
  "export_portfolio",
  "check_all_domains",
  "check_availability_namecheap",
  "list_providers",
  "monitor_brand",
  "similar_domains",
  "domain_threats",
  "r53_check_availability",
  "r53_registration_status",
  "r53_list_registered_domains",
  "r53_get_domain_detail",
  "r53_list_hosted_zones",
  "r53_get_hosted_zone",
  "r53_list_records",
  "domain_check",
  "dns_list",
  "list_domain_owners",
  "get_domain_owner",
  "storage_status",
]);

export function isReadOnlyMcpTool(name: string): boolean {
  return READ_ONLY_TOOLS.has(name);
}

export function applySafeModeToolFilter(server: McpServer, env: Record<string, string | undefined> = process.env as Record<string, string | undefined>): void {
  if (env["DOMAINS_MCP_SAFE_MODE"] !== "1") return;
  const originalRegisterTool = server.registerTool.bind(server) as (...args: any[]) => any;
  (server as any).registerTool = (name: string, ...args: any[]) => {
    if (!isReadOnlyMcpTool(name)) {
      return {
        enabled: false,
        handler: async () => ({ content: [], isError: true }),
        disable() {},
        enable() {},
        remove() {},
        update() { return this; },
      };
    }
    return originalRegisterTool(name, ...args);
  };
}
