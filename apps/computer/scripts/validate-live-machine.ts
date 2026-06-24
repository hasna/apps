#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  acquireRuntimeLease,
  createWorkflowRun,
  recordPolicyDecision,
  releaseRuntimeLease,
  transitionWorkflowRun,
  type RuntimeLease,
  type WorkflowRun,
} from "../src/agent/runtime.js";
import { routePlannerTool } from "../src/agent/capability-router.js";
import { listAuditEvents } from "../src/db/index.js";
import { getHeadlessStatus } from "../src/drivers/mac/headless.js";
import { VERSION } from "../src/version.js";

type CheckStatus = "passed" | "failed" | "skipped" | "timed_out";

export type CommandCheck = {
  id: string;
  status: CheckStatus;
  summary: string;
  command?: string;
  cwd?: string;
  exit_code?: number | null;
  duration_ms?: number;
  stdout_tail?: string;
  stderr_tail?: string;
  data?: Record<string, unknown>;
};

type Artifact = {
  kind: string;
  status?: CheckStatus;
  path?: string;
  remote_path?: string;
  sha256?: string;
  bytes?: number;
  width?: number;
  height?: number;
  error?: string;
  redacted?: boolean;
};

type ValidationLease = {
  run: WorkflowRun | null;
  lease: RuntimeLease | null;
  check: CommandCheck;
};

type ValidationRouteProof = {
  allowed: boolean;
  check: CommandCheck;
};

const SAFE_ACTION_TYPES = new Set([
  "screen_size",
  "screenshot_hash",
  "open_local_fixture",
  "scroll_local_fixture",
  "query_browser_extension_status",
  "cleanup_test_tab",
  "open_empty_ghostty",
  "close_empty_ghostty",
]);
const CLEANUP_ACTION_TYPES = new Set(["cleanup_test_tab", "close_empty_ghostty", "close_fixture_tab"]);
const FIXTURE_LOOPBACK_PORTS = new Set(["", "8802"]);
const SAFE_ACTION_ALLOWED_KEYS: Record<string, Set<string>> = {
  screen_size: new Set(["type", "width", "height"]),
  screenshot_hash: new Set(["type", "sha256", "bytes", "width", "height"]),
  open_local_fixture: new Set(["type", "url", "fixture_id", "fixture_sha256"]),
  scroll_local_fixture: new Set(["type", "deltaX", "deltaY"]),
  query_browser_extension_status: new Set(["type"]),
  cleanup_test_tab: new Set(["type"]),
  open_empty_ghostty: new Set(["type"]),
  close_empty_ghostty: new Set(["type"]),
  close_fixture_tab: new Set(["type"]),
};
const DANGEROUS_SAMPLER_KEYS = /command|commands|payment|credential|password|secret|token|cookie|clipboard|path|file|url_override/i;

type ValidationReport = {
  schema_version: "open-computer.live-machine-validation.v1";
  generated_at: string;
  workspace_root: string;
  environment: {
    platform: NodeJS.Platform;
    arch: string;
    bun: string;
    node: string;
  };
  contract: {
    mode: "source_checkout_lab_only";
    production_allowed: false;
    remote_probe_authority: "fleet_route_lab_policy";
  };
  options: {
    machine_id: string | null;
    timeout_ms: number;
    browser_server: string;
    allow_failures: boolean;
    remote_validation_approved: boolean;
    lab_only_remote_validation: boolean;
    evidence: {
      installed_package_smoke: string | null;
      safe_action_sampler: string | null;
      visual_review: string | null;
    };
  };
  selected_machine: {
    machine_id: string | null;
    machine_alias: string | null;
    source: "argument" | "topology" | "none";
    redacted: boolean;
  };
  checks: CommandCheck[];
  artifacts: Artifact[];
  readiness: {
    ready: boolean;
    lab_ready: boolean;
    live_smoke_ready: boolean;
    p8_complete: boolean;
    blockers: string[];
    pending_evidence: string[];
    next_actions: string[];
  };
};

type CliOptions = {
  machineId: string | null;
  timeoutMs: number;
  browserServer: string;
  writePath: string;
  markdownPath: string | null;
  installedPackageSmokePath: string | null;
  samplerResultPath: string | null;
  visualReviewPath: string | null;
  allowFailures: boolean;
  skipRemote: boolean;
  remoteValidationApproved: boolean;
  labOnlyRemoteValidation: boolean;
};

export type EvidenceKind = "installed-package-smoke" | "safe-action-sampler-result" | "visual-regression-review";

type RunResult = {
  command: string[];
  commandText: string;
  cwd: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  timedOut: boolean;
};

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const COMPUTER_ROOT = resolve(SCRIPT_DIR, "..");
const WORKSPACE_ROOT = resolve(COMPUTER_ROOT, "..");
const MACHINES_ROOT = resolve(WORKSPACE_ROOT, "open-machines");
const OPEN_BROWSER_ROOT = resolve(WORKSPACE_ROOT, "open-browser");
const OUTPUT_TAIL_BYTES = 6_000;
const DEFAULT_BROWSER_SERVER = "http://127.0.0.1:8802";
const REMOTE_COMMAND_KILL_GRACE_MS = 1_000;
const REMOTE_COMMAND_WRAPPER_OVERHEAD_MS = 3_000;

const REMOTE_CAPABILITY_COMMAND = [
  'printf "os=%s\\n" "$(uname -s)"',
  'printf "macos_version=%s\\n" "$(sw_vers -productVersion 2>/dev/null || printf unavailable)"',
  'for tool in screencapture osascript open cliclick; do if command -v "$tool" >/dev/null 2>&1; then printf "%s=present\\n" "$tool"; else printf "%s=missing\\n" "$tool"; fi; done',
  'if pgrep -x "Google Chrome" >/dev/null 2>&1; then printf "chrome=running\\n"; elif [ -d "/Applications/Google Chrome.app" ]; then printf "chrome=installed\\n"; else printf "chrome=missing\\n"; fi',
  'if pgrep -x "Safari" >/dev/null 2>&1; then printf "safari=running\\n"; elif [ -d "/Applications/Safari.app" ] || [ -d "/System/Volumes/Preboot/Cryptexes/App/System/Applications/Safari.app" ]; then printf "safari=installed\\n"; else printf "safari=missing\\n"; fi',
].join("\n");

const REMOTE_SCREENSHOT_COMMAND = [
  'out="/tmp/occtrl-live-machine-validation-screen.png"',
  'err="/tmp/occtrl-live-machine-validation-screencapture.err"',
  'rm -f "$out" "$err"',
  'trap \'rm -f "$out" "$err"\' EXIT',
  'if screencapture -x -t png "$out" 2>"$err"; then',
  '  bytes="$(wc -c < "$out" | tr -d " ")"',
  '  sha="$(shasum -a 256 "$out" | awk \'{print $1}\')"',
  '  width="$(sips -g pixelWidth "$out" 2>/dev/null | awk \'/pixelWidth/ {print $2}\')"',
  '  height="$(sips -g pixelHeight "$out" 2>/dev/null | awk \'/pixelHeight/ {print $2}\')"',
  '  printf "screenshot=ok\\nremote_path=%s\\nsha256=%s\\nbytes=%s\\nwidth=%s\\nheight=%s\\n" "$out" "$sha" "$bytes" "$width" "$height"',
  "else",
  '  code="$?"',
  '  message="$(cat "$err" 2>/dev/null | tr "\\n" " " | cut -c1-240)"',
  '  printf "screenshot=failed\\nexit_code=%s\\nerror=%s\\n" "$code" "$message"',
  '  exit "$code"',
  "fi",
].join("\n");

