import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}
