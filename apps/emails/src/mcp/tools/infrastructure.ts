import { provisionSendingDomain, domainDnsSucceeded } from "../../lib/domain-dns-api.js";
import { provisionAddress, addressProvisioningReady } from "../../lib/address-provisioning-api.js";
// MCP tool module: infrastructure.ts
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AGENT_WRITABLE_CONFIG_KEYS, loadConfig, getConfigValue, setAgentConfigValue } from '../../lib/config.js';
import { normalizeRoute53RegistrationContact } from '../../lib/route53-contact.js';
import { formatError, resolveId } from '../helpers.js';

const MAX_MCP_S3_SYNC_LIMIT = 10000;
const MAX_MCP_PROVISION_WAIT_SECONDS = 300;
const MAX_MCP_PROVISION_INTERVAL_SECONDS = 60;
const MAX_DOMAIN_REGISTRATION_YEARS = 10;

export function registerInfrastructureTools(server: McpServer): void {
  // ─── DOMAIN PURCHASING (via @hasna/domains / Route 53) ───────────────────────

  server.tool(
  "check_domain_availability",
  "Check if a domain is available for purchase via AWS Route 53 and get pricing",
  { domain: z.string().describe("Domain to check (e.g. example.com)") },
  async ({ domain }) => {
    try {
      const { r53CheckAvailability } = await import("@hasna/domains");
      const result = await r53CheckAvailability(domain);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (e) { return { content: [{ type: "text", text: `Error: ${formatError(e)}` }], isError: true }; }
  },
  );

  server.tool(
  "register_domain",
  "Purchase and register a domain via AWS Route 53. Returns an operation ID to track progress.",
  {
    domain: z.string(),
    first_name: z.string(), last_name: z.string(),
    email: z.string(), phone: z.string().describe("E.164 format, e.g. +1.5551234567"),
    address_line_1: z.string(), city: z.string(), state: z.string().optional(),
    country_code: z.string().describe("Two-letter country code, e.g. US"),
    zip_code: z.string(),
    organization_name: z.string().optional(),
    duration_years: z.number().int().positive().max(MAX_DOMAIN_REGISTRATION_YEARS).optional().describe("Registration years (default: 1, max: 10)"),
  },
  async (params) => {
    try {
      const { r53RegisterDomain } = await import("@hasna/domains");
      const contact = normalizeRoute53RegistrationContact({
        first_name: params.first_name, last_name: params.last_name,
        email: params.email, phone: params.phone,
        address_line_1: params.address_line_1, city: params.city,
        state: params.state, country_code: params.country_code,
        zip_code: params.zip_code, organization_name: params.organization_name,
      });
      const result = await r53RegisterDomain(params.domain, contact as Parameters<typeof r53RegisterDomain>[1], params.duration_years ?? 1);
      return { content: [{ type: "text", text: JSON.stringify({ domain: params.domain, ...result }, null, 2) }] };
    } catch (e) { return { content: [{ type: "text", text: `Error: ${formatError(e)}` }], isError: true }; }
  },
  );

  server.tool(
  "get_domain_registration_status",
  "Check the status of a domain registration operation",
  { operation_id: z.string() },
  async ({ operation_id }) => {
    try {
      const { r53GetRegistrationStatus } = await import("@hasna/domains");
      return { content: [{ type: "text", text: JSON.stringify(await r53GetRegistrationStatus(operation_id), null, 2) }] };
    } catch (e) { return { content: [{ type: "text", text: `Error: ${formatError(e)}` }], isError: true }; }
  },
  );

  server.tool(
  "list_registered_domains",
  "List all domains registered in AWS Route 53",
  {},
  async () => {
    try {
      const { r53ListRegisteredDomains } = await import("@hasna/domains");
      return { content: [{ type: "text", text: JSON.stringify(await r53ListRegisteredDomains(), null, 2) }] };
    } catch (e) { return { content: [{ type: "text", text: `Error: ${formatError(e)}` }], isError: true }; }
  },
  );

  server.tool(
  "setup_domain_for_email",
  "Configure an already-owned domain through the account API and server-bound provider/Cloudflare zone. Returns the durable DNS setup receipt; does not purchase domains.",
  {
    domain: z.string().describe("Domain to set up"),
    provider_id: z.string().describe("SES or Resend provider ID"),
    contact: z.object({
      first_name: z.string(), last_name: z.string(), email: z.string(),
      phone: z.string(), address_line_1: z.string(), city: z.string(),
      state: z.string().optional(), country_code: z.string(), zip_code: z.string(),
      organization_name: z.string().optional(),
    }).optional().describe("Legacy purchase input: rejected by this owned-domain operation; use the registrar workflow"),
    duration_years: z.number().int().positive().max(MAX_DOMAIN_REGISTRATION_YEARS).optional(),
    add_mx: z.boolean().optional().describe("Also publish an inbound MX record for receiving (default false)"),
    force_mx_switch: z.boolean().optional().describe("Allow adding inbound MX when an existing provider already owns root MX"),
  },
  async ({ domain, provider_id, contact, duration_years, add_mx, force_mx_switch }) => {
    try {
      if (contact !== undefined || duration_years !== undefined) throw new Error("This setup operation configures an already-owned domain. Use the separate registrar workflow for purchases; no setup request was submitted.");
      const { setupOwnedDomain } = await import("../../lib/domain-dns-api.js");
      const result = await setupOwnedDomain(domain, { provider: resolveId("providers", provider_id), addMx: add_mx, forceMxSwitch: force_mx_switch });
      return { content: [{ type: "text", text: JSON.stringify(result) }], ...(!domainDnsSucceeded(result) ? { isError: true } : {}) };
    } catch (e) { return { content: [{ type: "text", text: `Error: ${formatError(e)}` }], isError: true }; }
  },
  );

  // ─── CLOUDFLARE DNS ───────────────────────────────────────────────────────────

  server.tool(
  "get_cloudflare_zone",
  "Find the Cloudflare zone ID for a domain. Looks up zone by domain name.",
  {
    domain: z.string().describe("Domain name to look up"),
    cloudflare_token: z.string().optional().describe("Cloudflare API token (falls back to config/env)"),
  },
  async ({ domain, cloudflare_token }) => {
    try {
      const { getCloudflare, findZone } = await import("../../lib/cloudflare-dns.js");
      const cf = getCloudflare(cloudflare_token);
      const zone = await findZone(cf, domain);
      if (!zone) return { content: [{ type: "text", text: `No Cloudflare zone found for ${domain}` }], isError: true };
      return { content: [{ type: "text", text: JSON.stringify(zone, null, 2) }] };
    } catch (e) {
      return { content: [{ type: "text", text: `Error: ${formatError(e)}` }], isError: true };
    }
  },
  );

  server.tool(
  "setup_cloudflare_dns",
  "Automatically create all email DNS records (DKIM, SPF, DMARC, optionally MX) in Cloudflare for a domain. Skips records that already exist.",
  {
    domain: z.string().describe("Domain to configure"),
    provider_id: z.string().describe("SES or Resend provider ID"),
    cloudflare_token: z.string().optional().describe("Legacy inline token input: rejected; configure the server-held account binding"),
    add_mx: z.boolean().optional().describe("Also add MX record for receiving email"),
    mx_server: z.string().optional().describe("Custom MX server hostname (default: inbound-smtp.<region>.amazonaws.com for SES)"),
    register_domain: z.boolean().optional().describe("Register the domain with SES/Resend first if not already added"),
    force_mx_switch: z.boolean().optional().describe("Allow adding inbound MX when an existing provider already owns root MX"),
  },
  async ({ domain, provider_id, cloudflare_token, add_mx, mx_server, register_domain, force_mx_switch }) => {
    try {
      if (cloudflare_token !== undefined) throw new Error("Cloudflare DNS setup uses the account's server-held token. Configure that binding through the operator workflow; inline tokens are not accepted and no setup request was submitted.");
      const { setupDomainCloudflare } = await import("../../lib/domain-dns-api.js");
      const result = await setupDomainCloudflare(domain, { provider: resolveId("providers", provider_id), registerSes: register_domain, addMx: add_mx, mxServer: mx_server, forceMxSwitch: force_mx_switch });
      return { content: [{ type: "text", text: JSON.stringify(result) }], ...(!domainDnsSucceeded(result) ? { isError: true } : {}) };
    } catch (e) {
      return { content: [{ type: "text", text: `Error: ${formatError(e)}` }], isError: true };
    }
  },
  );

  server.tool(
  "sync_s3_inbox",
  "Sync inbound emails from an S3 bucket (stored by SES receipt rules) into local DB. Parses raw RFC 2822 email files.",
  {
    bucket: z.string().describe("S3 bucket name"),
    prefix: z.string().optional().describe("S3 key prefix (e.g. inbound/example.com/)"),
    region: z.string().optional().describe("AWS region (default: us-east-1)"),
    provider_id: z.string().optional().describe("Associate emails with this provider ID"),
    limit: z.number().int().positive().max(MAX_MCP_S3_SYNC_LIMIT).optional().describe("Max emails per run (default: 100, max: 10000)"),
  },
  async ({ bucket, prefix, region, provider_id, limit }) => {
    try {
      const { syncS3Inbox } = await import("../../lib/s3-sync.js");
      const result = await syncS3Inbox({ bucket, prefix, region, providerId: provider_id, limit: limit ?? 100 });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (e) {
      return { content: [{ type: "text", text: `Error: ${formatError(e)}` }], isError: true };
    }
  },
  );

  server.tool(
  "setup_ses_inbound",
  "Configure and verify the exact server-bound S3 bucket and SES receipt rule through the operator API. Does not start an ingest worker.",
  {
    domain: z.string().describe("Domain to receive email for"),
    bucket: z.string().describe("S3 bucket name to create/use"),
    region: z.string().optional().describe("AWS region (default: us-east-1)"),
    prefix: z.string().optional().describe("S3 key prefix"),
    catch_all: z.boolean().optional().describe("Subdomain catch-all is rejected until separately authorized domain routes are configured"),
  },
  async ({ domain, bucket, region, prefix, catch_all }) => {
    try {
      const { setupSesInboundApi } = await import("../../lib/ses-inbound-setup-api.js");
      const result = await setupSesInboundApi({ domain, bucket, ...(region !== undefined ? { region } : {}), ...(prefix !== undefined ? { prefix } : {}), ...(catch_all !== undefined ? { catch_all } : {}) });
      return { content: [{ type: "text", text: JSON.stringify(result) }], ...(!result.ok || !result.verified ? { isError: true } : {}) };
    } catch (e) {
      return { content: [{ type: "text", text: `Error: ${formatError(e)}` }], isError: true };
    }
  },
  );

  // ─── CONFIG ───────────────────────────────────────────────────────────────────


  server.tool(
  "get_config",
  "Get a configuration value by key",
  { key: z.string().describe("Config key (e.g. attachment_storage, attachment_s3_bucket, default_provider)") },
  async ({ key }) => {
    try {
      const value = getConfigValue(key);
      return { content: [{ type: "text", text: value === undefined ? `${key} is not set` : JSON.stringify({ [key]: value }, null, 2) }] };
    } catch (e) {
      return { content: [{ type: "text", text: `Error: ${formatError(e)}` }], isError: true };
    }
  },
  );

  // The writable set is an ALLOWLIST (see lib/config.ts). `key: z.string()` used
  // to accept any key in the config file, and `saveConfig` re-seeds the in-process
  // cache so the write took effect immediately — including `emails_mode`, which
  // switches the datastore this process talks to mid-session, and every
  // credential-bearing key. The enum also publishes the permitted set in the tool
  // schema, so a client is told up front rather than by a rejection.
  server.tool(
  "set_config",
  `Set a configuration value. Writable keys: ${AGENT_WRITABLE_CONFIG_KEYS.join(", ")}`
    + " (attachment_storage: local|s3|none). Mode selection and credential keys are"
    + " not writable here — an operator sets those outside the agent surface.",
  {
    key: z.enum(AGENT_WRITABLE_CONFIG_KEYS).describe(`Config key (one of: ${AGENT_WRITABLE_CONFIG_KEYS.join(", ")})`),
    value: z.string().describe("Config value (strings, numbers, or JSON)"),
  },
  async ({ key, value }) => {
    try {
      let parsed: unknown;
      try { parsed = JSON.parse(value); } catch { parsed = value; }
      // Re-checked at the call, not only in the schema: the enum is the client's
      // hint, this is the boundary.
      setAgentConfigValue(key, parsed);
      return { content: [{ type: "text", text: JSON.stringify({ [key]: parsed }, null, 2) }] };
    } catch (e) {
      return { content: [{ type: "text", text: `Error: ${formatError(e)}` }], isError: true };
    }
  },
  );

  server.tool(
  "list_config",
  "List all configuration values",
  {},
  async () => {
    try {
      const config = loadConfig();
      return { content: [{ type: "text", text: JSON.stringify(config, null, 2) }] };
    } catch (e) {
      return { content: [{ type: "text", text: `Error: ${formatError(e)}` }], isError: true };
    }
  },
  );

  // ─── Feedback ────────────────────────────────────────────────────────────────

  server.tool(
  "send_feedback",
  "Save feedback in your Emails account. This stores feedback; it does not send an email or deliver it externally.",
  {
    message: z.string().trim().min(1).max(10000),
    email: z.string().email().max(254).optional(),
    category: z.enum(["bug", "feature", "general"]).optional(),
  },
  async (input) => {
    try {
      const { saveApiFeedback } = await import("../../lib/feedback-api.js");
      const receipt = await saveApiFeedback(input);
      return { content: [{ type: "text" as const, text: JSON.stringify(receipt) }] };
    } catch (error) {
      return { content: [{ type: "text" as const, text: formatError(error) }], isError: true };
    }
  },
  );

  // ─── PROVISIONING ───────────────────────────────────────────────────────────

  server.tool(
    "provision_domain",
    "Provision a domain for sending: create the SES identity and publish DKIM/SPF/DMARC (+optional MX) DNS records in Cloudflare. DNS is always Cloudflare.",
    {
      domain: z.string(),
      provider_id: z.string().describe("SES provider ID"),
      send_provider: z.string().optional(),
      add_mx: z.boolean().optional().describe("Also publish inbound MX (ses-s3 receive)"),
      force_mx_switch: z.boolean().optional().describe("Allow adding inbound MX when an existing provider already owns root MX"),
      dry_run: z.boolean().optional().describe("Return a plan without changing DNS or provider state"),
      wait: z.boolean().optional().describe("Wait for sending verification"),
      timeout_seconds: z.number().int().positive().max(MAX_MCP_PROVISION_WAIT_SECONDS).optional(),
      mail_from: z.string().optional().describe("Custom SES MAIL FROM subdomain"),
    },
    async (args) => {
      try {
        const result = await provisionSendingDomain(args.domain, {
          provider: args.provider_id, send: args.send_provider,
          addMx: args.add_mx, forceMxSwitch: args.force_mx_switch,
          dryRun: args.dry_run, wait: args.wait, mailFrom: args.mail_from,
          timeout: (args.timeout_seconds ?? MAX_MCP_PROVISION_WAIT_SECONDS).toString(),
        });
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }],
          ...(!domainDnsSucceeded(result, args.wait) ? { isError: true } : {}) };
      } catch (error) {
        return { content: [{ type: "text" as const, text: error instanceof Error ? error.message : "Domain provisioning failed" }], isError: true };
      }
    },
  );

  server.tool(
    "provision_address",
    "Create an email address on a provisioned domain with a receive strategy (ses-s3 | cf-routing | resend-webhook).",
    {
      email: z.string(),
      provider_id: z.string(),
      domain_id: z.string().optional().describe("Domain ID or prefix; defaults to matching provider/domain"),
      receive_strategy: z.enum(["ses-s3", "cf-routing", "resend-webhook"]).optional(),
      forward_to: z.string().optional(),
      owner: z.string().optional().describe("Owner name, ID, or ID prefix"),
      administrator: z.string().optional().describe("Administering agent name, ID, or ID prefix"),
      dry_run: z.boolean().optional().describe("Check readiness and return a plan without writing address or ownership state"),
      wait: z.boolean().optional().describe("Advance provisioning now and wait until ready"),
      timeout_seconds: z.number().int().positive().max(MAX_MCP_PROVISION_WAIT_SECONDS).optional().describe("Max seconds to wait when wait=true (max 300)"),
      interval_seconds: z.number().int().positive().max(MAX_MCP_PROVISION_INTERVAL_SECONDS).optional().describe("Polling interval when wait=true (max 60)"),
      inbound_bucket: z.string().optional().describe("Inbound S3 bucket for receive validation"),
    },
    async (args) => {
      try {
        const result = await provisionAddress(args.email, { provider:args.provider_id, domain:args.domain_id,
          receive:args.receive_strategy, forwardTo:args.forward_to, owner:args.owner, administrator:args.administrator,
          wait:args.wait, dryRun:args.dry_run, timeout:args.timeout_seconds, interval:args.interval_seconds, bucket:args.inbound_bucket });
        return {content:[{type:"text" as const,text:JSON.stringify(result)}],...(!addressProvisioningReady(result)?{isError:true}:{})};
      } catch(error) { return {content:[{type:"text" as const,text:error instanceof Error?error.message:"Address provisioning failed"}],isError:true}; }
    },
  );

  server.tool(
    "add_forwarding_rule",
    "Create or update an app-level forwarding rule. It forwards inbound mail only after this app has received or synced the source mailbox.",
    {
      source_address: z.string().describe("Mailbox to watch, e.g. user@example.com"),
      target_address: z.string().describe("Destination for forwarded copies"),
      provider_id: z.string().optional().describe("Provider used to send forwarded copies"),
      from_address: z.string().optional().describe("From address for forwarded copies; defaults to source_address"),
      enabled: z.boolean().optional().describe("Whether the rule is enabled; default true"),
    },
    async ({ source_address, target_address, provider_id, from_address, enabled }) => {
      try {
        const providerId = provider_id ? resolveId("providers", provider_id) : null;
        const { createForwardingRule } = await import("../../db/forwarding.js");
        const rule = await createForwardingRule({
          source_address,
          target_address,
          provider_id: providerId,
          from_address: from_address ?? null,
          enabled: enabled !== false,
        });
        return { content: [{ type: "text" as const, text: JSON.stringify({
          ...rule,
          cli_equivalent: `emails forwarding add ${source_address} ${target_address}${provider_id ? ` --provider ${provider_id}` : ""}${from_address ? ` --from ${from_address}` : ""}${enabled === false ? " --disabled" : ""} --json`,
        }, null, 2) }] };
      } catch (e) { return { content: [{ type: "text" as const, text: `Error: ${formatError(e)}` }], isError: true }; }
    },
  );

  server.tool(
    "list_forwarding_rules",
    "List app-level forwarding rules.",
    {
      source_address: z.string().optional(),
      enabled: z.boolean().optional(),
      limit: z.number().int().positive().max(1000).optional(),
      offset: z.number().int().min(0).optional(),
    },
    async ({ source_address, enabled, limit, offset }) => {
      try {
        const { listForwardingRules } = await import("../../db/forwarding.js");
        const rules = await listForwardingRules({ source_address, enabled, limit: limit ?? 50, offset: offset ?? 0 });
        return { content: [{ type: "text" as const, text: JSON.stringify({
          rules,
          cli_equivalent: `emails forwarding list${source_address ? ` --source ${source_address}` : ""}${enabled === true ? " --enabled" : enabled === false ? " --disabled" : ""}${limit ? ` --limit ${limit}` : ""}${offset ? ` --offset ${offset}` : ""} --json`,
        }, null, 2) }] };
      } catch (e) { return { content: [{ type: "text" as const, text: `Error: ${formatError(e)}` }], isError: true }; }
    },
  );

  server.tool(
    "run_forwarding_rules",
    "Process pending app-level forwarding rules.",
    {
      provider_id: z.string().optional(),
      from_address: z.string().optional(),
      limit: z.number().int().positive().max(1000).optional(),
      backfill: z.boolean().optional().describe("Also process matching messages received before the forwarding rule was created"),
    },
    async ({ provider_id, from_address, limit, backfill }) => {
      try {
        const providerId = provider_id ? resolveId("providers", provider_id) : undefined;
        const { processForwardingRules } = await import("../../lib/forwarding.js");
        const result = await processForwardingRules({ providerId, fromAddress: from_address, limit: limit ?? 100, backfill });
        return { content: [{ type: "text" as const, text: JSON.stringify({
          ...result,
          cli_equivalent: `emails forwarding run${provider_id ? ` --provider ${provider_id}` : ""}${from_address ? ` --from ${from_address}` : ""}${limit ? ` --limit ${limit}` : ""}${backfill ? " --backfill" : ""} --json`,
        }, null, 2) }] };
      } catch (e) { return { content: [{ type: "text" as const, text: `Error: ${formatError(e)}` }], isError: true }; }
    },
  );

  server.tool(
    "provision_status",
    "Show provisioning status of domains and their addresses.",
    {
      domain: z.string().optional(),
      limit: z.number().int().positive().max(1000).optional().describe("Maximum domains to return"),
      offset: z.number().int().min(0).optional().describe("Number of domains to skip"),
    },
    async ({ domain: reference, limit = 50, offset = 0 }) => {
      try {
        if (!Number.isInteger(limit) || limit < 1 || limit > 1000 || !Number.isInteger(offset) || offset < 0) throw new Error("Invalid provisioning pagination");
        const { listDomains } = await import("../../db/domains.js");
        const { listDomainProvisioningByIds, listAddressProvisioningByDomains } = await import("../../db/provisioning.js");
        const normalized = reference?.trim().toLowerCase();
        if (reference !== undefined && !normalized) throw new Error("Domain must not be blank");
        const matching = listDomains().filter(domain => !normalized || domain.domain.toLowerCase() === normalized || domain.id.startsWith(normalized));
        if (normalized && matching.length === 0) throw new Error(`Domain not found: ${reference}`);
        if (normalized && matching.length > 1) throw new Error(`Ambiguous domain: ${reference}`);
        const domains = matching.slice(offset, offset + limit);
        const ids = domains.map(domain => domain.id);
        const [states, addresses] = await Promise.all([listDomainProvisioningByIds(ids), listAddressProvisioningByDomains(ids)]);
        return { content: [{ type: "text" as const, text: JSON.stringify(domains.map(domain => ({ id: domain.id, domain: domain.domain, provider_id: domain.provider_id, provisioning: states.get(domain.id), addresses: addresses.get(domain.id) ?? [] }))) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: `Error: ${formatError(error)}` }], isError: true };
      }
    },
  );

}
