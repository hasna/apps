import type { EffectiveTemplate } from "./schema.js";

export interface CloudInitOptions {
  /** Station identity, e.g. station17 — becomes hostname and tailscale name. */
  station?: string;
  /** Login user provisioned on the instance. */
  user?: string;
}

/**
 * Free space that must remain on / AFTER the swapfile is allocated, in GiB.
 * 2 GiB covers what the rest of a station boot writes (apt packages, bun +
 * global CLIs, the tailscale install, cloud-init logs) with margin; on
 * station17's 8 GiB AMI-default root volume it correctly refuses the 8G
 * swapfile instead of filling the disk. Keep in sync with render-setup.ts.
 */
const SWAP_HEADROOM_GB = 2;

function yamlQuote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function b64(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

/**
 * Render the effective station template as cloud-init user-data for an EC2
 * station. Same source data as the physical render — the whole point of the
 * template is one source, two serializations (station contract §8.3).
 *
 * Secret NAMES are rendered; values are pulled at boot from AWS Secrets
 * Manager via the instance role and passed by file:, never argv.
 */
export function renderCloudInit(effective: EffectiveTemplate, options: CloudInitOptions = {}): string {
  const user = options.user ?? "hasna";
  const station = options.station;
  const home = `/home/${user}`;
  const lines: string[] = [];

  lines.push("#cloud-config");
  lines.push(`# hasna.station_template.v1 name=${effective.name} version=${effective.version} layers=${effective.layers.join("+")}`);
  if (station) {
    lines.push(`hostname: ${station}`);
    lines.push("preserve_hostname: false");
  }
  lines.push("package_update: true");
  lines.push("package_upgrade: false");

  lines.push("users:");
  lines.push("  - default");
  lines.push(`  - name: ${user}`);
  lines.push("    groups: [adm, sudo]");
  lines.push("    shell: /bin/bash");
  lines.push(`    sudo: ${yamlQuote("ALL=(ALL) NOPASSWD:ALL")}`);

  if (effective.packages.apt.length > 0) {
    lines.push("packages:");
    for (const pkg of effective.packages.apt) lines.push(`  - ${pkg}`);
  }

  if (effective.files.length > 0) {
    lines.push("write_files:");
    for (const file of effective.files) {
      const homeRelative = file.target.startsWith("~/");
      const path = homeRelative ? `${home}/${file.target.slice(2)}` : file.target;
      lines.push(`  - path: ${path}`);
      lines.push(`    permissions: ${yamlQuote(file.mode)}`);
      if (homeRelative) {
        lines.push(`    owner: ${user}:${user}`);
        lines.push("    defer: true");
      }
      lines.push("    encoding: b64");
      lines.push(`    content: ${b64(file.content)}`);
    }
  }

  const runcmd: string[] = [];
  // The access floor comes FIRST, and never fatally. Owner ruling 2026-07-29
  // (station17): nothing that requires fetching a secret at boot may sit on
  // the critical path to a machine's reachability. The floor (EC2: the SSM
  // agent, preseeded in the Ubuntu AMI and authorized purely by the instance
  // profile) is what keeps a station recoverable when everything below —
  // including the tailscale join — fails; this entry asserts/repairs it before
  // anything else gets a chance to go wrong.
  if (effective.accessFloor) {
    runcmd.push(
      `( ${effective.accessFloor.ensure} ) || echo 'hasna-station: access-floor ensure failed for ${effective.accessFloor.service} (NON-FATAL) — drift check reports access-floor state' >&2`
    );
  }
  // Required binaries next: the tailscale join below fetches the auth key with
  // `aws secretsmanager`, and on station17 (2026-07-29) that ran with no aws on
  // PATH — the join failed and the box never reached the tailnet. A failed
  // install degrades to a drift report (command:<id>), never a dead boot.
  for (const command of effective.commands) {
    runcmd.push(
      `command -v -- ${command.command} >/dev/null 2>&1 || sh -c '${command.install.replace(/'/g, `'\\''`)}' || echo 'hasna-station: install of required command ${command.command} failed (NON-FATAL) — drift check reports command:${command.id}' >&2`
    );
  }
  if (effective.files.some((file) => file.kind === "sysctl")) {
    runcmd.push("sysctl --system");
  }
  for (const file of effective.files.filter((candidate) => candidate.kind === "tmpfiles")) {
    const path = file.target.startsWith("~/") ? `${home}/${file.target.slice(2)}` : file.target;
    runcmd.push(`systemd-tmpfiles --create ${path}`);
  }
  if (effective.files.some((file) => file.kind === "systemd-dropin")) {
    runcmd.push("systemctl daemon-reload");
  }
  if (effective.swap.sizeGb > 0) {
    const size = `${effective.swap.sizeGb}G`;
    // Swap is a memory-pressure backstop, never boot-critical (station17,
    // 2026-07-29: an unguarded 8G fallocate on an 8 GiB root volume filled the
    // disk at boot; every later runcmd entry died ENOSPC and cloud-final
    // failed). Allocate only when / has room for the swapfile PLUS working
    // headroom — the rest of this boot (apt, bun globals, tailscale, logs)
    // still needs the disk. Any shortfall or failure degrades to a drift
    // report (swap:size), never a dead boot, and the failure arm removes a
    // partial swapfile so a mid-allocation ENOSPC cannot fill the disk anyway.
    const requiredKb = (effective.swap.sizeGb + SWAP_HEADROOM_GB) * 1024 * 1024;
    runcmd.push(
      `test -f /swapfile || ( [ "$(df -Pk / | awk 'NR==2{print $4}')" -ge ${requiredKb} ] && fallocate -l ${size} /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile && echo '/swapfile none swap sw 0 0' >> /etc/fstab ) || { rm -f /swapfile; echo 'hasna-station: ${size} swapfile not allocated — needs ${size} + ${SWAP_HEADROOM_GB}G free on / (NON-FATAL) — drift check reports swap:size' >&2; }`
    );
  }
  for (const service of effective.services.filter((candidate) => candidate.scope === "system" && candidate.name !== "tailscaled")) {
    runcmd.push(`systemctl enable ${service.expectActive ? "--now " : ""}${service.name}`);
  }
  if (effective.tailscale?.join) {
    // Tailscale is an access path, not a boot dependency (owner ruling
    // 2026-07-29). Both entries end non-fatally: a failed install or join
    // leaves a reachable, debuggable station whose drift check reports
    // tailscale:join — never a stranded one, and never a silent one (the
    // warning lands in the cloud-init log).
    runcmd.push(
      "command -v tailscale >/dev/null 2>&1 || curl -fsSL https://tailscale.com/install.sh | sh || echo 'hasna-station: tailscale install failed (NON-FATAL) — station stays reachable via its access floor; drift check reports tailscale:join' >&2"
    );
    const hostnameFlag = station && effective.tailscale.hostnameFromStation ? ` --hostname ${station}` : "";
    const sshFlag = effective.tailscale.ssh ? " --ssh" : "";
    // The subshell both bounds the failure (a broken && chain can only reach
    // the || warning, even under `sh -e`) and scopes `umask 077`, which
    // previously leaked into every later runcmd entry.
    runcmd.push(
      "( TOKEN=$(curl -sX PUT http://169.254.169.254/latest/api/token -H 'X-aws-ec2-metadata-token-ttl-seconds: 300') && " +
        'REGION=$(curl -sH "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/placement/region) && ' +
        `umask 077 && aws secretsmanager get-secret-value --secret-id ${effective.tailscale.authKeySecretName} --query SecretString --output text --region "$REGION" | tr -d '\\r\\n' > /run/ts-authkey && ` +
        `tailscale up --auth-key file:/run/ts-authkey${hostnameFlag}${sshFlag} ) || echo 'hasna-station: tailscale join failed (NON-FATAL) — station stays reachable via its access floor; drift check reports tailscale:join' >&2; rm -f /run/ts-authkey`
    );
  }
  runcmd.push(`loginctl enable-linger ${user}`);
  if (effective.files.some((file) => file.kind === "systemd-user-unit")) {
    runcmd.push(
      `runuser -l ${user} -c 'XDG_RUNTIME_DIR=/run/user/$(id -u) systemctl --user daemon-reload' || true`
    );
  }
  runcmd.push(`runuser -l ${user} -c 'command -v bun >/dev/null 2>&1 || curl -fsSL https://bun.sh/install | bash'`);
  if (effective.packages.bun.length > 0) {
    runcmd.push(
      `runuser -l ${user} -c 'export PATH="$HOME/.bun/bin:$PATH"; bun install -g ${effective.packages.bun.join(" ")}'`
    );
  }
  if (effective.secretsBootstrap) {
    // Optional on first boot: the secrets CLI needs its own auth before this works.
    runcmd.push(
      `runuser -l ${user} -c 'mkdir -p ~/.hasna && (command -v secrets >/dev/null 2>&1 && umask 077 && secrets get ${effective.secretsBootstrap.envSecretName} > ~/.hasna/station.env) || true'`
    );
  }
  runcmd.push(
    `mkdir -p ${home}/.hasna/machines && printf '%s' '{"template":"${effective.name}","version":"${effective.version}","layers":"${effective.layers.join(",")}","renderedFor":"${station ?? "unknown"}","appliedBy":"cloud-init"}' > ${home}/.hasna/machines/template-state.json && chown -R ${user}:${user} ${home}/.hasna`
  );

  lines.push("runcmd:");
  for (const cmd of runcmd) {
    lines.push(`  - ${yamlQuote(cmd)}`);
  }
  lines.push("");
  return lines.join("\n");
}
