import { spawnSync } from "node:child_process";

export interface DomainSetupInput {
  domain: string;
  subdomain?: string;
  target?: string;
  buy?: boolean;
  dryRun?: boolean;
}

export interface DomainSetupResult {
  configured: boolean;
  dry_run: boolean;
  commands: string[][];
  output: string;
  error?: string;
}

export function setupSigningDomain(input: DomainSetupInput): DomainSetupResult {
  const host = input.subdomain ? `${input.subdomain}.${input.domain}` : input.domain;
  const target = input.target ?? "localhost";
  const commands: string[][] = [];
  const logs: string[] = [];

  if (input.buy) {
    commands.push(["domains", "domain", "setup", input.domain]);
  } else {
    commands.push(["domains", "zone", "create", input.domain]);
  }
  commands.push(["domains", "dns", "add", "--domain", input.domain, "--type", "CNAME", "--name", host, "--value", target]);

  if (input.dryRun) {
    return {
      configured: false,
      dry_run: true,
      commands,
      output: commands.map((cmd) => cmd.join(" ")).join("\n"),
    };
  }

  for (const command of commands) {
    const cmd = command[0]!;
    const args = command.slice(1);
    const result = spawnSync(cmd, args, { encoding: "utf-8" });
    logs.push([result.stdout, result.stderr].filter(Boolean).join("\n").trim());
    if (result.error || result.status !== 0) {
      return {
        configured: false,
        dry_run: false,
        commands,
        output: logs.filter(Boolean).join("\n"),
        error: result.error?.message ?? `${cmd} exited with ${result.status}`,
      };
    }
  }

  return {
    configured: true,
    dry_run: false,
    commands,
    output: logs.filter(Boolean).join("\n"),
  };
}
