#!/usr/bin/env bun

import { Command } from "commander";
import { registerDomainCommand } from "./commands/domain.js";
import { registerDnsCommands } from "./commands/dns.js";
import { registerZoneCommand } from "./commands/zone.js";
import { registerSslCommand } from "./commands/ssl.js";
import { registerAlertCommands } from "./commands/alerts.js";
import { registerMonitorCommand } from "./commands/monitor.js";
import { registerProviderCommand } from "./commands/provider.js";
import { registerProviderCommands } from "./commands/providers.js";
import { registerBrandsightCommands } from "./commands/brandsight.js";
import { registerConfigCommands } from "./commands/config.js";
import { registerDoctorCommand } from "./commands/doctor.js";
import { registerMcpCommand } from "./commands/mcp-install.js";
import { registerServeCommand } from "./commands/serve.js";
import { registerRoute53Commands } from "./commands/route53.js";
import { registerOwnerCommand } from "./commands/owner.js";
import { registerHistoryCommand } from "./commands/history.js";
import { registerResearchCommand } from "./commands/research.js";
import { registerOutreachCommand } from "./commands/outreach.js";
import { registerSedoCommand } from "./commands/sedo.js";
import { registerWalletCommand } from "./commands/wallet.js";
import { registerProvisionCommand } from "./commands/provision.js";
import { getPackageVersion } from "../lib/version.js";

const program = new Command();

program
  .name("domains")
  .description("Domain portfolio and DNS management for AI agents")
  .version(getPackageVersion());

// ── Core noun-based commands ───────────────────────────────────────────────
registerDomainCommand(program);   // domains domain <list|get|add|update|delete|buy|setup|sync|renew|check|whois|export|expiring|stats>
registerDnsCommands(program);     // domains dns <list|add|update|remove|pull|push|check-propagation|export|import|validate|discover-subdomains>
registerZoneCommand(program);     // domains zone <list|create|info|delete>
registerSslCommand(program);      // domains ssl <check|expiring>
registerAlertCommands(program);   // domains alert <set|list>
registerMonitorCommand(program);  // domains monitor <watch|similar|threats>
registerProviderCommand(program); // domains provider <list|test>
registerProviderCommands(program); // domains providers, sync, renew, check
registerConfigCommands(program);  // domains config <show|set|unset>
registerDoctorCommand(program);   // domains doctor
registerMcpCommand(program);      // domains mcp <install|uninstall|status>
registerServeCommand(program);    // domains serve

// ── Legacy provider-specific namespace (kept for explicit Route 53 ops) ───
registerRoute53Commands(program); // domains r53 <...>

// ── Owner tracking (premium domain owners) ───────────────────────────────
registerOwnerCommand(program);  // domains owner <list|get|add|update|delete|extract|link|whois|info>

// ── Domain history tracking ──────────────────────────────────────────────
registerHistoryCommand(program);  // domains history <list|timeline|range|delete|purge>

// ── AI research & reputation ─────────────────────────────────────────────
registerResearchCommand(program);  // domains research <exa|answer|reputation|blacklisted|threats>

// ── Owner outreach (SMS/WhatsApp/email) ──────────────────────────────────
registerOutreachCommand(program);  // domains outreach <sms|whatsapp|email>

// ── Sedo marketplace integration ─────────────────────────────────────────
registerSedoCommand(program);  // domains sedo <search|status|portfolio|add|edit|remove|blacklist|buy>

// ── Wallet payment integration ───────────────────────────────────────────
registerWalletCommand(program);  // domains wallet <cards|buy|renew>
registerProvisionCommand(program);  // domains provision <status>

program.parse(process.argv);
