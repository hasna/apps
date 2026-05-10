#!/usr/bin/env bun
import { Command } from "commander";
import { getPackageVersion } from "../lib/package-version.js";
import { registerRemoteCommands } from "./commands/remote-commands.js";

const program = new Command();

program
  .name("todos-remote")
  .description("Remote-only todos CLI for hosted compatible APIs")
  .version(getPackageVersion())
  .option("--project <id>", "Remote project ID")
  .option("-j, --json", "Output as JSON")
  .option("--agent <name>", "Agent name")
  .option("--session <id>", "Session ID");

registerRemoteCommands(program);

program.parse();
