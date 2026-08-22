import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getDataDir, ensureParentDir } from "../paths.js";

export interface DomainMapping {
  domain: string;
  port: number;
  targetHost: string;
}

function getDnsPath(): string {
  return join(getDataDir(), "dns.json");
}

function readMappings(): DomainMapping[] {
  const path = getDnsPath();
  if (!existsSync(path)) return [];
  return JSON.parse(readFileSync(path, "utf8")) as DomainMapping[];
}

function writeMappings(mappings: DomainMapping[]): string {
  const path = getDnsPath();
  ensureParentDir(path);
  writeFileSync(path, `${JSON.stringify(mappings, null, 2)}\n`, "utf8");
  return path;
}

export function addDomainMapping(domain: string, port: number, targetHost = "127.0.0.1"): DomainMapping[] {
  const mappings = readMappings().filter((entry) => entry.domain !== domain);
  mappings.push({ domain, port, targetHost });
  writeMappings(mappings);
  return mappings.sort((left, right) => left.domain.localeCompare(right.domain));
}

export function listDomainMappings(): DomainMapping[] {
  return readMappings().sort((left, right) => left.domain.localeCompare(right.domain));
}

export function renderDomainMapping(domain: string): { hostsEntry: string; caddySnippet: string; certPath: string; keyPath: string } {
  const entry = readMappings().find((mapping) => mapping.domain === domain);
  if (!entry) {
    throw new Error(`Domain mapping not found: ${domain}`);
  }

  return {
    hostsEntry: `${entry.targetHost} ${entry.domain}`,
    caddySnippet: `${entry.domain} {\n  reverse_proxy 127.0.0.1:${entry.port}\n  tls ${join(getDataDir(), "certs", `${entry.domain}.pem`)} ${join(getDataDir(), "certs", `${entry.domain}-key.pem`)}\n}`,
    certPath: join(getDataDir(), "certs", `${entry.domain}.pem`),
    keyPath: join(getDataDir(), "certs", `${entry.domain}-key.pem`),
  };
}
