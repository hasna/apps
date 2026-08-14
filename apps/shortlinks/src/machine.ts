import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { ensureDataDir } from "./config.js";
import { randomToken } from "./slug.js";

export function getMachineId(): string {
  const path = join(ensureDataDir(), "machine-id");
  if (existsSync(path)) {
    const existing = readFileSync(path, "utf-8").trim();
    if (existing) return existing;
  }
  const safeHost = hostname().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const id = `${safeHost || "machine"}-${randomToken(8).toLowerCase()}`;
  writeFileSync(path, `${id}\n`);
  return id;
}
