import type { EffectiveTemplate } from "./schema.js";

export interface CloudInitOptions {
  /** Station identity, e.g. station17 — becomes hostname and tailscale name. */
  station?: string;
  /** Login user provisioned on the instance. */
  user?: string;
}

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
    runcmd.push(
      `test -f /swapfile || (fallocate -l ${size} /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile && echo '/swapfile none swap sw 0 0' >> /etc/fstab)`
    );
  }
  for (const service of effective.services.filter((candidate) => candidate.scope === "system" && candidate.name !== "tailscaled")) {
    runcmd.push(`systemctl enable ${service.expectActive ? "--now " : ""}${service.name}`);
  }
  if (effective.tailscale?.join) {
    runcmd.push("command -v tailscale >/dev/null 2>&1 || curl -fsSL https://tailscale.com/install.sh | sh");
    const hostnameFlag = station && effective.tailscale.hostnameFromStation ? ` --hostname ${station}` : "";
    const sshFlag = effective.tailscale.ssh ? " --ssh" : "";
    runcmd.push(
      "TOKEN=$(curl -sX PUT http://169.254.169.254/latest/api/token -H 'X-aws-ec2-metadata-token-ttl-seconds: 300') && " +
        'REGION=$(curl -sH "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/placement/region) && ' +
        `umask 077 && aws secretsmanager get-secret-value --secret-id ${effective.tailscale.authKeySecretName} --query SecretString --output text --region "$REGION" | tr -d '\\r\\n' > /run/ts-authkey && ` +
        `tailscale up --auth-key file:/run/ts-authkey${hostnameFlag}${sshFlag}; rm -f /run/ts-authkey`
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
