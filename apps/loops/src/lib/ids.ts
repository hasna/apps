import { randomBytes } from "node:crypto";

export function genId(length = 12): string {
  return randomBytes(Math.ceil(length / 2)).toString("hex").slice(0, length);
}

export function nowIso(): string {
  return new Date().toISOString();
}
