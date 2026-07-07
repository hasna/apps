/**
 * Fleet env-flip mechanism (API-client / self-hosted mode).
 *
 * Coordinates flipping an @hasna OSS app's runtime storage mode across the
 * fleet from local (on-box sqlite/json) to **self_hosted** (the app's cloud
 * API at https://<app>.hasna.xyz) — and back — by:
 *   1. writing a per-app fleet env file on each target machine,
 *   2. wiring that env file into the app's service manager (systemd / launchd),
 *   3. restarting the service,
 *   4. verifying `<app> storage status --json` reports the expected mode,
 *   5. supporting one-command revert (unset the two vars -> local original).
 *
 * ARCHITECTURE (LOCKED): the only sanctioned cloud path for a CLIENT machine is
 * the app HTTPS API — client -> https://<app>.hasna.xyz/v1 with a bearer
 * `HASNA_<APP>_API_KEY`. The raw RDS DSN is NEVER distributed to machines and
 * `STORAGE_MODE=remote` + `DATABASE_URL` is FORBIDDEN on clients. RDS is only
 * reachable by the in-VPC ECS services + the admin tunnel. This module therefore
 * writes exactly two vars per app:
 *     HASNA_<APP>_API_URL=https://<app>.hasna.xyz
 *     HASNA_<APP>_API_KEY=<key from Secrets Manager hasna/oss/<app>/api-key>
 *
 * SECRETS: the API key is NEVER transported in cleartext by the orchestrator.
 * The remote script fetches it on the target machine via `secrets get <path>`;
 * the orchestrator only ever handles the secret *path*. Nothing here logs a
 * value.
 *
 * Rollout shape: canary (1 machine) -> batch -> all, OR a single atomic wave via
 * `--all-machines` (used by the coordination-store cutover so machines flip
 * together, never half-flipped / split-brain). An optional freeze-check hook
 * (coordination stores) must pass before any mutation proceeds.
 */

import type { FleetManifest, MachinePlatform } from "../types.js";

export type FlipMode = "self_hosted" | "local";

/** Normalize user-facing mode aliases to the canonical FlipMode. */
export function normalizeFlipMode(value?: string): FlipMode {
  const v = (value ?? "self_hosted").trim().toLowerCase();
  if (v === "local" || v === "revert" || v === "off") return "local";
  // remote/cloud/api/on all mean the sanctioned self-hosted API client mode.
  return "self_hosted";
}

/** Per-app fleet-flip profile. Add a new app by adding an entry here. */
export interface FlipAppSpec {
  /** App identifier, e.g. "todos". */
  app: string;
  /** Env var carrying the app API base URL, e.g. HASNA_TODOS_API_URL. */
  apiUrlEnv: string;
  /** Env var carrying the app API bearer key, e.g. HASNA_TODOS_API_KEY. */
  apiKeyEnv: string;
  /** App API base URL, e.g. https://todos.hasna.xyz (client appends /v1). */
  apiUrl: string;
  /** Secret PATH (never the value) resolved on-target via `secrets get`. */
  apiKeySecretPath: string;
  /** systemd/launchd service unit/label base name, e.g. hasna-todos-mcp. */
  serviceUnit: string;
  /** CLI binary used to read storage status, e.g. "todos". */
  cliBin: string;
  /** Args passed to the CLI to emit redacted JSON storage status. */
  statusArgs: string;
  /**
   * Extra env lines (KEY=VALUE) applied only in self_hosted mode. Values here
   * are non-secret literals only (e.g. shadow flags). Never a secret/DSN.
   */
  extraSelfHostedEnv?: Record<string, string>;
  /**
   * When true this app requires a passing freeze-check before any flip
   * (coordination stores: drain the dual-write shadow to divergence==0 before
   * the atomic cutover). See runFreezeCheck.
   */
  freezeRequired?: boolean;
  /** Human note surfaced in plans/docs. */
  note?: string;
}

