import { getLocalMachineId } from "../db.js";
import { findManifestMachine, readManifestWithSource, type ManifestSourceAdapter } from "../manifests.js";
import { getDataDir } from "../paths.js";
import { redactIdentifier, redactManifestForDiagnostics, redactPath, redactSensitiveValue } from "../redaction.js";
import { runMachineCommand, type MachineCommandRunner } from "../remote.js";
import type { DoctorCheck, DoctorProbe, DoctorReport, FleetManifest, ManifestLoadInfo } from "../types.js";

export const DOCTOR_OPTIONAL_ADAPTER_DOMAINS = ["secrets", "configs", "monitor", "repos", "mcps", "shield"] as const;

export type DoctorOptionalAdapterDomain = typeof DOCTOR_OPTIONAL_ADAPTER_DOMAINS[number];

export interface DoctorAdapterContext {
  machineId: string;
  manifest: FleetManifest;
  manifestSource: ManifestLoadInfo;
  commandDetails: Record<string, string>;
  now: Date;
}

export type DoctorAdapterHook = (context: DoctorAdapterContext) => DoctorCheck | DoctorCheck[] | null | undefined;

export interface DoctorAdapter {
  id: string;
  checks?: Partial<Record<DoctorOptionalAdapterDomain, DoctorAdapterHook>>;
}

export interface DoctorOptions {
  now?: Date;
  manifestAdapter?: ManifestSourceAdapter | null;
  adapters?: DoctorAdapter[];
  includeOptionalAdapters?: boolean;
  commandRunner?: MachineCommandRunner;
}

function makeCheck(
  id: string,
  status: DoctorCheck["status"],
  summary: string,
  detail: string,
  extra: Partial<DoctorCheck> = {},
): DoctorCheck {
  const { data, ...rest } = extra;
  return {
    ...rest,
    id,
    status,
    summary,
    detail,
    data: data ? (redactSensitiveValue(data) as Record<string, unknown>) : undefined,
  };
}

function parseKeyValueOutput(stdout: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of stdout.trim().split("\n")) {
    const index = line.indexOf("=");
    if (index <= 0) continue;
    result[line.slice(0, index)] = line.slice(index + 1);
  }
  return result;
}

