import chalk from "chalk";
import type { OutputFormat } from "../types/index.js";

export type { OutputFormat };

export function formatOutput(data: unknown, format: OutputFormat = "pretty"): string {
  if (format === "json") return JSON.stringify(data, null, 2);
  if (Array.isArray(data)) {
    return data.map((item, i) => `${chalk.cyan(`[${i + 1}]`)} ${formatPrettyItem(item)}`).join("\n\n");
  }
  return formatPrettyItem(data);
}

function formatPrettyItem(item: unknown, indent = 0): string {
  if (item === null || item === undefined) return chalk.gray("null");
  if (typeof item !== "object") return String(item);
  const spaces = "  ".repeat(indent);
  return Object.entries(item as Record<string, unknown>)
    .map(([key, value]) => {
      if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        return `${spaces}${chalk.blue(key)}:\n${formatPrettyItem(value, indent + 1)}`;
      }
      if (Array.isArray(value)) {
        return `${spaces}${chalk.blue(key)}: ${value.length ? JSON.stringify(value) : chalk.gray("[]")}`;
      }
      return `${spaces}${chalk.blue(key)}: ${chalk.white(String(value))}`;
    })
    .join("\n");
}

export function success(message: string): void {
  console.log(chalk.green("OK"), message);
}

export function error(message: string): void {
  console.error(chalk.red("ERROR"), message);
}

export function warn(message: string): void {
  console.warn(chalk.yellow("WARN"), message);
}

export function info(message: string): void {
  console.log(chalk.blue("INFO"), message);
}

export function print(data: unknown, format: OutputFormat = "pretty"): void {
  console.log(formatOutput(data, format));
}