/**
 * All 25 @hasna OSS apps that expose a self-hosted API at <app>.hasna.xyz.
 * Coordination hot stores are freeze-gated (drain shadow before atomic flip).
 */
const ALL_APPS = [
  "accounts",
  "attachments",
  "calendar",
  "contacts",
  "conversations",
  "domains",
  "economy",
  "files",
  "identities",
  "instructions",
  "knowledge",
  "logs",
  "loops",
  "machines",
  "mailery",
  "mementos",
  "projects",
  "recordings",
  "sandboxes",
  "secrets",
  "sessions",
  "shortlinks",
  "telephony",
  "testers",
  "todos",
] as const;

/**
 * Coordination stores dual-write to a shadow before the atomic cutover; a flip
 * to self_hosted must be preceded by a passing freeze-check (drain shadow to
 * divergence==0) so machines never split-brain.
 */
const FREEZE_REQUIRED_APPS = new Set(["todos", "loops", "mementos", "conversations"]);

/** Per-app non-secret env overlays applied only in self_hosted mode. */
const EXTRA_SELF_HOSTED_ENV: Record<string, Record<string, string>> = {};

function defineFlipApp(app: string): FlipAppSpec {
  const UP = app.toUpperCase();
  const spec: FlipAppSpec = {
    app,
    apiUrlEnv: `HASNA_${UP}_API_URL`,
    apiKeyEnv: `HASNA_${UP}_API_KEY`,
    apiUrl: `https://${app}.hasna.xyz`,
    apiKeySecretPath: `hasna/oss/${app}/api-key`,
    serviceUnit: `hasna-${app}-mcp`,
    cliBin: app,
    statusArgs: "storage status --json",
  };
  if (FREEZE_REQUIRED_APPS.has(app)) {
    spec.freezeRequired = true;
    spec.note = "Coordination store: drain dual-write shadow to divergence==0, then atomic --all-machines cutover.";
  }
  const extra = EXTRA_SELF_HOSTED_ENV[app];
  if (extra) spec.extraSelfHostedEnv = extra;
  return spec;
}

/**
 * Canonical per-app flip registry — ALL 25 @hasna OSS apps.
 *
 * Secret paths follow the shared convention `hasna/oss/<app>/api-key`.
 * SELF-HOSTED (LOCKED): the client talks to the app's HTTPS API; no DSN ever
 * reaches a machine.
 */
export const FLIP_APPS: Record<string, FlipAppSpec> = Object.fromEntries(
  ALL_APPS.map((app) => [app, defineFlipApp(app)]),
);

export function getFlipApp(app: string): FlipAppSpec {
  const spec = FLIP_APPS[app];
  if (!spec) {
    const known = Object.keys(FLIP_APPS).join(", ");
    throw new Error(`Unknown flip app "${app}". Known apps: ${known}`);
  }
  return spec;
}

export function listFlipApps(): FlipAppSpec[] {
  return Object.values(FLIP_APPS);
}

// --- Target selection & wave planning ------------------------------------

export interface FlipTarget {
  id: string;
  platform: MachinePlatform;
}

export interface SelectTargetsOptions {
  /** Explicit machine ids (comma/space accepted upstream, array here). */
  machines?: string[];
  /** Restrict to machines carrying ALL of these tags. */
  tags?: string[];
  /** Exclude these machine ids. */
  exclude?: string[];
}

/**
 * Resolve an ordered, de-duplicated target list from the fleet manifest.
 * Order is stable (manifest order) so the canary is deterministic.
 */
export function selectTargets(manifest: FleetManifest, options: SelectTargetsOptions = {}): FlipTarget[] {
  const exclude = new Set(options.exclude ?? []);
  const explicit = options.machines && options.machines.length > 0 ? new Set(options.machines) : null;
  const requiredTags = options.tags ?? [];
  const seen = new Set<string>();
  const out: FlipTarget[] = [];
  for (const machine of manifest.machines) {
    if (!machine.id || seen.has(machine.id)) continue;
    if (exclude.has(machine.id)) continue;
    if (explicit && !explicit.has(machine.id)) continue;
    if (requiredTags.length > 0) {
      const tags = new Set(machine.tags ?? []);
      if (!requiredTags.every((t) => tags.has(t))) continue;
    }
    seen.add(machine.id);
    out.push({ id: machine.id, platform: machine.platform });
  }
  return out;
}