const REMOTE_CHROME_QUERY_COMMAND = [
  'if ! pgrep -x "Google Chrome" >/dev/null 2>&1; then',
  '  printf "chrome_window=not_running\\n"',
  "  exit 1",
  "fi",
  "/usr/bin/osascript <<'APPLESCRIPT'",
  'tell application "System Events"',
  '  if exists process "Google Chrome" then',
  '    tell process "Google Chrome"',
  "      if (count of windows) > 0 then",
  '        return "chrome_window=present"',
  "      else",
  '        return "chrome_window=missing"',
  "      end if",
  "    end tell",
  "  else",
  '    return "chrome_window=not_running"',
  "  end if",
  "end tell",
  "APPLESCRIPT",
].join("\n");

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const checks: CommandCheck[] = [];
  const artifacts: Artifact[] = [];

  const localStatus = await getHeadlessStatus();
  checks.push({
    id: "local-headless-status",
    status: "passed",
    summary: localStatus.recommendation,
    data: {
      display: localStatus.display,
      screen_sharing: localStatus.screenSharing,
      lume: localStatus.lume,
      platform: platform(),
    },
  });

  const topology = await runOpenMachinesJson("topology", ["topology", "--json"], options.timeoutMs);
  checks.push(commandCheckFromRun("machines-topology", topology, topology.exitCode === 0 ? "Fleet topology query succeeded." : "Fleet topology query failed."));

  const selected = selectMachine(options.machineId, topology);
  if (!selected.machineId) {
    checks.push({
      id: "machine-selection",
      status: "failed",
      summary: "No target machine was provided and no reachable macOS machine could be selected from topology.",
    });
  } else {
    checks.push({
      id: "machine-selection",
      status: "passed",
      summary: `Selected ${machineAlias(selected.machineId)} from ${selected.source}.`,
      data: { machine_id: machineAlias(selected.machineId), source: selected.source },
    });
  }

  if (!selected.machineId || options.skipRemote || !options.remoteValidationApproved) {
    checks.push({
      id: "remote-validation",
      status: "skipped",
      summary: options.skipRemote
        ? "Remote validation skipped by --skip-remote."
        : !selected.machineId
          ? "Remote validation skipped because no machine was selected."
          : "Remote validation skipped because --approve-remote-validation was not provided.",
    });
  } else if (!options.labOnlyRemoteValidation) {
    checks.push({
      id: "remote-validation-contract",
      status: "failed",
      summary: "Remote validation requires --lab-only-remote-validation or OCCTRL_LAB_ONLY_REMOTE_VALIDATION=1; source-checkout probes are lab-only and cannot run with only --approve-remote-validation.",
      data: { required: "lab_only_remote_validation" },
    });
  } else {
    const lease = acquireFleetMachineValidationLease(selected.machineId, options.timeoutMs);
    checks.push(lease.check);
    if (lease.lease && lease.run) {
      try {
        const route = await authorizeLiveMachineValidationRoute(selected.machineId, options, lease.run);
        checks.push(route.check);
        if (route.allowed) {
          await runMachineChecks(selected.machineId, options, checks, artifacts);
        } else {
          checks.push({
            id: "remote-validation",
            status: "skipped",
            summary: "Remote validation skipped because fleet route authorization did not allow lab remote probes.",
          });
        }
      } finally {
        checks.push(releaseFleetMachineValidationLease(lease.lease, lease.run));
      }
    } else {
      checks.push({
        id: "remote-validation",
        status: "skipped",
        summary: "Remote validation skipped because the fleet_machine lease could not be acquired.",
      });
    }
  }

  const extensionCheck = await checkBrowserExtensionStatus(options.browserServer, options.timeoutMs, selected.machineId);
  checks.push(extensionCheck);

  checks.push({
    id: "safe-action-sampler-plan",
    status: "skipped",
    summary: "Random safe action sampler is gated until screenshot and GUI/browser readiness checks pass.",
    data: {
      allowed_actions: [
        "screen_size",
        "screenshot_hash",
        "open_local_fixture",
        "scroll_local_fixture",
        "query_browser_extension_status",
        "cleanup_test_tab",
      ],
      denied_actions: ["external_sites", "password_entry", "payments", "destructive_shell_commands", "arbitrary_clipboard_dump"],
    },
  });
  appendEvidenceChecks(options, checks, artifacts);

  const readiness = summarizeReadiness(checks);
  const report: ValidationReport = {
    schema_version: "open-computer.live-machine-validation.v1",
    generated_at: new Date().toISOString(),
    workspace_root: redactText(WORKSPACE_ROOT),
    environment: {
      platform: process.platform,
      arch: process.arch,
      bun: Bun.version,
      node: process.version,
    },
    contract: {
      mode: "source_checkout_lab_only",
      production_allowed: false,
      remote_probe_authority: "fleet_route_lab_policy",
    },
    options: {
      machine_id: machineAlias(options.machineId),
      timeout_ms: options.timeoutMs,
      browser_server: redactText(options.browserServer),
      allow_failures: options.allowFailures,
      remote_validation_approved: options.remoteValidationApproved,
      lab_only_remote_validation: options.labOnlyRemoteValidation,
      evidence: {
        installed_package_smoke: options.installedPackageSmokePath ? redactText(options.installedPackageSmokePath) : null,
        safe_action_sampler: options.samplerResultPath ? redactText(options.samplerResultPath) : null,
        visual_review: options.visualReviewPath ? redactText(options.visualReviewPath) : null,
      },
    },
    selected_machine: {
      machine_id: machineAlias(selected.machineId),
      machine_alias: machineAlias(selected.machineId),
      source: selected.source,
      redacted: true,
    },
    checks,
    artifacts,
    readiness,
  };

  writeReport(report, options);
  console.log(JSON.stringify(report, null, 2));

  if (!readiness.ready && !options.allowFailures) process.exit(1);
}

function appendEvidenceChecks(options: CliOptions, checks: CommandCheck[], artifacts: Artifact[]): void {
  for (const evidence of [
    { kind: "installed-package-smoke" as const, path: options.installedPackageSmokePath },
    { kind: "safe-action-sampler-result" as const, path: options.samplerResultPath },
    { kind: "visual-regression-review" as const, path: options.visualReviewPath },
  ]) {
    if (!evidence.path) continue;
    const check = evidenceCheckFromPath(evidence.kind, evidence.path);
    checks.push(check);
    artifacts.push(evidenceArtifact(evidence.kind, evidence.path, check));
  }
}

function evidenceCheckFromPath(kind: EvidenceKind, path: string): CommandCheck {
  if (!existsSync(path)) {
    return {
      id: kind,
      status: "failed",
      summary: `${kind} evidence file was not found.`,
      data: { path: redactText(path) },
    };
  }
  const raw = readFileSync(path, "utf8");
  const payload = parseJson(raw);
  if (!payload) {
    return {
      id: kind,
      status: "failed",
      summary: `${kind} evidence file did not contain JSON.`,
      stdout_tail: tail(redactText(raw)),
      data: { path: redactText(path) },
    };
  }
  return evidenceCheckFromReport(kind, path, payload);
}

