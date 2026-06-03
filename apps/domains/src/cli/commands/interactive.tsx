import React from "react";
import type { Command } from "commander";
import chalk from "chalk";
import { render } from "ink";
import { App } from "../tui/App.js";

export function assertInteractiveTty(): void {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error(chalk.red("Interactive mode requires a TTY terminal."));
    console.error(
      chalk.dim("Use `domains domain list` or `domains domain get <name>` for non-interactive use."),
    );
    process.exit(1);
  }
}

export function registerInteractiveCommand(program: Command): void {
  program
    .command("interactive")
    .description("Launch interactive domain portfolio browser (Ink TUI)")
    .option("--status <status>", "Initial filter status (e.g. active, premium, expiring)")
    .action((opts: { status?: string }) => {
      assertInteractiveTty();
      render(<App initialStatus={opts.status} />);
    });
}
