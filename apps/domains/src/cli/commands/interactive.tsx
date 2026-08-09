import React from "react";
import type { Command } from "commander";
import chalk from "chalk";
import { render } from "ink";
import { App } from "../tui/App.js";

import { printErrorLine } from "../../lib/stdout.js";

/**
 * `emit` is injectable because the diagnostic now goes to fd 2 directly rather
 * than through `console.error`, and a completed write to a real descriptor is
 * not observable with `spyOn(console, "error")`. Injecting the sink tests what
 * the function says rather than which global it happens to route through.
 */
export function assertInteractiveTty(emit: (line: string) => void = (line) => {
  printErrorLine(line);
}): void {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    emit(chalk.red("Interactive mode requires a TTY terminal."));
    emit(
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