export interface FlipWave {
  name: string;
  index: number;
  targets: FlipTarget[];
}

export interface PlanWavesOptions {
  /** Machines in the canary wave (default 1). */
  canarySize?: number;
  /** Machines per batch wave after the canary (default 4). */
  batchSize?: number;
  /**
   * Atomic mode: put EVERY target into a single wave (no canary, no batching).
   * Used by `--all-machines` for the coordination-store cutover so the fleet
   * flips together and is never half-flipped.
   */
  atomic?: boolean;
}

/**
 * Split ordered targets into canary -> batch(es). The final batch is the
 * remainder ("all"). Guarantees: canary is first, every target appears once,
 * order preserved. With `atomic`, produces exactly one wave containing all
 * targets.
 */
export function planWaves(targets: FlipTarget[], options: PlanWavesOptions = {}): FlipWave[] {
  if (targets.length === 0) return [];
  if (options.atomic) {
    return [{ name: "all-machines", index: 0, targets: targets.slice() }];
  }
  const canarySize = Math.max(0, options.canarySize ?? 1);
  const batchSize = Math.max(1, options.batchSize ?? 4);
  const waves: FlipWave[] = [];
  let cursor = 0;
  if (canarySize > 0) {
    waves.push({ name: "canary", index: 0, targets: targets.slice(0, canarySize) });
    cursor = Math.min(canarySize, targets.length);
  }
  let batchNum = 0;
  while (cursor < targets.length) {
    batchNum += 1;
    const next = targets.slice(cursor, cursor + batchSize);
    waves.push({ name: `batch-${batchNum}`, index: waves.length, targets: next });
    cursor += next.length;
  }
  return waves;
}

// --- Remote script generation --------------------------------------------

