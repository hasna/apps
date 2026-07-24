import type { OutputFormat } from "../types";

export function print(data: unknown, format: OutputFormat = "pretty"): void {
  if (format === "json") {
    console.log(JSON.stringify(data));
    return;
  }
  console.log(JSON.stringify(data, null, 2));
}

export function error(message: string): void {
  console.error(message);
}

export function success(message: string): void {
  console.log(message);
}
