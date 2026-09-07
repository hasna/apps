import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { ensureDataDir, type ConfigEnv } from "./config.js";
import { randomToken } from "./slug.js";

/** The machine id, kept in the app home derived from the env the caller handed over. */
export function getMachineId(env: ConfigEnv = process.env): string {
  const path = join(ensureDataDir(env), "machine-id");
  if (existsSync(path)) {
    const existing = readFileSync(path, "utf-8").trim();
    if (existing) return existing;
  }
  const safeHost = hostname().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const id = `${safeHost || "machine"}-${randomToken(8).toLowerCase()}`;
  writeFileSync(path, `${id}\n`);
  return id;
}
