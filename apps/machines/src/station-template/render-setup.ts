import { dirname } from "node:path";
import type { SetupStep } from "../types.js";
import { SWAP_HEADROOM_GB, type EffectiveTemplate, type LoadedTemplateFile } from "./schema.js";

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

  // The access floor comes FIRST, and never fatally: runSetupPlan aborts on
  // the first non-zero step, and reachability must not depend on any later
  // step succeeding (owner ruling 2026-07-29, station17). Physical layers
  // usually declare no floor service — their floor is an out-of-band path —
  // so this renders only where a layer opts in (ec2: the SSM agent).
  if (effective.accessFloor) {
    steps.push({
      id: "template-access-floor",
      title: `Ensure access floor ${effective.accessFloor.service} (never boot-critical)`,
      command: `( ${effective.accessFloor.ensure} ) || echo 'hasna-station: access-floor ensure failed for ${effective.accessFloor.service} (NON-FATAL) — drift check reports access-floor state' >&2`,
      manager: "custom",
      privileged: true,
    });
  }

  if (effective.packages.apt.length > 0) {
    steps.push({
      id: "template-apt-packages",
      title: `Install apt packages (${effective.packages.apt.length})`,
      command: `sudo apt-get update && sudo apt-get install -y ${effective.packages.apt.map(quote).join(" ")}`,
      manager: "apt",
      privileged: true,
    });
  }

  // Required binaries come BEFORE tailscale: the join step shells out to a
  // credential fetch, and on 2026-07-29 station17 ran that step with no aws on
  // PATH and silently stayed off the tailnet.
  for (const command of effective.commands) {
    steps.push({
      id: `template-command-${command.id}`,
      title: `Ensure ${command.command} is on PATH`,
      command: `command -v -- ${command.command} >/dev/null 2>&1 || sudo sh -c ${quote(command.install)}`,
      manager: "custom",
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
    // Convergent and never fatal — same shape as the cloud-init render.
    // station17 build 2 (2026-07-29): `test -f /swapfile ||` skipped a PARTIAL
    // 4.2G file that fallocate left behind at ENOSPC on an 8G root volume, so
    // the box kept a full disk and zero active swap forever. Guard on ACTIVE
    // swap, clean up stale files, and refuse to allocate without
    // SWAP_HEADROOM_GB of headroom beyond the swap itself.
    const size = `${effective.swap.sizeGb}G`;
    const requiredKb = (effective.swap.sizeGb + SWAP_HEADROOM_GB) * 1024 * 1024;
    steps.push({
      id: "template-swapfile",
      title: `Ensure ${size} swapfile is active (never boot-critical; requires ${effective.swap.sizeGb + SWAP_HEADROOM_GB}G free)`,
      command:
        "swapon --noheadings --show=NAME | grep -qx /swapfile || { sudo rm -f /swapfile; " +
        `if [ "$(df -kP / | awk 'NR==2{print $4}')" -ge ${requiredKb} ]; then ` +
        `sudo fallocate -l ${size} /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile && ` +
        "{ sudo grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null; }; " +
        `else echo 'hasna-station: swapfile skipped — less than ${effective.swap.sizeGb}G+${SWAP_HEADROOM_GB}G headroom free on / (NON-FATAL) — drift check reports swap:size and the disk floors' >&2; fi; } ` +
        "|| echo 'hasna-station: swapfile setup failed (NON-FATAL) — drift check reports swap:size' >&2",
      manager: "shell",
      privileged: true,
    });
  }

  if (effective.tailscale?.join) {
    // Owner ruling 2026-07-30: tailscale is a PHYSICAL-class concern only —
    // no shipped cloud layer declares it (asserted with a positive control in
    // station-template.test.ts), so this renders for dgx-spark and any future
    // physical overlay. Tailscale remains an access path, not a provisioning
    // dependency (owner ruling 2026-07-29). Both steps end non-fatally: runSetupPlan aborts the whole
    // setup on the first non-zero step, and a vault hiccup during the join
    // must not take the rest of the provisioning down with it. The failure is
    // warned loudly and reported by the drift check as tailscale:join — the
    // old shape (`...; rm -f`) already masked the exit code but did it
    // SILENTLY, which is worse than crashing.
    steps.push({
      id: "template-tailscale-install",
      title: "Install Tailscale if missing (never boot-critical)",
      command:
        "command -v tailscale >/dev/null 2>&1 || curl -fsSL https://tailscale.com/install.sh | sh || echo 'hasna-station: tailscale install failed (NON-FATAL) — drift check reports tailscale:join' >&2",
      manager: "custom",
      privileged: true,
    });
    const hostnameFlag = station && effective.tailscale.hostnameFromStation ? ` --hostname ${quote(station)}` : "";
    const sshFlag = effective.tailscale.ssh ? " --ssh" : "";
    // Secret NAME only; the value is pulled at runtime into a 0600 file and
    // referenced via file: so it never appears in argv or logs. The key file
    // is removed on both the success and the failure arm.
    steps.push({
      id: "template-tailscale-join",
      title: "Join tailnet if not already joined (auth key via secrets vault, name only; never boot-critical)",
      command:
        `tailscale status >/dev/null 2>&1 || ( umask 077 && secrets get ${quote(effective.tailscale.authKeySecretName)} | tr -d '\\r\\n' > /tmp/ts-authkey && ` +
        `sudo tailscale up --auth-key file:/tmp/ts-authkey${hostnameFlag}${sshFlag} && rm -f /tmp/ts-authkey ) || ` +
        `{ rm -f /tmp/ts-authkey; echo 'hasna-station: tailscale join failed (NON-FATAL) — the box stays reachable by its floor path; drift check reports tailscale:join' >&2; }`,
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