export function evidenceCheckFromReport(kind: EvidenceKind, path: string, payload: unknown): CommandCheck {
  const data = redactJson(payload) as Record<string, unknown>;
  if (kind === "installed-package-smoke") return installedPackageSmokeCheck(path, payload, data);
  if (kind === "safe-action-sampler-result") return safeActionSamplerCheck(path, payload, data);
  return visualReviewCheck(path, payload, data);
}

function installedPackageSmokeCheck(path: string, payload: unknown, data: Record<string, unknown>): CommandCheck {
  const report = asRecord(payload);
  const checks = Array.isArray(report?.["checks"]) ? report["checks"].filter(isRecord) : [];
  const hasPassedCheck = (id: string) => checks.some((check) => check["id"] === id && check["status"] === "passed");
  const localScreenshot = checks.find((check) => check["id"] === "local-screenshot");
  const unexpectedFailures = checks.filter((check) => check["status"] === "failed" || check["status"] === "timed_out");
  const valid = report?.["schema_version"] === "open-computer.installed-machine-smoke.v1"
    && asRecord(report["package"])?.["name"] === "@hasna/computer"
    && asRecord(report["package"])?.["version"] === VERSION
    && typeof report["generated_at"] === "string"
    && hasPassedCheck("local-headless-status")
    && hasPassedCheck("native-tools")
    && hasPassedCheck("packaged-helpers")
    && localScreenshot?.["status"] === "skipped"
    && localScreenshot["summary"] === "Screenshot skipped by --skip-screenshot."
    && unexpectedFailures.length === 0;
  return {
    id: "installed-package-smoke",
    status: valid ? "passed" : "failed",
    summary: valid
      ? "Installed package smoke report is valid and includes helper/native-tool package checks."
      : "Installed package smoke report is missing required schema, current package version, clean check status, or helper/native-tool evidence.",
    data: {
      path: redactText(path),
      report: data,
    },
  };
}

function safeActionSamplerCheck(path: string, payload: unknown, data: Record<string, unknown>): CommandCheck {
  const report = asRecord(payload);
  const passed = report?.["status"] === "passed" || report?.["passed"] === true;
  const actions = Array.isArray(report?.["actions"]) ? report["actions"].filter(isRecord) : [];
  const cleanupActions = Array.isArray(report?.["cleanup_actions"]) ? report["cleanup_actions"].filter(isRecord) : [];
  const artifacts = Array.isArray(report?.["artifacts"]) ? report["artifacts"].filter(isRecord) : [];
  const leases = Array.isArray(report?.["leases"]) ? report["leases"].filter(isRecord) : [];
  const leftovers = asRecord(report?.["leftovers"]);
  const noLeftoverTabs = report?.["leftover_tabs"] === 0 || leftovers?.["tabs"] === 0;
  const noLeftoverFiles = report?.["leftover_files"] === 0 || leftovers?.["files"] === 0;
  const noLeftoverProcesses = report?.["leftover_processes"] === 0 || leftovers?.["processes"] === 0;
  const validActions = actions.length > 0 && actions.every(isSafeSamplerAction);
  const validCleanup = cleanupActions.length > 0 && cleanupActions.every(isCleanupSamplerAction);
  const hasScreenshotEvidence = artifacts.some(isScreenshotHashArtifact)
    || actions.some((action) => typeof action["sha256"] === "string" && isPositiveNumber(action["bytes"]) && isPositiveNumber(action["width"]) && isPositiveNumber(action["height"]));
  const opensGhostty = actions.some((action) => action["type"] === "open_empty_ghostty");
  const hasRequiredLeaseProof = hasLeaseProof(leases, "computer_display")
    && hasLeaseProof(leases, "browser_extension_session")
    && (!opensGhostty || hasLeaseProof(leases, "terminal_session"));
  const valid = report?.["schema_version"] === "open-computer.safe-action-sampler.v1"
    && passed
    && report["external_sites"] === false
    && report["secrets_touched"] === false
    && report["destructive_actions"] === false
    && report["fixture_only"] === true
    && validActions
    && report["cleanup_completed"] === true
    && validCleanup
    && hasScreenshotEvidence
    && hasRequiredLeaseProof
    && noLeftoverTabs
    && noLeftoverFiles
    && noLeftoverProcesses;
  return {
    id: "safe-action-sampler-result",
    status: valid ? "passed" : "failed",
    summary: valid
      ? "Safe action sampler report passed with cleanup proof and no leftovers."
      : "Safe action sampler report did not prove a passed non-destructive fixture-only run with explicit action, cleanup, and no-leftover evidence.",
    data: {
      path: redactText(path),
      report: data,
    },
  };
}

function visualReviewCheck(path: string, payload: unknown, data: Record<string, unknown>): CommandCheck {
  const report = asRecord(payload);
  const issues = Array.isArray(report?.["issues"]) ? report["issues"] : [];
  const artifacts = Array.isArray(report?.["artifacts"]) ? report["artifacts"].filter(isRecord) : [];
  const screenshotArtifacts = artifacts.filter(isScreenshotHashArtifact);
  const beforeArtifact = screenshotArtifacts.find((artifact) => artifact["kind"] === "screenshot_before");
  const afterArtifact = screenshotArtifacts.find((artifact) => artifact["kind"] === "screenshot_after");
  const beforeHash = screenshotHash(beforeArtifact);
  const afterHash = screenshotHash(afterArtifact);
  const visualChecks = asRecord(report?.["visual_checks"]);
  const pixelDifferenceRatio = typeof visualChecks?.["pixel_difference_ratio"] === "number"
    ? visualChecks["pixel_difference_ratio"]
    : null;
  const validVisualChecks = beforeHash !== null
    && afterHash !== null
    && beforeHash !== afterHash
    && visualChecks?.["before_sha256"] === beforeHash
    && visualChecks?.["after_sha256"] === afterHash
    && visualChecks?.["before_nonblank"] === true
    && visualChecks?.["after_nonblank"] === true
    && visualChecks?.["different_hashes"] === true
    && visualChecks?.["changed"] === true
    && typeof pixelDifferenceRatio === "number"
    && pixelDifferenceRatio > 0.001;
  const valid = report?.["schema_version"] === "open-computer.visual-review.v1"
    && (report["status"] === "passed" || report["passed"] === true)
    && Array.isArray(report["issues"])
    && issues.length === 0
    && screenshotArtifacts.length >= 2
    && Boolean(beforeArtifact)
    && Boolean(afterArtifact)
    && validVisualChecks
    && typeof report["selected_machine_alias"] === "string"
    && /^machine-[a-f0-9]{10}$/.test(report["selected_machine_alias"])
    && typeof report["reviewed_at"] === "string";
  return {
    id: "visual-regression-review",
    status: valid ? "passed" : "failed",
    summary: valid
      ? "Visual review report passed with nonblank before/after screenshots and changed pixel evidence."
      : "Visual review report did not prove a passed review with nonblank before/after artifacts, changed pixel evidence, timestamp, and zero unresolved issues.",
    data: {
      path: redactText(path),
      report: data,
    },
  };
}

