import chalk from "chalk";
import type { OutputFormat } from "../types";

export function print(data: unknown, format: OutputFormat = "pretty"): void {
  if (format === "json") {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  if (typeof data === "string") {
    console.log(data);
    return;
  }
  console.log(JSON.stringify(data, null, 2));
}

export function success(message: string): void {
  console.log(chalk.green(message));
}

export function info(message: string): void {
  console.log(chalk.cyan(message));
}

export function error(message: string): void {
  console.error(chalk.red(message));
}
