import { homedir, platform } from "node:os";
import { join } from "node:path";
import type { SetupResult, SetupStep } from "../types.js";

function quote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function certDir(): string {
  return join(homedir(), ".hasna", "machines", "certs");
}

export function buildCertPlan(domains: string[]): SetupResult {
  if (domains.length === 0) {
    throw new Error("At least one domain is required.");
  }

  const primary = domains[0]!;
  const certPath = join(certDir(), `${primary}.pem`);
  const keyPath = join(certDir(), `${primary}-key.pem`);
  const steps: SetupStep[] = [];

  if (platform() === "darwin") {
    steps.push({
      id: "mkcert-install-macos",
      title: "Install mkcert on macOS",
      command: "brew install mkcert nss",
      manager: "brew",
    });
  } else {
    steps.push({
      id: "mkcert-install-linux",
      title: "Install mkcert on Linux",
      command: "sudo apt-get update && sudo apt-get install -y mkcert libnss3-tools",
      manager: "apt",
      privileged: true,
    });
  }

  steps.push(
    {
      id: "mkcert-local-ca",
      title: "Install local mkcert CA",
      command: "mkcert -install",
      manager: "custom",
    },
    {
      id: "mkcert-issue",
      title: `Issue certificate for ${domains.join(", ")}`,
      command: `mkdir -p ${quote(certDir())} && mkcert -cert-file ${quote(certPath)} -key-file ${quote(keyPath)} ${domains.map((domain) => quote(domain)).join(" ")}`,
      manager: "custom",
    }
  );

  return {
    machineId: process.env["HASNA_MACHINES_MACHINE_ID"] || "local",
    mode: "plan",
    steps,
    executed: 0,
  };
}

export function runCertPlan(domains: string[], options: { apply?: boolean; yes?: boolean } = {}): SetupResult {
  const plan = buildCertPlan(domains);
  if (!options.apply) return plan;
  if (!options.yes) {
    throw new Error("Certificate generation requires --yes.");
  }

  let executed = 0;
  for (const step of plan.steps) {
    const result = Bun.spawnSync(["bash", "-lc", step.command], {
      stdout: "pipe",
      stderr: "pipe",
      env: process.env,
    });
    if (result.exitCode !== 0) {
      throw new Error(`Certificate step failed (${step.id}): ${result.stderr.toString().trim()}`);
    }
    executed += 1;
  }

  return {
    machineId: plan.machineId,
    mode: "apply",
    steps: plan.steps,
    executed,
  };
}