function screenshotHash(artifact: Record<string, unknown> | undefined): string | null {
  return typeof artifact?.["sha256"] === "string" ? artifact["sha256"] : null;
}

function isSafeSamplerAction(action: Record<string, unknown>): boolean {
  const type = typeof action["type"] === "string" ? action["type"] : "";
  if (!SAFE_ACTION_TYPES.has(type)) return false;
  if (!hasOnlyAllowedSamplerKeys(type, action)) return false;
  const url = typeof action["url"] === "string" ? action["url"] : null;
  if (url && !isLocalFixtureUrl(url)) return false;
  if (typeof action["text"] === "string" && /password|token|secret|cookie|card|payment/i.test(action["text"])) return false;
  return true;
}

function isCleanupSamplerAction(action: Record<string, unknown>): boolean {
  const type = typeof action["type"] === "string" ? action["type"] : "";
  return (CLEANUP_ACTION_TYPES.has(type) || type.startsWith("cleanup_")) && hasOnlyAllowedSamplerKeys(type, action);
}

function hasOnlyAllowedSamplerKeys(type: string, action: Record<string, unknown>): boolean {
  const allowed = SAFE_ACTION_ALLOWED_KEYS[type] ?? new Set(["type"]);
  for (const key of Object.keys(action)) {
    if (DANGEROUS_SAMPLER_KEYS.test(key)) return false;
    if (!allowed.has(key)) return false;
  }
  return true;
}

function isScreenshotHashArtifact(artifact: Record<string, unknown>): boolean {
  const kind = typeof artifact["kind"] === "string" ? artifact["kind"] : "";
  return /screenshot/.test(kind)
    && typeof artifact["sha256"] === "string"
    && /^[a-f0-9]{64}$/i.test(artifact["sha256"])
    && isPositiveNumber(artifact["bytes"])
    && isPositiveNumber(artifact["width"])
    && isPositiveNumber(artifact["height"]);
}

function isPositiveNumber(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isLocalFixtureUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol === "file:") {
      return url.pathname.startsWith("/tmp/occtrl-fixtures/") || url.pathname.startsWith("/private/tmp/occtrl-fixtures/");
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    return isLoopbackHost(url.hostname) && FIXTURE_LOOPBACK_PORTS.has(url.port) && url.pathname.startsWith("/occtrl-fixture/");
  } catch {
    return value.startsWith("about:blank");
  }
}

function hasLeaseProof(leases: Record<string, unknown>[], resourceType: string): boolean {
  return leases.some((lease) => (
    lease["resource_type"] === resourceType
    && typeof lease["lease_id"] === "string"
    && lease["lease_id"].length > 0
    && lease["acquired"] === true
    && lease["released"] === true
  ));
}

function evidenceArtifact(kind: EvidenceKind, path: string, check: CommandCheck): Artifact {
  try {
    const bytes = readFileSync(path);
    return {
      kind,
      status: check.status,
      path: redactText(path),
      sha256: createHash("sha256").update(bytes).digest("hex"),
      bytes: bytes.length,
      error: check.status === "passed" ? undefined : check.summary,
      redacted: true,
    };
  } catch (error) {
    return {
      kind,
      status: check.status,
      path: redactText(path),
      error: error instanceof Error ? error.message : String(error),
      redacted: true,
    };
  }
}

async function runMachineChecks(machineId: string, options: CliOptions, checks: CommandCheck[], artifacts: Artifact[]): Promise<void> {
  const route = await runOpenMachinesJson("route", ["route", "--machine", machineId, "--json"], options.timeoutMs);
  checks.push(commandCheckFromRun("machine-route", route, route.exitCode === 0 ? "Machine route resolved." : "Machine route resolution failed."));

  const screen = await runOpenMachinesJson("screen", ["screen", machineId, "--print", "--json"], options.timeoutMs);
  checks.push(commandCheckFromRun("machine-screen-url", screen, screen.exitCode === 0 ? "Screen Sharing URL resolved without opening a GUI client." : "Screen Sharing URL could not be resolved."));

  const credentials = await runOpenMachinesJson("screen-credentials", ["screen-credentials", "--machine", machineId, "--check-secret", "--json"], options.timeoutMs);
  const credentialsData = parseJson(credentials.stdout);
  checks.push({
    ...commandCheckFromRun(
      "machine-screen-credentials",
      credentials,
      credentials.exitCode === 0 ? "Screen Sharing credential preflight passed." : "Screen Sharing credential preflight failed.",
    ),
    data: credentialsData ? redactJson(credentialsData) as Record<string, unknown> : undefined,
  });

  const capability = await runRemoteMachineCommand(machineId, REMOTE_CAPABILITY_COMMAND, options.timeoutMs);
  const capabilityValues = parseKeyValueLines(capability.stdout);
  checks.push({
    ...commandCheckFromRun("remote-capabilities", capability, capability.exitCode === 0 ? "Remote capability probe succeeded." : "Remote capability probe failed."),
    data: capabilityValues,
  });

  const screenshot = await runRemoteMachineCommand(machineId, REMOTE_SCREENSHOT_COMMAND, options.timeoutMs);
  const screenshotValues = parseKeyValueLines(screenshot.stdout);
  const screenshotBytes = asNumber(screenshotValues["bytes"]);
  const screenshotWidth = asNumber(screenshotValues["width"]);
  const screenshotHeight = asNumber(screenshotValues["height"]);
  const screenshotHash = asString(screenshotValues["sha256"]);
  const screenshotHasArtifact = screenshot.exitCode === 0
    && screenshotValues["screenshot"] === "ok"
    && Boolean(screenshotHash)
    && screenshotBytes !== undefined
    && screenshotBytes > 0
    && screenshotWidth !== undefined
    && screenshotWidth > 0
    && screenshotHeight !== undefined
    && screenshotHeight > 0;
  const screenshotCheck: CommandCheck = {
    ...commandCheckFromRun(
      "remote-screenshot",
      screenshot,
      screenshotHasArtifact
        ? "Remote screenshot captured and hashed."
        : screenshot.timedOut
          ? "Remote screenshot capture timed out."
          : screenshot.exitCode === 0
            ? "Remote screenshot command exited successfully but did not return required hash and dimensions."
            : "Remote screenshot capture failed.",
    ),
    status: screenshot.timedOut ? "timed_out" : screenshotHasArtifact ? "passed" : "failed",
    data: screenshotValues,
  };
  checks.push(screenshotCheck);
  if (screenshotHasArtifact) {
    artifacts.push({
      kind: "remote_screenshot_hash",
      status: "passed",
      remote_path: asString(screenshotValues["remote_path"]),
      sha256: screenshotHash,
      bytes: screenshotBytes,
      width: screenshotWidth,
      height: screenshotHeight,
      redacted: true,
    });
  } else {
    artifacts.push({
      kind: "remote_screenshot_attempt",
      status: screenshotCheck.status,
      error: screenshot.timedOut
        ? `remote screenshot timed out after ${options.timeoutMs}ms${screenshot.stderr ? `; stderr: ${tail(redactText(screenshot.stderr))}` : ""}`
        : asString(screenshotValues["error"]) ?? "remote screenshot did not produce an artifact",
      redacted: true,
    });
  }

  const chrome = await runRemoteMachineCommand(machineId, REMOTE_CHROME_QUERY_COMMAND, Math.min(options.timeoutMs, 8_000));
  const chromeValues = parseKeyValueLines(chrome.stdout);
  const chromeConfirmed = chrome.exitCode === 0 && chromeValues["chrome_window"] === "present";
  checks.push({
    ...commandCheckFromRun(
      "remote-visible-browser-query",
      chrome,
      chrome.timedOut
        ? "Remote Chrome visible-window query timed out."
        : chromeConfirmed
          ? "Remote Chrome visible-window query confirmed an existing window."
          : chrome.exitCode === 0
            ? "Remote Chrome visible-window query did not confirm a visible window."
            : "Remote Chrome visible-window query failed.",
    ),
    status: chrome.timedOut ? "timed_out" : chromeConfirmed ? "passed" : "failed",
    data: chromeValues,
  });
}

