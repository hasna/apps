import { getLocalMachineId } from "../db.js";
import { readManifest } from "../manifests.js";
import { runMachineCommand } from "../remote.js";
import type { DoctorCheck, DoctorReport } from "../types.js";

function makeCheck(id: string, status: DoctorCheck["status"], summary: string, detail: string): DoctorCheck {
  return { id, status, summary, detail };
}

function parseKeyValueOutput(stdout: string): Record<string, string> {
  return Object.fromEntries(
    stdout
      .trim()
      .split("\n")
      .map((line) => line.split("="))
      .filter((parts) => parts.length === 2)
      .map(([key, value]) => [key, value])
  ) as Record<string, string>;
}

function buildDoctorCommand(): string {
  return [
    'data_dir="${HASNA_MACHINES_DIR:-$HOME/.hasna/machines}"',
    'manifest_path="${HASNA_MACHINES_MANIFEST_PATH:-$data_dir/machines.json}"',
    'db_path="${HASNA_MACHINES_DB_PATH:-$data_dir/machines.db}"',
    'notifications_path="${HASNA_MACHINES_NOTIFICATIONS_PATH:-$data_dir/notifications.json}"',
    "printf 'manifest_path=%s\\n' \"$manifest_path\"",
    "printf 'db_path=%s\\n' \"$db_path\"",
    "printf 'notifications_path=%s\\n' \"$notifications_path\"",
    "printf 'manifest_exists=%s\\n' \"$(test -e \"$manifest_path\" && printf yes || printf no)\"",
    "printf 'db_exists=%s\\n' \"$(test -e \"$db_path\" && printf yes || printf no)\"",
    "printf 'notifications_exists=%s\\n' \"$(test -e \"$notifications_path\" && printf yes || printf no)\"",
    "printf 'bun=%s\\n' \"$(bun --version 2>/dev/null || printf missing)\"",
    "printf 'ssh=%s\\n' \"$(command -v ssh >/dev/null 2>&1 && printf ok || printf missing)\"",
    "printf 'machines=%s\\n' \"$(command -v machines 2>/dev/null || printf missing)\"",
    "printf 'machines_agent=%s\\n' \"$(command -v machines-agent 2>/dev/null || printf missing)\"",
    "printf 'machines_mcp=%s\\n' \"$(command -v machines-mcp 2>/dev/null || printf missing)\"",
  ].join("; ");
}

export function runDoctor(machineId = getLocalMachineId()): DoctorReport {
  const manifest = readManifest();
  const commandChecks = runMachineCommand(machineId, buildDoctorCommand());
  const details = parseKeyValueOutput(commandChecks.stdout);
  const machineInManifest = manifest.machines.find((machine) => machine.id === machineId);

  const checks: DoctorCheck[] = [
    makeCheck(
      "manifest-entry",
      machineInManifest ? "ok" : "warn",
      machineInManifest ? "Machine exists in manifest" : "Machine missing from manifest",
      machineInManifest ? JSON.stringify(machineInManifest) : `No manifest entry for ${machineId}`
    ),
    makeCheck(
      "manifest-path",
      details["manifest_exists"] === "yes" ? "ok" : "warn",
      "Manifest path check",
      `${details["manifest_path"] || "unknown"} ${details["manifest_exists"] === "yes" ? "exists" : "missing"}`
    ),
    makeCheck(
      "db-path",
      details["db_exists"] === "yes" ? "ok" : "warn",
      "DB path check",
      `${details["db_path"] || "unknown"} ${details["db_exists"] === "yes" ? "exists" : "missing"}`
    ),
    makeCheck(
      "notifications-path",
      details["notifications_exists"] === "yes" ? "ok" : "warn",
      "Notifications path check",
      `${details["notifications_path"] || "unknown"} ${details["notifications_exists"] === "yes" ? "exists" : "missing"}`
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
      "machines-agent-cli",
      details["machines_agent"] && details["machines_agent"] !== "missing" ? "ok" : "warn",
      "machines-agent availability",
      details["machines_agent"] || "missing"
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
  ];

  return {
    machineId,
    source: commandChecks.source,
    manifestPath: details["manifest_path"],
    dbPath: details["db_path"],
    notificationsPath: details["notifications_path"],
    checks,
  };
}
