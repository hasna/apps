#!/usr/bin/env node
import { Command } from "commander";
import { getVersion } from "./helpers.js";
import { registerScanCommand } from "./commands/scan.js";
import { registerFindingsCommand } from "./commands/findings.js";
import { registerLLMCommands } from "./commands/llm.js";
import { registerReviewCommand } from "./commands/review.js";
import { registerManageCommands } from "./commands/manage.js";
import { registerMcpInstallCommand } from "./commands/mcp-install.js";
import { registerServeCommand } from "./commands/serve.js";
import { registerSupplyChainCommands } from "./commands/supply-chain.js";
import { registerAlertsCommand } from "./commands/alerts.js";

const program = new Command();

program
  .name("security")
  .description("AI-powered security scanner for git repos")
  .version(getVersion());

registerScanCommand(program);
registerFindingsCommand(program);
registerLLMCommands(program);
registerReviewCommand(program);
registerManageCommands(program);
registerMcpInstallCommand(program);
registerServeCommand(program);
registerSupplyChainCommands(program);
registerAlertsCommand(program);

program.parse();
