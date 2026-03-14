import chalk from "chalk";

export function printTable(headers: string[], rows: string[][]): void {
  if (rows.length === 0) {
    console.log(chalk.dim("  (no records)"));
    return;
  }

  // Calculate column widths
  const colWidths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length))
  );

  const separator = colWidths.map((w) => "─".repeat(w + 2)).join("┼");
  const headerLine = headers
    .map((h, i) => ` ${chalk.bold(h.padEnd(colWidths[i] ?? 0))} `)
    .join("│");
  const topBorder = colWidths.map((w) => "─".repeat(w + 2)).join("┬");
  const midBorder = separator;
  const bottomBorder = colWidths.map((w) => "─".repeat(w + 2)).join("┴");

  console.log("┌" + topBorder + "┐");
  console.log("│" + headerLine + "│");
  console.log("├" + midBorder + "┤");

  for (const row of rows) {
    const rowLine = row
      .map((cell, i) => ` ${(cell ?? "").padEnd(colWidths[i] ?? 0)} `)
      .join("│");
    console.log("│" + rowLine + "│");
  }

  console.log("└" + bottomBorder + "┘");
}

type ChalkFn = (s: string) => string;
const STATUS_COLORS: Record<string, ChalkFn> = {
  succeeded: chalk.green,
  running: chalk.cyan,
  pending: chalk.yellow,
  failed: chalk.red,
  cancelled: chalk.dim,
  queued: chalk.yellow,
  validating_files: chalk.blue,
};

export function printStatus(status: string): string {
  const colorFn = STATUS_COLORS[status] ?? chalk.white;
  return colorFn(`● ${status}`);
}

export function printJson(obj: unknown): void {
  console.log(JSON.stringify(obj, null, 2));
}

export function printError(message: string): void {
  console.error(chalk.red("✗ Error: ") + message);
}

export function printSuccess(message: string): void {
  console.log(chalk.green("✓ ") + message);
}

export function printInfo(message: string): void {
  console.log(chalk.dim("  " + message));
}
