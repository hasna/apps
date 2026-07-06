#!/usr/bin/env bun

import { Command } from "commander";
import { registerDomainCommand } from "./commands/domain.js";
import { registerDnsCommands } from "./commands/dns.js";
import { registerZoneCommand } from "./commands/zone.js";
import { registerSslCommand } from "./commands/ssl.js";
import { registerAlertCommands } from "./commands/alerts.js";
import { registerProviderCommand } from "./commands/provider.js";
import { registerProviderCommands } from "./commands/providers.js";
import { registerConfigCommands } from "./commands/config.js";
import { registerDoctorCommand } from "./commands/doctor.js";
import { registerMcpCommand } from "./commands/mcp-install.js";
import { registerServeCommand } from "./commands/serve.js";
import { registerDbCommands } from "./commands/db.js";
import { registerRoute53Commands } from "./commands/route53.js";
import { getPackageVersion } from "../lib/version.js";

const OPTIONAL_GROUPS = [
  "brandsight",
  "events",
  "history",
  "interactive",
  "marketplace",
  "outreach",
  "owner",
  "provision",
  "research",
  "storage",
  "wallet",
] as const;

type OptionalGroup = (typeof OPTIONAL_GROUPS)[number];

function enabledOptionalGroups(env: Record<string, string | undefined> = process.env as Record<string, string | undefined>): Set<OptionalGroup> {
  const raw = env["DOMAINS_COMMAND_GROUPS"] ?? "";
  if (env["DOMAINS_ENABLE_EXTRAS"] === "1" || raw === "all") return new Set(OPTIONAL_GROUPS);
  return new Set(
    raw
      .split(",")
      .map((part) => part.trim().toLowerCase())
      .filter((part): part is OptionalGroup => (OPTIONAL_GROUPS as readonly string[]).includes(part))
  );
}

async function registerOptionalCommands(program: Command, groups: Set<OptionalGroup>): Promise<void> {
  if (groups.has("brandsight")) {
    const { registerMonitorCommand } = await import("./commands/monitor.js");
    registerMonitorCommand(program);
  }
  if (groups.has("marketplace")) {
    const { registerSedoCommand } = await import("./commands/sedo.js");
    registerSedoCommand(program);
  }
  if (groups.has("owner")) {
    const { registerOwnerCommand } = await import("./commands/owner.js");
    registerOwnerCommand(program);
  }
  if (groups.has("history")) {
    const { registerHistoryCommand } = await import("./commands/history.js");
    registerHistoryCommand(program);
  }
  if (groups.has("research")) {
    const { registerResearchCommand } = await import("./commands/research.js");
    registerResearchCommand(program);
  }
  if (groups.has("outreach")) {
    const { registerOutreachCommand } = await import("./commands/outreach.js");
    registerOutreachCommand(program);
  }
  if (groups.has("wallet")) {
    const { registerWalletCommand } = await import("./commands/wallet.js");
    registerWalletCommand(program);
  }
  if (groups.has("provision")) {
    const { registerProvisionCommand } = await import("./commands/provision.js");
    registerProvisionCommand(program);
  }
  if (groups.has("storage")) {
    const { registerStorageCommand } = await import("./commands/storage.js");
    registerStorageCommand(program);
  }
  if (groups.has("interactive")) {
    const { registerInteractiveCommand } = await import("./commands/interactive.js");
    registerInteractiveCommand(program);
  }
  if (groups.has("events")) {
    try {
      const { registerEventsCommands } = await import("@hasna/events/commander");
      registerEventsCommands(program, { source: "domains" });
    } catch (error) {
      console.error(`Events command group is enabled but @hasna/events could not be loaded: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

function registerOptionalHelp(program: Command): void {
  program
    .command("extras")
    .description("List optional command groups and how to enable them")
    .option("--json", "Output JSON", false)
    .action((opts: { json?: boolean }) => {
      const groups = enabledOptionalGroups();
      const body = {
        enabled: Array.from(groups),
        available: [...OPTIONAL_GROUPS],
        enable_all: "DOMAINS_ENABLE_EXTRAS=1 domains <command>",
        enable_some: "DOMAINS_COMMAND_GROUPS=marketplace,storage domains <command>",
      };
      if (opts.json) {
        console.log(JSON.stringify(body, null, 2));
        return;
      }
      console.log("Optional command groups:");
      for (const group of body.available) console.log(`  ${groups.has(group) ? "✓" : " "} ${group}`);
      console.log("\nEnable all:  DOMAINS_ENABLE_EXTRAS=1 domains <command>");
      console.log("Enable some: DOMAINS_COMMAND_GROUPS=marketplace,storage domains <command>");
    });
}

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
registerProviderCommand(program); // domains provider <list|test>
registerProviderCommands(program); // domains providers, sync, renew, check
registerConfigCommands(program);  // domains config <show|set|unset>
registerDoctorCommand(program);   // domains doctor
registerMcpCommand(program);      // domains mcp <install|uninstall|status>
registerServeCommand(program);    // domains serve
registerDbCommands(program);      // domains db <migrate|status>

// ── Legacy provider-specific namespace (kept for explicit Route 53 ops) ───
registerRoute53Commands(program); // domains r53 <...>

registerOptionalHelp(program);

await registerOptionalCommands(program, enabledOptionalGroups());
program.parse(process.argv);
