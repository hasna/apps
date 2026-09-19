import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { normalizeHostname } from "./config.js";

export interface LocalSetupPlan {
  domain: string;
  targetHost: string;
  port: number;
  hostsEntry: string;
  caddySnippet: string;
  certPath: string;
  keyPath: string;
  machinesCommand: string;
  sudoRequired: boolean;
}

export function createLocalSetupPlan(input: {
  domain: string;
  port?: number;
  targetHost?: string;
  certDir?: string;
}): LocalSetupPlan {
  const domain = normalizeHostname(input.domain);
  const targetHost = input.targetHost || "127.0.0.1";
  const port = input.port || 8787;
  const certDir = input.certDir || join(homedir(), ".hasna", "machines", "certs");
  const certPath = join(certDir, `${domain}.pem`);
  const keyPath = join(certDir, `${domain}-key.pem`);
  return {
    domain,
    targetHost,
    port,
    hostsEntry: `${targetHost} ${domain}`,
    caddySnippet: `${domain} {
  reverse_proxy ${targetHost}:${port}
  tls ${certPath} ${keyPath}
}`,
    certPath,
    keyPath,
    machinesCommand: `machines dns add --domain ${domain} --target-host ${targetHost} --port ${port} --json`,
    sudoRequired: true,
  };
}

export function registerMachinesDns(input: { domain: string; port?: number; targetHost?: string }): {
  command: string;
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const plan = createLocalSetupPlan(input);
  const args = [
    "dns",
    "add",
    "--domain",
    plan.domain,
    "--target-host",
    plan.targetHost,
    "--port",
    String(plan.port),
    "--json",
  ];
  const result = spawnSync("machines", args, { encoding: "utf-8" });
  return {
    command: `machines ${args.join(" ")}`,
    status: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}
