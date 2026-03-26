#!/usr/bin/env bun

import { Command } from "commander";
import { registerDomainCommands } from "./commands/domains.js";
import { registerDnsCommands } from "./commands/dns.js";
import { registerAlertCommands } from "./commands/alerts.js";
import { registerProviderCommands } from "./commands/providers.js";
import { registerBrandsightCommands } from "./commands/brandsight.js";
import { registerRoute53Commands } from "./commands/route53.js";

const program = new Command();

program
  .name("domains")
  .description("Domain portfolio and DNS management for AI agents")
  .version("0.0.1");

registerDomainCommands(program);
registerDnsCommands(program);
registerAlertCommands(program);
registerProviderCommands(program);
registerBrandsightCommands(program);
registerRoute53Commands(program);

program.parse(process.argv);