function buildDoctorCommand(): string {
  const defaultDataDir = getDataDir().replace(/'/g, `'\\''`);
  return [
    `data_dir="\${HASNA_MACHINES_DIR:-'${defaultDataDir}'}"`,
    'manifest_path="${HASNA_MACHINES_MANIFEST_PATH:-$data_dir/machines.json}"',
    'db_path="${HASNA_MACHINES_DB_PATH:-$data_dir/machines.db}"',
    'notifications_path="${HASNA_MACHINES_NOTIFICATIONS_PATH:-$data_dir/notifications.json}"',
    "printf 'data_dir=%s\\n' \"$data_dir\"",
    "printf 'manifest_path=%s\\n' \"$manifest_path\"",
    "printf 'db_path=%s\\n' \"$db_path\"",
    "printf 'notifications_path=%s\\n' \"$notifications_path\"",
    "printf 'data_dir_exists=%s\\n' \"$(test -d \"$data_dir\" && printf yes || printf no)\"",
    "printf 'manifest_exists=%s\\n' \"$(test -e \"$manifest_path\" && printf yes || printf no)\"",
    "printf 'db_exists=%s\\n' \"$(test -e \"$db_path\" && printf yes || printf no)\"",
    "printf 'notifications_exists=%s\\n' \"$(test -e \"$notifications_path\" && printf yes || printf no)\"",
    "printf 'bun=%s\\n' \"$(bun --version 2>/dev/null || printf missing)\"",
    "printf 'ssh=%s\\n' \"$(command -v ssh >/dev/null 2>&1 && printf ok || printf missing)\"",
    "printf 'machines=%s\\n' \"$(command -v machines 2>/dev/null || printf missing)\"",
    "printf 'machines_daemon=%s\\n' \"$(command -v machines-daemon 2>/dev/null || printf missing)\"",
    "printf 'machines_mcp=%s\\n' \"$(command -v machines-mcp 2>/dev/null || printf missing)\"",
    "printf 'sudo_noninteractive=%s\\n' \"$(sudo -n true >/dev/null 2>&1 && printf ok || printf unavailable)\"",
    "printf 'ssh_cert_support=%s\\n' \"$(ssh -Q key-cert 2>/dev/null | grep -q 'ssh-ed25519-cert-v01@openssh.com' && printf ok || printf unavailable)\"",
    "printf 'gh_cli=%s\\n' \"$(command -v gh 2>/dev/null || printf missing)\"",
    "printf 'gh_auth=%s\\n' \"$(gh auth status >/dev/null 2>&1 && printf ok || printf unavailable)\"",
    "printf 'github_app_ref=%s\\n' \"$(test -n \\\"${HASNA_GITHUB_APP_ID:-}\\\" -a -n \\\"${HASNA_GITHUB_APP_PRIVATE_KEY_REF:-}\\\" && printf configured || printf missing)\"",
    "printf 'probe_complete=yes\\n'",
  ].join("; ");
}

function unverifiedProbeDetail(probe: DoctorProbe): string {
  if (probe.reason === "timed_out") {
    return `Unverified: ${probe.source} machine probe timed out; remote state was not checked.`;
  }
  if (probe.reason === "incomplete_output") {
    return `Unverified: ${probe.source} machine probe returned incomplete output; remote state was not checked.`;
  }
  return `Unverified: ${probe.source} machine probe exited ${probe.exitCode}; remote state was not checked.`;
}

const PROBE_BOUND_CHECK_IDS = new Set([
  "data-dir",
  "manifest-path",
  "db-path",
  "notifications-path",
  "bun",
  "machines-cli",
  "machines-daemon-cli",
  "machines-mcp-cli",
  "ssh",
  "sudo-noninteractive",
  "ssh-cert-support",
  "github-app-auth",
]);

function makeUnverifiedProbeCheck(check: DoctorCheck, probe: DoctorProbe): DoctorCheck {
  return makeCheck(check.id, "warn", check.summary, unverifiedProbeDetail(probe), {
    data: {
      verified: false,
      attempted: probe.attempted,
      source: probe.source,
      exitCode: probe.exitCode,
      timedOut: probe.timedOut,
      reason: probe.reason,
    },
  });
}

export function doctorExitCode(report: DoctorReport): number {
  return report.probe?.verified === false ? 1 : 0;
}

function fallbackAdapterCheck(domain: DoctorOptionalAdapterDomain): DoctorCheck {
  return makeCheck(
    `${domain}-adapter`,
    "ok",
    `Optional ${domain} adapter`,
    `No ${domain} adapter configured; skipped optional private integration check.`,
    {
      optional: true,
      source: "machines",
      data: { configured: false, fallback: true },
    },
  );
}

function sanitizeAdapterCheck(check: DoctorCheck, domain: DoctorOptionalAdapterDomain, adapterId: string): DoctorCheck {
  const safeAdapterId = redactIdentifier(adapterId);
  return makeCheck(
    check.id.startsWith(`${domain}-`) || check.id.startsWith(`${domain}:`) ? check.id : `${domain}:${check.id}`,
    check.status,
    check.summary,
    String(redactSensitiveValue(check.detail)),
    {
      ...check,
      optional: check.optional ?? true,
      source: check.source ? String(redactSensitiveValue(check.source)) : `adapter:${safeAdapterId}`,
      data: check.data ? (redactSensitiveValue(check.data) as Record<string, unknown>) : undefined,
    },
  );
}

function runOptionalAdapterChecks(context: DoctorAdapterContext, adapters: DoctorAdapter[]): DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  for (const domain of DOCTOR_OPTIONAL_ADAPTER_DOMAINS) {
    const adapter = adapters.find((candidate) => candidate.checks?.[domain]);
    const hook = adapter?.checks?.[domain];
    if (!adapter || !hook) {
      checks.push(fallbackAdapterCheck(domain));
      continue;
    }

    try {
      const result = hook(context);
      const domainChecks = Array.isArray(result) ? result : result ? [result] : [fallbackAdapterCheck(domain)];
      checks.push(...domainChecks.map((check) => sanitizeAdapterCheck(check, domain, adapter.id)));
    } catch {
      const safeAdapterId = redactIdentifier(adapter.id);
      checks.push(makeCheck(
        `${domain}-adapter`,
        "warn",
        `Optional ${domain} adapter failed`,
        "Adapter failed; details are intentionally hidden to avoid leaking private refs or credentials.",
        {
          optional: true,
          source: `adapter:${safeAdapterId}`,
          data: { adapter: safeAdapterId, fallback: true },
        },
      ));
    }
  }
  return checks;
}

export function runDoctor(machineId?: string, options: DoctorOptions = {}): DoctorReport {
  const implicitLocalMachine = !machineId;
  const requestedMachineId = machineId ?? getLocalMachineId();
  const reportedMachineId = implicitLocalMachine ? "local" : requestedMachineId;
  const now = options.now ?? new Date();
  const { manifest, info: manifestSource } = readManifestWithSource({ adapter: options.manifestAdapter ?? null });
  const commandChecks = (options.commandRunner ?? runMachineCommand)(requestedMachineId, buildDoctorCommand());
  const details = parseKeyValueOutput(commandChecks.stdout);
  const probeReason: DoctorProbe["reason"] = commandChecks.timedOut
    ? "timed_out"
    : commandChecks.exitCode !== 0
      ? "command_failed"
      : details["probe_complete"] === "yes"
        ? "completed"
        : "incomplete_output";
  const probe: DoctorProbe = {
    attempted: true,
    verified: probeReason === "completed",
    source: commandChecks.source,
    exitCode: commandChecks.exitCode,
    timedOut: commandChecks.timedOut === true,
    reason: probeReason,
  };
  const machineInManifest = findManifestMachine(manifest, requestedMachineId);
  const diagnosticMachine = machineInManifest ? redactManifestForDiagnostics(machineInManifest) : null;
  if (implicitLocalMachine && diagnosticMachine) diagnosticMachine.id = reportedMachineId;
  const optionalAdapterChecks = options.includeOptionalAdapters === false
    ? []
    : runOptionalAdapterChecks({
        machineId: requestedMachineId,
        manifest,
        manifestSource,
        commandDetails: details,
        now,
      }, options.adapters ?? []);

  const collectedChecks: DoctorCheck[] = [
    makeCheck(
      "manifest-source",
      manifestSource.warnings.length > 0 ? "warn" : "ok",
      "Manifest source boundary",
      `${manifestSource.source.kind}:${manifestSource.source.ref} loaded from ${manifestSource.loadedFrom}`,
      {
        data: {
          source: manifestSource.source,
          loadedFrom: manifestSource.loadedFrom,
          fallbackSource: manifestSource.fallbackSource,
          warnings: manifestSource.warnings,
        },
        remediation: manifestSource.warnings.length > 0
          ? ["Provide a private manifest adapter or unset the private manifest ref to use the local manifest only."]
          : undefined,
      },
    ),
    makeCheck(
      "manifest-entry",
      machineInManifest ? "ok" : "warn",
      machineInManifest ? "Machine exists in manifest" : "Machine missing from manifest",
      diagnosticMachine ? JSON.stringify(diagnosticMachine) : `No manifest entry for ${reportedMachineId}`,
      {
        data: {
          declared: Boolean(machineInManifest),
          machine: diagnosticMachine,
        },
      },
    ),
    makeCheck(
      "command-probe",
      probe.verified ? "ok" : "warn",
      "Machine command probe",
      probe.verified
        ? `${probe.source} machine probe completed and its output was verified.`
        : unverifiedProbeDetail(probe),
      { data: { ...probe } },
    ),
    makeCheck(
      "data-dir",
      details["data_dir_exists"] === "yes" ? "ok" : "warn",
      "Data directory check",
      `${redactPath(details["data_dir"] || "unknown")} ${details["data_dir_exists"] === "yes" ? "exists" : "missing"}`,
      {
        data: {
          path: redactPath(details["data_dir"] || "unknown"),
          exists: details["data_dir_exists"] === "yes",
        },
      },
    ),
    makeCheck(
      "manifest-path",
      details["manifest_exists"] === "yes" ? "ok" : "warn",
      "Manifest path check",
      `${redactPath(details["manifest_path"] || "unknown")} ${details["manifest_exists"] === "yes" ? "exists" : "missing"}`,
      {
        data: {
          path: redactPath(details["manifest_path"] || "unknown"),
          exists: details["manifest_exists"] === "yes",
        },
      },
    ),
    makeCheck(
      "db-path",
      details["db_exists"] === "yes" ? "ok" : "warn",
      "DB path check",
      `${redactPath(details["db_path"] || "unknown")} ${details["db_exists"] === "yes" ? "exists" : "missing"}`,
      {
        data: {
          path: redactPath(details["db_path"] || "unknown"),
          exists: details["db_exists"] === "yes",
        },
      },
    ),
    makeCheck(
      "notifications-path",
      details["notifications_exists"] === "yes" ? "ok" : "warn",
      "Notifications path check",
      `${redactPath(details["notifications_path"] || "unknown")} ${details["notifications_exists"] === "yes" ? "exists" : "missing"}`,
      {
        data: {
          path: redactPath(details["notifications_path"] || "unknown"),
          exists: details["notifications_exists"] === "yes",
        },
      },
    ),
    makeCheck(
      "bun",
      details["bun"] && details["bun"] !== "missing" ? "ok" : "fail",
      "Bun availability",
      details["bun"] || "missing"
    ),
    makeCheck(
      "machines-cli",
      details["machines"] && details["machines"] !== "missing" ? "ok" : "warn",
      "machines CLI availability",
      details["machines"] || "missing"
    ),
    makeCheck(
      "machines-daemon-cli",
      details["machines_daemon"] && details["machines_daemon"] !== "missing" ? "ok" : "warn",
      "machines-daemon availability",
      details["machines_daemon"] || "missing"
    ),
    makeCheck(
      "machines-mcp-cli",
      details["machines_mcp"] && details["machines_mcp"] !== "missing" ? "ok" : "warn",
      "machines-mcp availability",
      details["machines_mcp"] || "missing"
    ),
    makeCheck(
      "ssh",
      details["ssh"] === "ok" ? "ok" : "warn",
      "SSH availability",
      details["ssh"] || "missing"
    ),
    makeCheck(
      "sudo-noninteractive",
      details["sudo_noninteractive"] === "ok" ? "ok" : "warn",
      "Noninteractive sudo availability",
      details["sudo_noninteractive"] === "ok"
        ? "sudo -n is available"
        : "sudo -n unavailable; setup may require user-provided approval or password handling.",
      {
        data: { available: details["sudo_noninteractive"] === "ok" },
        remediation: details["sudo_noninteractive"] === "ok"
          ? undefined
          : ["Configure explicit sudo policy or run setup commands manually; do not store sudo passwords in public manifests."],
      },
    ),
    makeCheck(
      "ssh-cert-support",
      details["ssh_cert_support"] === "ok" ? "ok" : "warn",
      "SSH certificate support",
      details["ssh_cert_support"] === "ok"
        ? "OpenSSH reports ed25519 certificate support"
        : "OpenSSH certificate support not detected.",
      {
        data: { supported: details["ssh_cert_support"] === "ok" },
        remediation: details["ssh_cert_support"] === "ok"
          ? undefined
          : ["Install or update OpenSSH before adopting SSH certificate auth for this machine."],
      },
    ),
    makeCheck(
      "github-app-auth",
      details["github_app_ref"] === "configured" ? "ok" : "warn",
      "GitHub App auth references",
      details["github_app_ref"] === "configured"
        ? "GitHub App id and private-key reference are configured"
        : "GitHub App id/private-key reference missing; use secret references, not user tokens or raw private keys.",
      {
        data: {
          gh_cli: details["gh_cli"] && details["gh_cli"] !== "missing",
          gh_auth: details["gh_auth"] === "ok",
          app_ref_configured: details["github_app_ref"] === "configured",
        },
        remediation: details["github_app_ref"] === "configured"
          ? undefined
          : ["Set HASNA_GITHUB_APP_ID plus HASNA_GITHUB_APP_PRIVATE_KEY_REF or provide an equivalent secrets adapter."],
      },
    ),
    ...optionalAdapterChecks,
  ];
  const checks = collectedChecks.map((check) =>
    probe.verified || !PROBE_BOUND_CHECK_IDS.has(check.id)
      ? check
      : makeUnverifiedProbeCheck(check, probe)
  );

  return {
    machineId: reportedMachineId,
    source: commandChecks.source,
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    probe,
    manifestSource,
    manifestPath: details["manifest_path"] ? redactPath(details["manifest_path"]) : undefined,
    dbPath: details["db_path"] ? redactPath(details["db_path"]) : undefined,
    notificationsPath: details["notifications_path"] ? redactPath(details["notifications_path"]) : undefined,
    checks,
  };
}