async function checkBrowserExtensionStatus(serverUrl: string, timeoutMs: number, targetMachineId: string | null): Promise<CommandCheck> {
  const startedAt = Date.now();
  const browserServer = parseBrowserServer(serverUrl);
  if (!browserServer.ok) {
    return {
      id: "browser-extension-status",
      status: "skipped",
      summary: browserServer.reason,
      duration_ms: Date.now() - startedAt,
      data: { classification: "invalid_browser_server" },
    };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(timeoutMs, 3_000));
  try {
    const base = browserServer.base;
    const health = await fetch(`${base}/health`, {
      signal: controller.signal,
    });
    const healthBody = await health.text();
    if (!health.ok) {
      return {
        id: "browser-extension-status",
        status: "skipped",
        summary: `Browser server health check returned HTTP ${health.status}.`,
        duration_ms: Date.now() - startedAt,
        stdout_tail: tail(redactText(healthBody)),
        data: { classification: "not_running_or_wrong_service" },
      };
    }
    const healthPayload = parseJson(healthBody) as Record<string, unknown> | null;
    if (!healthPayload || healthPayload["name"] !== "browser") {
      return {
        id: "browser-extension-status",
        status: "skipped",
        summary: "Browser server health check did not identify @hasna/browser.",
        duration_ms: Date.now() - startedAt,
        stdout_tail: tail(redactText(healthBody)),
        data: { classification: "wrong_service" },
      };
    }

    const response = await fetch(`${base}/api/extension/status`, {
      signal: controller.signal,
    });
    const body = await response.text();
    if (!response.ok) {
      return {
        id: "browser-extension-status",
        status: "skipped",
        summary: response.status === 401
          ? "Browser extension status endpoint requires authentication."
          : `Browser extension status endpoint returned HTTP ${response.status}.`,
        duration_ms: Date.now() - startedAt,
        stdout_tail: tail(redactText(body)),
        data: { classification: response.status === 401 ? "unauthorized" : "status_unavailable" },
      };
    }
    const payload = parseJson(body) as Record<string, unknown> | null;
    if (!payload) {
      return {
        id: "browser-extension-status",
        status: "skipped",
        summary: "Browser extension status endpoint did not return JSON.",
        duration_ms: Date.now() - startedAt,
        stdout_tail: tail(redactText(body)),
        data: { classification: "invalid_status_response" },
      };
    }
    const connected = payload["connected"] === true;
    const binding = browserBridgeTargetBinding(payload, targetMachineId);
    const passed = connected && binding.matched;
    return {
      id: "browser-extension-status",
      status: passed ? "passed" : "skipped",
      summary: passed
        ? "Browser extension bridge is connected and bound to the selected machine."
        : connected
          ? `Browser extension bridge is connected but target binding did not pass: ${binding.reason}.`
          : "Browser extension bridge is not connected; extension live smoke is skipped.",
      duration_ms: Date.now() - startedAt,
      data: {
        ...redactJson(payload) as Record<string, unknown>,
        target_binding: binding,
      },
    };
  } catch (error) {
    return {
      id: "browser-extension-status",
      status: "skipped",
      summary: `Browser extension status endpoint unavailable: ${error instanceof Error ? error.message : String(error)}`,
      duration_ms: Date.now() - startedAt,
      data: { classification: "not_running" },
    };
  } finally {
    clearTimeout(timer);
  }
}

export function parseBrowserServer(value: string): { ok: true; base: string } | { ok: false; reason: string } {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return { ok: false, reason: "Browser server must use http or https loopback." };
    }
    if (!isLoopbackHost(url.hostname)) {
      return { ok: false, reason: "Browser server must be loopback-only for live validation." };
    }
    url.pathname = url.pathname.replace(/\/+$/, "");
    url.search = "";
    url.hash = "";
    return { ok: true, base: url.toString().replace(/\/$/, "") };
  } catch (error) {
    return { ok: false, reason: `Browser server URL is invalid: ${error instanceof Error ? error.message : String(error)}` };
  }
}

function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1" || normalized === "0:0:0:0:0:0:0:1";
}

export async function authorizeLiveMachineValidationRoute(
  machineId: string,
  options: Pick<CliOptions, "timeoutMs" | "labOnlyRemoteValidation" | "remoteValidationApproved">,
  run: WorkflowRun,
): Promise<ValidationRouteProof> {
  const capabilityToken = liveValidationCapabilityToken(machineId, run.id);
  const route = await routePlannerTool("fleet", {
    machineId,
    action: "run_smoke",
    workspacePath: COMPUTER_ROOT,
    timeoutMs: Math.min(options.timeoutMs, 120_000),
  }, {
    approved: options.remoteValidationApproved && options.labOnlyRemoteValidation,
    actor: "validate-live-machine",
    transport: "live-machine-validation",
    fleetTransport: {
      kind: "open-machines-cli-ssh",
      auth: "ssh-agent",
      machineId,
      explicitOptIn: options.labOnlyRemoteValidation,
      capabilityToken,
    },
    verifyFleetCapabilityToken: (claims) => ({
      ok: claims.token === capabilityToken
        && claims.machineId === machineId
        && claims.action === "run_smoke"
        && claims.transportKind === "open-machines-cli-ssh"
        && claims.transportAuth === "ssh-agent",
      reason: "live validation token was not bound to this machine/action/transport",
    }),
    metadata: {
      run_id: run.id,
      validation_mode: "lab_only",
      source_checkout: true,
    },
  });
  const policyDecisionId = recordPolicyDecision({
    runId: run.id,
    capability: "fleet.run_smoke",
    decision: route.status,
    reason: route.reason,
    metadata: {
      validation_mode: "lab_only",
      route_allowed: route.allowed,
      machine_alias: machineAlias(machineId),
    },
  });
  const audits = listAuditEvents({ transport: "live-machine-validation", capability: "fleet.run_smoke", limit: 1 });
  return {
    allowed: route.allowed,
    check: {
      id: "fleet-validation-route",
      status: route.allowed ? "passed" : "failed",
      summary: route.allowed
        ? "Fleet validation route passed with lab-only opt-in, machine-bound token, and route audit."
        : route.reason ?? "Fleet validation route did not pass.",
      data: {
        capability: route.capability,
        route_status: route.status,
        policy_decision_id: policyDecisionId,
        audit_event_present: audits.length > 0,
        validation_mode: "lab_only",
        source_checkout: true,
      },
    },
  };
}

