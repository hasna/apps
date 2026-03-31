#!/usr/bin/env bun

import { Command } from "commander";
import { registerDomainCommand } from "./commands/domain.js";
import { registerDnsCommands } from "./commands/dns.js";
import { registerZoneCommand } from "./commands/zone.js";
import { registerSslCommand } from "./commands/ssl.js";
import { registerAlertCommands } from "./commands/alerts.js";
import { registerMonitorCommand } from "./commands/monitor.js";
import { registerProviderCommand } from "./commands/provider.js";
import { registerConfigCommands } from "./commands/config.js";
import { registerDoctorCommand } from "./commands/doctor.js";
import { registerMcpCommand } from "./commands/mcp-install.js";
import { registerServeCommand } from "./commands/serve.js";
import { registerRoute53Commands } from "./commands/route53.js";

const program = new Command();

program
  .name("domains")
  .description("Domain portfolio and DNS management for AI agents")
  .version("0.0.3");

// ── Core noun-based commands ───────────────────────────────────────────────
registerDomainCommand(program);   // domains domain <list|get|add|update|delete|buy|setup|sync|renew|check|whois|export|expiring|stats>
registerDnsCommands(program);     // domains dns <list|add|update|remove|pull|push|check-propagation|export|import|validate|discover-subdomains>
registerZoneCommand(program);     // domains zone <list|create|info|delete>
registerSslCommand(program);      // domains ssl <check|expiring>
registerAlertCommands(program);   // domains alert <set|list>
registerMonitorCommand(program);  // domains monitor <watch|similar|threats>
registerProviderCommand(program); // domains provider <list|test>
registerConfigCommands(program);  // domains config <show|set|unset>
registerDoctorCommand(program);   // domains doctor
registerMcpCommand(program);      // domains mcp <install|uninstall|status>
registerServeCommand(program);    // domains serve

// ── Legacy provider-specific namespace (kept for explicit Route 53 ops) ───
registerRoute53Commands(program); // domains r53 <...>

program.parse(process.argv);
