import { dirname } from "node:path";
import type { SetupStep } from "../types.js";
import type { EffectiveTemplate, LoadedTemplateFile } from "./schema.js";

function quote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function isHomeTarget(target: string): boolean {
  return target.startsWith("~/");
}

function shellTarget(target: string): string {
  if (isHomeTarget(target)) return `"$HOME"/${quote(target.slice(2))}`;
  return quote(target);
}

function writeFileCommand(file: LoadedTemplateFile): string {
  const content = quote(file.content);
  if (isHomeTarget(file.target)) {
    const dir = dirname(file.target.slice(2));
    return `mkdir -p "$HOME"/${quote(dir)} && printf '%s' ${content} > ${shellTarget(file.target)} && chmod ${file.mode} ${shellTarget(file.target)}`;
  }
  return (
    `sudo mkdir -p ${quote(dirname(file.target))} && ` +
    `printf '%s' ${content} | sudo tee ${quote(file.target)} >/dev/null && ` +
    `sudo chmod ${file.mode} ${quote(file.target)}`
  );
}

/**
 * Render the effective station template into idempotent setup steps for a
 * PHYSICAL box (machines setup --template ...). The cloud render shares the
 * same source data — see render-cloud-init.ts.
 */
export function buildStationTemplateSteps(effective: EffectiveTemplate, options: { station?: string } = {}): SetupStep[] {
  const steps: SetupStep[] = [];
  const station = options.station;

  if (effective.packages.apt.length > 0) {
    steps.push({
      id: "template-apt-packages",
      title: `Install apt packages (${effective.packages.apt.length})`,
      command: `sudo apt-get update && sudo apt-get install -y ${effective.packages.apt.map(quote).join(" ")}`,
      manager: "apt",
      privileged: true,
    });
  }

  for (const file of effective.files) {
    steps.push({
      id: `template-file-${file.id}`,
      title: `Write ${file.target} (${file.kind})`,
      command: writeFileCommand(file),
      manager: "shell",
      privileged: !isHomeTarget(file.target),
    });
  }

  const hasSysctl = effective.files.some((file) => file.kind === "sysctl");
  if (hasSysctl) {
    steps.push({
      id: "template-sysctl-reload",
      title: "Apply sysctl settings",
      command: "sudo sysctl --system >/dev/null",
      manager: "shell",
      privileged: true,
    });
  }

  for (const file of effective.files.filter((candidate) => candidate.kind === "tmpfiles")) {
    steps.push({
      id: `template-tmpfiles-${file.id}`,
      title: `Apply tmpfiles rule ${file.target}`,
      command: `sudo systemd-tmpfiles --create ${quote(file.target)}`,
      manager: "shell",
      privileged: true,
    });
  }

  if (effective.files.some((file) => file.kind === "systemd-dropin")) {
    steps.push({
      id: "template-systemd-reload",
      title: "Reload systemd system manager",
      command: "sudo systemctl daemon-reload",
      manager: "shell",
      privileged: true,
    });
  }
  if (effective.files.some((file) => file.kind === "systemd-user-unit")) {
    steps.push({
      id: "template-systemd-user-reload",
      title: "Reload systemd user manager",
      command: "systemctl --user daemon-reload || true",
      manager: "shell",
    });
  }

  if (effective.swap.sizeGb > 0) {
    const size = `${effective.swap.sizeGb}G`;
    steps.push({
      id: "template-swapfile",
      title: `Ensure ${size} swapfile`,
      command:
        `test -f /swapfile || (sudo fallocate -l ${size} /swapfile && sudo chmod 600 /swapfile && ` +
        `sudo mkswap /swapfile && sudo swapon /swapfile && ` +
        `echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null)`,
      manager: "shell",
      privileged: true,
    });
  }

  if (effective.tailscale?.join) {
    steps.push({
      id: "template-tailscale-install",
      title: "Install Tailscale if missing",
      command: "command -v tailscale >/dev/null 2>&1 || curl -fsSL https://tailscale.com/install.sh | sh",
      manager: "custom",
      privileged: true,
    });
    const hostnameFlag = station && effective.tailscale.hostnameFromStation ? ` --hostname ${quote(station)}` : "";
    const sshFlag = effective.tailscale.ssh ? " --ssh" : "";
    // Secret NAME only; the value is pulled at runtime into a 0600 file and
    // referenced via file: so it never appears in argv or logs.
    steps.push({
      id: "template-tailscale-join",
      title: "Join tailnet if not already joined (auth key via secrets vault, name only)",
      command:
        `tailscale status >/dev/null 2>&1 || (umask 077 && TAILSCALE_AUTHKEY_FILE=$(mktemp) && ` +
        `trap 'rm -f "$TAILSCALE_AUTHKEY_FILE"' EXIT && secrets get ${quote(effective.tailscale.authKeySecretName)} | tr -d '\\r\\n' > "$TAILSCALE_AUTHKEY_FILE" && ` +
        `sudo tailscale up --auth-key file:"$TAILSCALE_AUTHKEY_FILE"${hostnameFlag}${sshFlag})`,
      manager: "custom",
      privileged: true,
    });
  }

  for (const service of effective.services) {
    const systemctl = service.scope === "user" ? "systemctl --user" : "sudo systemctl";
    if (service.expectEnabled || service.expectActive) {
      steps.push({
        id: `template-service-${service.name}`,
        title: `Enable and start ${service.name}`,
        command: `${systemctl} enable ${service.expectActive ? "--now " : ""}${quote(service.name)}`,
        manager: "shell",
        privileged: service.scope === "system",
      });
    }
  }

  if (effective.packages.bun.length > 0) {
    steps.push({
      id: "template-bun-packages",
      title: `Install hasna CLI set (${effective.packages.bun.length} bun globals)`,
      command: `bun install -g ${effective.packages.bun.map(quote).join(" ")}`,
      manager: "bun",
    });
  }

  if (effective.secretsBootstrap) {
    steps.push({
      id: "template-secrets-bootstrap",
      title: `Bootstrap station env from vault secret ${effective.secretsBootstrap.envSecretName} (name only${effective.secretsBootstrap.optional ? ", optional" : ""})`,
      command:
        `secrets get ${quote(effective.secretsBootstrap.envSecretName)} > "$HOME/.hasna/station.env" 2>/dev/null && chmod 600 "$HOME/.hasna/station.env"` +
        (effective.secretsBootstrap.optional ? " || true" : ""),
      manager: "custom",
    });
  }

  return steps;
}