function liveValidationCapabilityToken(machineId: string, runId: string): string {
  return `live-validation:${createHash("sha256").update(`${machineId}:${runId}:fleet.run_smoke:${VERSION}`).digest("hex")}`;
}

function acquireFleetMachineValidationLease(machineId: string, timeoutMs: number): ValidationLease {
  const run = createWorkflowRun({ status: "running" });
  try {
    const lease = acquireRuntimeLease({
      resourceType: "fleet_machine",
      resourceId: `machine:${machineAlias(machineId)}`,
      runId: run.id,
      holder: "live-machine-validation",
      ttlMs: Math.max(timeoutMs * 4, 60_000),
    });
    return {
      run,
      lease,
      check: {
        id: "fleet-machine-lease",
        status: "passed",
        summary: "Acquired exclusive fleet_machine validation lease.",
        data: {
          run_id: run.id,
          lease_id: lease.id,
          resource_type: lease.resource_type,
          resource_id: lease.resource_id,
          expires_at: lease.expires_at,
        },
      },
    };
  } catch (error) {
    transitionWorkflowRun(run.id, "failed", { error: error instanceof Error ? error.message : String(error) });
    return {
      run,
      lease: null,
      check: {
        id: "fleet-machine-lease",
        status: "failed",
        summary: error instanceof Error ? error.message : String(error),
        data: { run_id: run.id },
      },
    };
  }
}

function releaseFleetMachineValidationLease(lease: RuntimeLease, run: WorkflowRun): CommandCheck {
  try {
    const released = releaseRuntimeLease(lease.id, { runId: run.id, holder: "live-machine-validation" });
    transitionWorkflowRun(run.id, "completed");
    return {
      id: "fleet-machine-lease-release",
      status: released?.status === "released" ? "passed" : "failed",
      summary: released?.status === "released"
        ? "Released fleet_machine validation lease."
        : "Fleet machine validation lease was not released.",
      data: {
        run_id: run.id,
        lease_id: lease.id,
        status: released?.status ?? "missing",
      },
    };
  } catch (error) {
    transitionWorkflowRun(run.id, "failed", { error: error instanceof Error ? error.message : String(error) });
    return {
      id: "fleet-machine-lease-release",
      status: "failed",
      summary: error instanceof Error ? error.message : String(error),
      data: { run_id: run.id, lease_id: lease.id },
    };
  }
}

function browserBridgeTargetBinding(payload: unknown, targetMachineId: string | null): {
  matched: boolean;
  reason: string;
  expected_machine_alias: string | null;
  observed_machine_aliases: string[];
} {
  const expectedAlias = machineAlias(targetMachineId);
  if (!targetMachineId || !expectedAlias) {
    return {
      matched: false,
      reason: "no_selected_machine",
      expected_machine_alias: null,
      observed_machine_aliases: [],
    };
  }

  const observed = collectMachineIdentityValues(payload);
  const observedAliases = [...new Set(observed.map((value) => value === expectedAlias ? value : machineAlias(value) ?? redactText(value)))];
  const matched = observed.some((value) => value === targetMachineId || value === expectedAlias || machineAlias(value) === expectedAlias);
  return {
    matched,
    reason: matched ? "matched_selected_machine" : observed.length === 0 ? "status_missing_machine_identity" : "observed_machine_identity_mismatch",
    expected_machine_alias: expectedAlias,
    observed_machine_aliases: observedAliases,
  };
}

function collectMachineIdentityValues(value: unknown): string[] {
  const record = asRecord(value);
  if (!record) return [];
  const matches: string[] = [];
  for (const key of ["target_machine_id", "targetMachineId", "target_machine_alias", "targetMachineAlias"]) {
    const nested = record[key];
    if (typeof nested === "string" && nested.length > 0) matches.push(nested);
  }
  return matches;
}

function commandCheckFromRun(id: string, result: RunResult, summary: string): CommandCheck {
  return {
    id,
    status: result.timedOut ? "timed_out" : result.exitCode === 0 ? "passed" : "failed",
    summary,
    command: redactText(result.commandText),
    cwd: redactText(result.cwd),
    exit_code: result.exitCode,
    duration_ms: result.durationMs,
    stdout_tail: tail(redactText(result.stdout)),
    stderr_tail: tail(redactText(result.stderr)),
  };
}

async function runOpenMachinesJson(id: string, args: string[], timeoutMs: number): Promise<RunResult> {
  if (!existsSync(MACHINES_ROOT)) {
    return {
      command: ["open-machines", ...args],
      commandText: `open-machines ${args.join(" ")}`,
      cwd: MACHINES_ROOT,
      stdout: "",
      stderr: "Adjacent open-machines repo is missing.",
      exitCode: 1,
      durationMs: 0,
      timedOut: false,
    };
  }
  return runCommand(["bun", "run", "src/cli/index.ts", ...args], { cwd: MACHINES_ROOT, timeoutMs, id });
}

async function runRemoteMachineCommand(machineId: string, command: string, timeoutMs: number): Promise<RunResult> {
  const code = [
    'import { runMachineCommand } from "./src/remote.ts";',
    'const machine = process.env["OCCTRL_MACHINE_ID"];',
    'const command = process.env["OCCTRL_REMOTE_COMMAND"];',
    'const timeoutMs = Number.parseInt(process.env["OCCTRL_REMOTE_TIMEOUT_MS"] || "", 10);',
    'const killGraceMs = Number.parseInt(process.env["OCCTRL_REMOTE_KILL_GRACE_MS"] || "", 10);',
    'if (!machine || !command) throw new Error("missing remote command env");',
    "const result = runMachineCommand(machine, command, Number.isFinite(timeoutMs) && timeoutMs > 0 ? { timeoutMs, killGraceMs: Number.isFinite(killGraceMs) && killGraceMs > 0 ? killGraceMs : undefined } : undefined);",
    "console.log(JSON.stringify(result, null, 2));",
    "process.exit(result.timedOut ? 124 : result.exitCode === 0 ? 0 : 1);",
  ].join("\n");
  const result = await runCommand(["bun", "-e", code], {
    cwd: MACHINES_ROOT,
    timeoutMs: timeoutMs + REMOTE_COMMAND_KILL_GRACE_MS + REMOTE_COMMAND_WRAPPER_OVERHEAD_MS,
    id: "remote-command",
    env: {
      OCCTRL_MACHINE_ID: machineId,
      OCCTRL_REMOTE_COMMAND: command,
      OCCTRL_REMOTE_TIMEOUT_MS: String(timeoutMs),
      OCCTRL_REMOTE_KILL_GRACE_MS: String(REMOTE_COMMAND_KILL_GRACE_MS),
    },
  });

  const parsed = parseJson(result.stdout) as { stdout?: unknown; stderr?: unknown; exitCode?: unknown; timedOut?: unknown } | null;
  if (!parsed) {
    const timedOut = result.timedOut || result.exitCode === 124;
    return {
      ...result,
      exitCode: timedOut ? 124 : result.exitCode,
      timedOut,
      stderr: timedOut
        ? [result.stderr, `Outer validator timed out before open-machines reported cleanup status after ${timeoutMs}ms timeout and ${REMOTE_COMMAND_KILL_GRACE_MS}ms cleanup grace.`].filter(Boolean).join(result.stderr ? "\n" : "")
        : result.stderr,
    };
  }
  return {
    ...result,
    stdout: typeof parsed.stdout === "string" ? parsed.stdout : result.stdout,
    stderr: typeof parsed.stderr === "string" ? parsed.stderr : result.stderr,
    exitCode: typeof parsed.exitCode === "number" ? parsed.exitCode : result.exitCode,
    timedOut: parsed.timedOut === true || result.timedOut,
  };
}

