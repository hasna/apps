#!/usr/bin/env bun
import { Command } from "commander";
import { runCommand } from "./commands/run.js";
import { ciCommand } from "./commands/ci.js";
import { judgeCommand } from "./commands/judge.js";
import { compareCommand } from "./commands/compare.js";
import { estimateCommand } from "./commands/estimate.js";
import { generateCommand } from "./commands/generate.js";
import { calibrateCommand } from "./commands/calibrate.js";
import { doctorCommand } from "./commands/doctor.js";
import { mcpCommand } from "./commands/mcp.js";
import { captureCommand } from "./commands/capture.js";
import { completionCommand } from "./commands/completion.js";
import { syncCommand } from "./commands/sync.js";

const pkg = await Bun.file(new URL("../../package.json", import.meta.url)).json() as { version: string };

const program = new Command();

program
  .name("evals")
  .description("AI evaluation framework — LLM-as-judge + assertion-based evals")
  .version(pkg.version);

program.addCommand(runCommand());
program.addCommand(ciCommand());
program.addCommand(judgeCommand());
program.addCommand(compareCommand());
program.addCommand(estimateCommand());
program.addCommand(generateCommand());
program.addCommand(calibrateCommand());
program.addCommand(doctorCommand());
program.addCommand(mcpCommand());
program.addCommand(captureCommand());
program.addCommand(completionCommand());
program.addCommand(syncCommand());

program.parse(process.argv);