/** Shell-single-quote a literal so it is safe inside the generated script. */
function sq(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export interface BuildScriptOptions {
  /** Override the fleet env dir (default $HOME/.hasna/cloud). */
  envDir?: string;
  /** Skip the service restart (env written but not activated). */
  skipRestart?: boolean;
}

/**
 * Build the remote bash script that applies (mode="self_hosted") or reverts
 * (mode="local") the flip for one app on one machine.
 *
 * The API key is fetched on-target from the secret store; it never appears in
 * the script text, argv, or orchestrator logs. The env file is written 0600.
 * Revert removes the env file and the service drop-in entirely so the two vars
 * are fully unset and the app falls back to its untouched local original.
 */
export function buildFlipScript(spec: FlipAppSpec, mode: FlipMode, options: BuildScriptOptions = {}): string {
  const envDir = options.envDir ?? "${HOME}/.hasna/cloud";
  const lines: string[] = [
    "set -euo pipefail",
    `APP=${sq(spec.app)}`,
    `ENV_DIR="${envDir}"`,
    `ENV_FILE="${envDir}/${spec.app}.env"`,
    'mkdir -p "$ENV_DIR"',
    "umask 077",
  ];

  if (mode === "self_hosted") {
    // Fetch the API key on-target; abort if the secret is missing (never write
    // a half-configured self_hosted env file).
    lines.push(
      `API_KEY="$(secrets get ${sq(spec.apiKeySecretPath)} --raw 2>/dev/null || secrets get ${sq(spec.apiKeySecretPath)} 2>/dev/null)"`,
      'if [ -z "${API_KEY:-}" ]; then echo "FLIP_ERROR: could not resolve API key secret" >&2; exit 3; fi',
      'TMP_ENV="$(mktemp "${ENV_DIR}/.${APP}.env.XXXXXX")"',
      `printf '%s\\n' ${sq(`${spec.apiUrlEnv}=${spec.apiUrl}`)} >> "$TMP_ENV"`,
      `printf '%s=%s\\n' ${sq(spec.apiKeyEnv)} "$API_KEY" >> "$TMP_ENV"`,
    );
    for (const [key, value] of Object.entries(spec.extraSelfHostedEnv ?? {})) {
      lines.push(`printf '%s\\n' ${sq(`${key}=${value}`)} >> "$TMP_ENV"`);
    }
    lines.push('chmod 600 "$TMP_ENV"', 'mv -f "$TMP_ENV" "$ENV_FILE"', 'unset API_KEY');
  } else {
    // Revert: remove the fleet env file entirely so HASNA_<APP>_API_URL and
    // HASNA_<APP>_API_KEY are unset and the app returns to its local original.
    lines.push('rm -f "$ENV_FILE"');
  }

  // Wire the env file into the service manager and (re)start, unless skipped.
  if (!options.skipRestart) {
    lines.push(buildServiceWiring(spec, mode));
  }

  // Emit the storage status for verification by the orchestrator.
  lines.push(
    'echo "FLIP_STATUS_BEGIN"',
    `${spec.cliBin} ${spec.statusArgs}`,
    'echo "FLIP_STATUS_END"',
  );
  return lines.join("\n");
}

/**
 * Portable service-manager wiring:
 *  - systemd (linux): self_hosted writes a drop-in EnvironmentFile; local
 *    removes that drop-in so the vars are gone.
 *  - launchd (macOS): self_hosted setenv's each var from the env file; local
 *    unsetenv's the two known vars.
 * Detection is at runtime on the target so one script serves the mixed fleet.
 */
function buildServiceWiring(spec: FlipAppSpec, mode: FlipMode): string {
  const unit = spec.serviceUnit;
  const common = [
    `UNIT=${sq(unit)}`,
    `API_URL_ENV=${sq(spec.apiUrlEnv)}`,
    `API_KEY_ENV=${sq(spec.apiKeyEnv)}`,
    'ENV_FILE_ABS="$ENV_FILE"',
    'if command -v systemctl >/dev/null 2>&1; then',
    '  DROPIN_DIR="${HOME}/.config/systemd/user/${UNIT}.service.d"',
  ];
  if (mode === "self_hosted") {
    common.push(
      '  mkdir -p "$DROPIN_DIR"',
      '  {',
      '    echo "[Service]"',
      '    echo "EnvironmentFile=${ENV_FILE_ABS}"',
      '  } > "${DROPIN_DIR}/10-cloud-flip.conf"',
    );
  } else {
    common.push('  rm -f "${DROPIN_DIR}/10-cloud-flip.conf"');
  }
  common.push(
    '  systemctl --user daemon-reload',
    '  systemctl --user restart "${UNIT}" || systemctl --user restart "${UNIT}.service"',
    'elif command -v launchctl >/dev/null 2>&1; then',
    '  DOMAIN="gui/$(id -u)"',
  );
  if (mode === "self_hosted") {
    common.push(
      '  # macOS: export each var from the env file into the user launchd domain.',
      '  while IFS="=" read -r k v; do [ -n "$k" ] && launchctl setenv "$k" "$v"; done < "${ENV_FILE_ABS}"',
    );
  } else {
    common.push(
      '  # macOS: unset the two flip vars so the app falls back to local.',
      '  launchctl unsetenv "$API_URL_ENV" 2>/dev/null || true',
      '  launchctl unsetenv "$API_KEY_ENV" 2>/dev/null || true',
    );
  }
  common.push(
    '  launchctl kickstart -k "${DOMAIN}/${UNIT}" 2>/dev/null || true',
    'else',
    '  echo "FLIP_WARN: no known service manager; env written, restart the app manually" >&2',
    'fi',
  );
  return common.join("\n");
}

// --- Verification ----------------------------------------------------------

export interface StorageStatusVerification {
  ok: boolean;
  observedMode: string | null;
  apiEnabled: boolean | null;
  reason?: string;
}

/**
 * Parse `<app> storage status --json` output (possibly wrapped in the
 * FLIP_STATUS_BEGIN/END markers) and check it matches the expected mode.
 * Accepts either `api_enabled` or the legacy `remote_enabled` boolean.
 */
export function verifyStorageMode(rawOutput: string, expected: FlipMode): StorageStatusVerification {
  const json = extractStatusJson(rawOutput);
  if (!json) {
    return { ok: false, observedMode: null, apiEnabled: null, reason: "no parseable storage status JSON" };
  }
  const observedMode = typeof json.mode === "string" ? json.mode : null;
  const apiEnabled =
    typeof json.api_enabled === "boolean"
      ? json.api_enabled
      : typeof json.remote_enabled === "boolean"
        ? json.remote_enabled
        : null;
  if (expected === "self_hosted") {
    const ok = observedMode === "self_hosted" && apiEnabled !== false;
    return { ok, observedMode, apiEnabled, reason: ok ? undefined : "expected mode=self_hosted & api_enabled!=false" };
  }
  const ok = observedMode === "local" && apiEnabled !== true;
  return { ok, observedMode, apiEnabled, reason: ok ? undefined : "expected mode=local" };
}

interface StorageStatusJson {
  mode?: unknown;
  api_enabled?: unknown;
  remote_enabled?: unknown;
  [key: string]: unknown;
}

function extractStatusJson(rawOutput: string): StorageStatusJson | null {
  let text = rawOutput;
  const begin = rawOutput.indexOf("FLIP_STATUS_BEGIN");
  const end = rawOutput.indexOf("FLIP_STATUS_END");
  if (begin !== -1 && end !== -1 && end > begin) {
    text = rawOutput.slice(begin + "FLIP_STATUS_BEGIN".length, end);
  }
  const start = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (start === -1 || last === -1 || last <= start) return null;
  try {
    return JSON.parse(text.slice(start, last + 1)) as StorageStatusJson;
  } catch {
    return null;
  }
}

// --- Freeze check (coordination-store cutover gate) ------------------------

/** Minimal shape of the injected remote command runner (see remote.ts). */
export type RunnerFn = (
  machineId: string,
  command: string,
  options?: { timeoutMs?: number },
) => { stdout: string; stderr: string; exitCode: number };

export interface FreezeCheckResult {
  ok: boolean;
  reason?: string;
}

/**
 * Freeze-check hook for coordination-store cutovers.
 *
 * Before flipping a freeze-required app we require an explicit freeze command
 * to succeed (exit 0). Callers supply `freezeCommand` — e.g. a maintenance
 * script that pauses writers / drains the shadow queue to divergence==0. If the
 * app does not require a freeze, this is a no-op pass.
 */
export function runFreezeCheck(
  spec: FlipAppSpec,
  runner: RunnerFn,
  options: { machineId: string; freezeCommand?: string; timeoutMs?: number },
): FreezeCheckResult {
  if (!spec.freezeRequired) return { ok: true };
  if (!options.freezeCommand) {
    return { ok: false, reason: `app "${spec.app}" requires --freeze-check <command> before flip` };
  }
  const res = runner(options.machineId, options.freezeCommand, { timeoutMs: options.timeoutMs ?? 60_000 });
  if (res.exitCode !== 0) {
    return { ok: false, reason: `freeze check failed (exit ${res.exitCode}): ${res.stderr.trim().slice(0, 200)}` };
  }
  return { ok: true };
}

// --- Orchestration ---------------------------------------------------------

export interface FlipMachineResult {
  machineId: string;
  wave: string;
  applied: boolean;
  verification: StorageStatusVerification;
  exitCode: number;
  error?: string;
}

export interface RunFlipOptions {
  spec: FlipAppSpec;
  mode: FlipMode;
  waves: FlipWave[];
  runner: RunnerFn;
  /** When false (default) nothing is executed; the plan is returned. */
  execute?: boolean;
  /** Freeze command required for freeze-required apps. */
  freezeCommand?: string;
  scriptOptions?: BuildScriptOptions;
  timeoutMs?: number;
  /** Abort remaining waves if any machine in a wave fails (default true). */
  stopOnWaveFailure?: boolean;
}

export interface RunFlipReport {
  app: string;
  mode: FlipMode;
  execute: boolean;
  results: FlipMachineResult[];
  aborted: boolean;
  abortReason?: string;
}

/**
 * Execute (or dry-run) the flip wave-by-wave. Verifies each machine's storage
 * status after applying. On any wave failure, halts before the next wave
 * (fail-safe) so a bad canary never cascades to the fleet.
 */
export function runFlip(options: RunFlipOptions): RunFlipReport {
  const { spec, mode, waves, runner } = options;
  const execute = options.execute ?? false;
  const expected: FlipMode = mode;
  const stopOnWaveFailure = options.stopOnWaveFailure ?? true;
  const report: RunFlipReport = { app: spec.app, mode, execute, results: [], aborted: false };

  for (const wave of waves) {
    let waveFailed = false;
    for (const target of wave.targets) {
      // Freeze gate applies per-machine before any mutation (self_hosted only).
      if (execute && mode === "self_hosted" && spec.freezeRequired) {
        const freeze = runFreezeCheck(spec, runner, {
          machineId: target.id,
          freezeCommand: options.freezeCommand,
          timeoutMs: options.timeoutMs,
        });
        if (!freeze.ok) {
          report.results.push({
            machineId: target.id,
            wave: wave.name,
            applied: false,
            verification: { ok: false, observedMode: null, apiEnabled: null, reason: freeze.reason },
            exitCode: -1,
            error: freeze.reason,
          });
          waveFailed = true;
          continue;
        }
      }

      const script = buildFlipScript(spec, mode, options.scriptOptions);
      if (!execute) {
        report.results.push({
          machineId: target.id,
          wave: wave.name,
          applied: false,
          verification: { ok: false, observedMode: null, apiEnabled: null, reason: "dry-run" },
          exitCode: 0,
        });
        continue;
      }

      const res = runner(target.id, script, { timeoutMs: options.timeoutMs ?? 120_000 });
      const verification = verifyStorageMode(res.stdout, expected);
      const ok = res.exitCode === 0 && verification.ok;
      report.results.push({
        machineId: target.id,
        wave: wave.name,
        applied: res.exitCode === 0,
        verification,
        exitCode: res.exitCode,
        error: ok ? undefined : (res.stderr.trim().slice(0, 300) || verification.reason),
      });
      if (!ok) waveFailed = true;
    }
    if (waveFailed && stopOnWaveFailure) {
      report.aborted = true;
      report.abortReason = `wave "${wave.name}" had failures; halting before next wave`;
      break;
    }
  }
  return report;
}

/** Machine-readable plan (no execution) for `flip plan`. */
export interface FlipPlan {
  app: string;
  mode: FlipMode;
  freezeRequired: boolean;
  waves: { name: string; machines: string[] }[];
  scriptPreview: string;
  secretPathsReferenced: string[];
}

export function buildFlipPlan(spec: FlipAppSpec, mode: FlipMode, waves: FlipWave[], scriptOptions?: BuildScriptOptions): FlipPlan {
  return {
    app: spec.app,
    mode,
    freezeRequired: Boolean(spec.freezeRequired),
    waves: waves.map((w) => ({ name: w.name, machines: w.targets.map((t) => t.id) })),
    scriptPreview: buildFlipScript(spec, mode, scriptOptions),
    secretPathsReferenced: mode === "self_hosted" ? [spec.apiKeySecretPath] : [],
  };
}