async function runCommand(
  command: string[],
  options: { cwd: string; timeoutMs: number; id: string; env?: Record<string, string> },
): Promise<RunResult> {
  const startedAt = Date.now();
  const proc = Bun.spawn(command, {
    cwd: options.cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...options.env },
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill("SIGTERM");
    setTimeout(() => proc.kill("SIGKILL"), 1_000).unref?.();
  }, options.timeoutMs);
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  clearTimeout(timer);
  return {
    command,
    commandText: command.join(" "),
    cwd: options.cwd,
    stdout,
    stderr,
    exitCode,
    durationMs: Date.now() - startedAt,
    timedOut,
  };
}

function selectMachine(requested: string | null, topology: RunResult): { machineId: string | null; source: "argument" | "topology" | "none" } {
  if (requested) return { machineId: requested, source: "argument" };
  const parsed = parseJson(topology.stdout) as { machines?: Array<Record<string, unknown>> } | null;
  const machines = parsed?.machines ?? [];
  const selected = machines.find((machine) => {
    const hints = Array.isArray(machine["route_hints"]) ? machine["route_hints"] as Array<Record<string, unknown>> : [];
    return machine["platform"] === "macos"
      && machine["manifest_declared"] === true
      && hints.some((hint) => hint["reachable"] === true);
  });
  return {
    machineId: typeof selected?.["machine_id"] === "string" ? selected["machine_id"] : null,
    source: selected ? "topology" : "none",
  };
}

export function summarizeReadiness(checks: CommandCheck[]): ValidationReport["readiness"] {
  const statusById = new Map(checks.map((check) => [check.id, check.status]));
  const blockers: string[] = [];
  const pendingEvidence: string[] = [];
  const requiredLabChecks = [
    "machines-topology",
    "machine-selection",
    "fleet-machine-lease",
    "fleet-validation-route",
    "machine-route",
    "machine-screen-url",
    "remote-capabilities",
    "remote-screenshot",
    "remote-visible-browser-query",
    "fleet-machine-lease-release",
  ];

  for (const id of requiredLabChecks) {
    const status = statusById.get(id);
    if (status !== "passed") blockers.push(`${id} did not pass${status ? ` (${status})` : " (missing)"}`);
  }
  if (statusById.get("machine-screen-credentials") === "failed" && (statusById.get("remote-screenshot") !== "passed" || statusById.get("remote-visible-browser-query") !== "passed")) {
    blockers.push("screen-sharing credentials are not available and no resident GUI validation path succeeded");
  }
  const labBlockers = [...new Set(blockers)];
  const labReady = labBlockers.length === 0;

  if (statusById.get("browser-extension-status") !== "passed") blockers.push("browser extension bridge did not pass a live status check");

  for (const item of ["safe-action-sampler-result", "visual-regression-review", "installed-package-smoke"]) {
    if (statusById.get(item) !== "passed") pendingEvidence.push(`${item} missing`);
  }

  const uniqueBlockers = [...new Set(blockers)];
  const liveSmokeReady = labReady && statusById.get("browser-extension-status") === "passed";
  const p8Complete = liveSmokeReady && pendingEvidence.length === 0;
  return {
    ready: p8Complete,
    lab_ready: labReady,
    live_smoke_ready: liveSmokeReady,
    p8_complete: p8Complete,
    blockers: uniqueBlockers,
    pending_evidence: pendingEvidence,
    next_actions: p8Complete
      ? ["P8 validation evidence is complete; rerun after the next major phase or package reinstall."]
      : liveSmokeReady
        ? ["Run the safe random-action sampler, visual review, and installed-package machine smoke before marking P8 complete."]
      : [
          "Provision VNC/screen-sharing credentials or run a resident machine agent with Screen Recording and Accessibility grants.",
          "Pair the Chrome extension bridge or start browser-serve with an already connected extension.",
          "Rerun this gate before any screenshot or non-headless browser validation.",
        ],
  };
}

export function redactText(value: string): string {
  return value
    .replace(/("(?:user|passwordSecretKey|passwordSecretSource|screenPasswordSecret|apiKey|api[_-]?key|access_token|refresh_token|id_token|authorization|cookie)"\s*:\s*)"[^"]*"/gi, '$1"<redacted>"')
    .replace(/("(?:machine_id|requested_machine_id|target_machine_id|selected_machine_id|host_machine_id|machineId|targetMachineId|selectedMachineId|hostMachineId|machine_alias|target_machine_alias|machineAlias|targetMachineAlias|hostname|host|dns_name|address|lanAddress|command_target|target|endpoint|url)"\s*:\s*)"[^"]*"/gi, '$1"<redacted>"')
    .replace(/(--machine\s+)[^\s]+/g, "$1<redacted>")
    .replace(/(\bscreen\s+)(?!-)[A-Za-z0-9._:-]+/g, "$1<redacted>")
    .replace(/\b(endpoint|url)=([^&\s]+)/gi, "$1=<redacted>")
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[redacted-ip]")
    .replace(/\b(Authorization:\s*Bearer\s+)[^\s]+/gi, "$1<redacted>")
    .replace(/\b(Cookie:\s*)[^\n\r]+/gi, "$1<redacted>")
    .replace(/([a-z][a-z0-9+.-]*:\/\/)([^:@/\s]+):([^@/\s]+)@/gi, "$1<user>:<redacted>@")
    .replace(/vnc:\/\/([^@\s]+)@/g, "vnc://<user>@")
    .replace(/(vnc:\/\/<user>@)[^/\s"]+/g, "$1machine-<redacted>")
    .replace(/ssh\s+([^@\s]+)@/g, "ssh <user>@")
    .replace(/(ssh\s+<user>@)[^\s]+/g, "$1machine-<redacted>")
    .replace(/\/Users\/[^/\s]+/g, "/Users/<user>")
    .replace(/\/home\/[^/\s]+/g, "/home/<user>")
    .replace(/machines\/screen-sharing\/[A-Za-z0-9._-]+/g, "machines/screen-sharing/<redacted>")
    .replace(/\bmachine\d+\b/g, "machine-<redacted>")
    .replace(/(password|token|secret|api[_-]?key)=([^&\s]+)/gi, "$1=<redacted>");
}

function machineAlias(machineId: string | null): string | null {
  if (!machineId) return null;
  return `machine-${createHash("sha256").update(machineId).digest("hex").slice(0, 10)}`;
}

function redactJson(value: unknown): unknown {
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map((item) => redactJson(item));
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      const lower = key.toLowerCase();
      output[key] = (
        lower === "user"
        || lower === "machineid"
        || lower === "machine_id"
        || lower === "requested_machine_id"
        || lower === "targetmachineid"
        || lower === "target_machine_id"
        || lower === "selectedmachineid"
        || lower === "selected_machine_id"
        || lower === "hostmachineid"
        || lower === "host_machine_id"
        || lower === "machinealias"
        || lower === "machine_alias"
        || lower === "targetmachinealias"
        || lower === "target_machine_alias"
        || lower === "hostname"
        || lower === "host"
        || lower === "dns_name"
        || lower === "address"
        || lower === "lanaddress"
        || lower.endsWith("address")
        || lower === "target"
        || lower === "endpoint"
        || lower === "url"
        || lower === "command_target"
        || lower === "authorization"
        || lower === "cookie"
        || lower.includes("password")
        || lower.includes("secret")
        || lower.includes("token")
        || lower.includes("apikey")
        || lower.includes("api_key")
        || lower.includes("api-key")
      ) && typeof nested === "string"
        ? "<redacted>"
        : redactJson(nested);
    }
    return output;
  }
  return value;
}

