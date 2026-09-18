import { spawnSync } from "node:child_process";

export type DomainsAction = "check" | "buy" | "setup";

export function buildDomainsArgs(action: DomainsAction, domain: string): string[] {
  switch (action) {
    case "check":
      return ["domain", "check", domain];
    case "buy":
      return ["domain", "buy", domain];
    case "setup":
      return ["domain", "setup", domain];
  }
}

export function runDomains(action: DomainsAction, domain: string, options: { dryRun?: boolean } = {}): { command: string; status: number | null; stdout: string; stderr: string } {
  const args = buildDomainsArgs(action, domain);
  const command = `domains ${args.join(" ")}`;
  if (options.dryRun) {
    return { command, status: 0, stdout: command, stderr: "" };
  }
  const result = spawnSync("domains", args, { encoding: "utf-8" });
  return {
    command,
    status: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}
