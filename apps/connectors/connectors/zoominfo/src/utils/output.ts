import type { OutputFormat } from "../types";

export function print(value: unknown, format: OutputFormat = "pretty"): void {
  if (format === "json") {
    console.log(JSON.stringify(value, null, 2));
    return;
  }

  if (typeof value === "string") {
    console.log(value);
    return;
  }

  console.log(JSON.stringify(value, null, 2));
}

export function success(message: string): void {
  console.log(message);
}

export function info(message: string): void {
  console.log(message);
}

export function error(message: string): void {
  console.error(message);
}