function parseKeyValueLines(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const index = line.indexOf("=");
    if (index <= 0) continue;
    values[line.slice(0, index).trim()] = redactText(line.slice(index + 1).trim());
  }
  return values;
}

function parseJson(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function writeReport(report: ValidationReport, options: CliOptions): void {
  mkdirSync(dirname(options.writePath), { recursive: true });
  writeFileSync(options.writePath, `${JSON.stringify(report, null, 2)}\n`);
  if (options.markdownPath) {
    mkdirSync(dirname(options.markdownPath), { recursive: true });
    writeFileSync(options.markdownPath, renderMarkdown(report));
  }
}

function renderMarkdown(report: ValidationReport): string {
  const lines = [
    `# OCCTRL Live Machine Validation - ${report.generated_at}`,
    "",
    `- Selected machine: \`${report.selected_machine.machine_alias ?? "none"}\` (${report.selected_machine.source})`,
    `- Lab ready: \`${report.readiness.lab_ready}\``,
    `- Live smoke ready: \`${report.readiness.live_smoke_ready}\``,
    `- P8 complete: \`${report.readiness.p8_complete}\``,
    `- Platform: \`${report.environment.platform}/${report.environment.arch}\``,
    "",
    "## Checks",
    "",
    "| Check | Status | Exit | Summary |",
    "| --- | --- | --- | --- |",
  ];
  for (const check of report.checks) {
    lines.push(`| \`${check.id}\` | \`${check.status}\` | \`${check.exit_code ?? ""}\` | ${escapeMarkdown(check.summary)} |`);
  }
  lines.push("", "## Artifacts", "", "| Kind | Status | Path | SHA-256 | Error |", "| --- | --- | --- | --- | --- |");
  if (report.artifacts.length === 0) lines.push("| none |  |  |  |  |");
  for (const artifact of report.artifacts) {
    lines.push(`| \`${artifact.kind}\` | \`${artifact.status ?? ""}\` | \`${artifact.path ?? artifact.remote_path ?? ""}\` | \`${artifact.sha256 ?? ""}\` | ${escapeMarkdown(artifact.error ?? "")} |`);
  }
  lines.push("", "## Blockers", "");
  if (report.readiness.blockers.length === 0) lines.push("- None");
  else for (const blocker of report.readiness.blockers) lines.push(`- ${escapeMarkdown(blocker)}`);
  lines.push("", "## Pending Evidence", "");
  if (report.readiness.pending_evidence.length === 0) lines.push("- None");
  else for (const item of report.readiness.pending_evidence) lines.push(`- ${escapeMarkdown(item)}`);
  lines.push("", "## Next Actions", "");
  for (const action of report.readiness.next_actions) lines.push(`- ${escapeMarkdown(action)}`);
  return `${lines.join("\n")}\n`;
}

function escapeMarkdown(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

export function parseArgs(args: string[]): CliOptions {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const options: CliOptions = {
    machineId: process.env["OCCTRL_MACHINE_ID"] || null,
    timeoutMs: Number.parseInt(process.env["OCCTRL_MACHINE_TIMEOUT_MS"] ?? "", 10) || 15_000,
    browserServer: process.env["OCCTRL_BROWSER_SERVER"] || DEFAULT_BROWSER_SERVER,
    writePath: join("/tmp", `occtrl-live-machine-validation-${timestamp}.json`),
    markdownPath: null,
    allowFailures: false,
    skipRemote: false,
    remoteValidationApproved: process.env["OCCTRL_APPROVE_REMOTE_VALIDATION"] === "1",
    labOnlyRemoteValidation: process.env["OCCTRL_LAB_ONLY_REMOTE_VALIDATION"] === "1",
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--machine") options.machineId = requireValue(args, ++i, arg);
    else if (arg === "--timeout-ms") options.timeoutMs = Number.parseInt(requireValue(args, ++i, arg), 10);
    else if (arg === "--browser-server") options.browserServer = requireValue(args, ++i, arg);
    else if (arg === "--write") options.writePath = requireValue(args, ++i, arg);
    else if (arg === "--markdown") options.markdownPath = requireValue(args, ++i, arg);
    else if (arg === "--installed-package-smoke") options.installedPackageSmokePath = requireValue(args, ++i, arg);
    else if (arg === "--safe-action-sampler") options.samplerResultPath = requireValue(args, ++i, arg);
    else if (arg === "--visual-review") options.visualReviewPath = requireValue(args, ++i, arg);
    else if (arg === "--allow-failures") options.allowFailures = true;
    else if (arg === "--skip-remote") options.skipRemote = true;
    else if (arg === "--approve-remote-validation") options.remoteValidationApproved = true;
    else if (arg === "--lab-only-remote-validation") options.labOnlyRemoteValidation = true;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) throw new Error("--timeout-ms must be positive");
  return options;
}

function printHelp(): void {
  console.log(`Usage: bun run scripts/validate-live-machine.ts [options]

Options:
  --machine <id>          Target machine id. Defaults to first reachable declared macOS machine.
  --timeout-ms <ms>       Per-check timeout. Defaults to 15000.
  --browser-server <url>  browser-serve URL for extension status. Defaults to ${DEFAULT_BROWSER_SERVER}.
  --write <path>          JSON report output path. Defaults to /tmp/occtrl-live-machine-validation-<timestamp>.json.
  --markdown <path>       Optional Markdown summary output path.
  --installed-package-smoke <path>  Installed computer validate-machine JSON evidence.
  --safe-action-sampler <path>      Safe action sampler JSON evidence.
  --visual-review <path>            Visual review JSON evidence.
  --allow-failures        Exit 0 even when the lab is not ready.
  --skip-remote           Only run local and extension status checks.
  --approve-remote-validation  Approve SSH/Tailscale remote probes for this run; must be paired with --lab-only-remote-validation.
  --lab-only-remote-validation  Declare source-checkout remote probes as lab-only and route them through fleet policy/audit.
`);
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value) throw new Error(`${flag} requires a value`);
  return value;
}

function tail(value: string): string {
  return value.length <= OUTPUT_TAIL_BYTES ? value : value.slice(-OUTPUT_TAIL_BYTES);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
