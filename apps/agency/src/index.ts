#!/usr/bin/env bun
import { createRequire } from "module";
import { Command } from "commander";
import { PACKAGE_COUNT } from "./registry.js";
import { registerStatusCommand } from "./commands/status.js";
import { registerDoctorCommand } from "./commands/doctor.js";
import { registerInitCommand } from "./commands/init.js";
import { registerUpdateCommand } from "./commands/update.js";
import { registerSyncCommand } from "./commands/sync.js";
import { registerMcpCommand } from "./commands/mcp.js";
import { registerBackupCommand } from "./commands/backup.js";
import { registerDbCommand } from "./commands/db.js";
import { registerConnectCommand } from "./commands/connect.js";
import { registerPlaygroundCommand } from "./commands/playground.js";
import { registerLogsCommand } from "./commands/logs.js";
import { registerSearchCommand } from "./commands/search.js";
import { registerExportCommand } from "./commands/export.js";
import { registerNewCommand } from "./commands/new.js";
import { registerReleaseCommand } from "./commands/release.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json");

const program = new Command();
program
  .name("agency")
  .description(`Unified management CLI for all ${PACKAGE_COUNT} @hasna/* open-source packages`)
  .version(pkg.version);

registerStatusCommand(program);
registerDoctorCommand(program);
registerInitCommand(program);
registerUpdateCommand(program);
registerSyncCommand(program);
registerMcpCommand(program);
registerBackupCommand(program);
registerDbCommand(program);
registerConnectCommand(program);
registerPlaygroundCommand(program);
registerLogsCommand(program);
registerSearchCommand(program);
registerExportCommand(program);
registerNewCommand(program);
registerReleaseCommand(program);

program.parse();
