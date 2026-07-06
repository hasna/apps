/**
 * Fleet env-flip mechanism.
 *
 * Coordinates flipping an @hasna OSS app's runtime storage mode across the
 * fleet from local (sqlite) to cloud (remote Postgres) — and back — by:
 *   1. writing a per-app fleet env file on each target machine,
 *   2. wiring that env file into the app's service manager (systemd / launchd),
 *   3. restarting the service,
 *   4. verifying `<app> storage status --json` reports the expected mode,
 *   5. supporting one-command revert.
 *
 * SECRETS: the database DSN is NEVER transported in cleartext. The remote
 * script fetches it on the target machine via `secrets get <secretPath>`; the
 * orchestrator only ever handles the secret *path*. Nothing here logs a value.
 *
 * Rollout shape: canary (1 machine) -> batch -> all, with an optional
 * freeze-check hook (used by the todos single-writer cutover) that must pass
 * before any mutation proceeds.
 */

import type { FleetManifest, MachineManifest, MachinePlatform } from "../types.js";

export type FlipMode = "remote" | "local";

/** Per-app fleet-flip profile. Add a new app by adding an entry here. */
export interface FlipAppSpec {
  /** App identifier, e.g. "todos". */
  app: string;
  /** Env var that selects storage mode, e.g. HASNA_TODOS_STORAGE_MODE. */
  modeEnv: string;
  /** Env var carrying the Postgres DSN, e.g. HASNA_TODOS_DATABASE_URL. */
  databaseUrlEnv: string;
  /** Secret PATH (never the value) resolved on-target via `secrets get`. */
  databaseUrlSecretPath: string;
  /** systemd/launchd service unit/label base name, e.g. hasna-todos-mcp. */
  serviceUnit: string;
  /** CLI binary used to read storage status, e.g. "todos". */
  cliBin: string;
  /** Args passed to the CLI to emit redacted JSON storage status. */
  statusArgs: string;
  /**
   * Extra env lines (KEY=VALUE) applied only in remote mode. Values here are
   * non-secret literals only (e.g. shadow flags, bucket names). Never a DSN.
   */
  extraRemoteEnv?: Record<string, string>;
  /**
   * When true this app requires a passing freeze-check before any flip
   * (e.g. todos single-writer cutover). See runFreezeCheck.
   */
  freezeRequired?: boolean;
  /** Human note surfaced in plans/docs. */
  note?: string;
}

/**
 * Canonical per-app flip registry.
 *
 * Secret paths follow the shared convention `hasna/oss/<app>/database-url`.
 * PURE REMOTE (Amendment A1): cloud mode reads+writes hit Postgres directly.
 * The single sanctioned exception is the todos dual-write shadow (async mirror
 * local->cloud, reads local) — modelled via HASNA_TODOS_SHADOW.
 */
export const FLIP_APPS: Record<string, FlipAppSpec> = {
  knowledge: {
    app: "knowledge",
    modeEnv: "HASNA_KNOWLEDGE_STORAGE_MODE",
    databaseUrlEnv: "HASNA_KNOWLEDGE_DATABASE_URL",
    databaseUrlSecretPath: "hasna/oss/knowledge/database-url",
    serviceUnit: "hasna-knowledge-mcp",
    cliBin: "knowledge",
    statusArgs: "storage status --json",
    extraRemoteEnv: { HASNA_KNOWLEDGE_S3_BUCKET: "hasna-oss-knowledge-prod-789877399345" },
    note: "Postgres + S3 object storage (bucket hasna-oss-knowledge-prod-789877399345).",
  },
  mementos: {
    app: "mementos",
    modeEnv: "HASNA_MEMENTOS_STORAGE_MODE",
    databaseUrlEnv: "HASNA_MEMENTOS_DATABASE_URL",
    databaseUrlSecretPath: "hasna/oss/mementos/database-url",
    serviceUnit: "hasna-mementos-mcp",
    cliBin: "mementos",
    statusArgs: "storage status --json",
  },
  loops: {
    app: "loops",
    modeEnv: "HASNA_LOOPS_STORAGE_MODE",
    databaseUrlEnv: "HASNA_LOOPS_DATABASE_URL",
    databaseUrlSecretPath: "hasna/oss/loops/database-url",
    serviceUnit: "hasna-loops-mcp",
    cliBin: "loops",
    statusArgs: "storage status --json",
  },
  conversations: {
    app: "conversations",
    modeEnv: "HASNA_CONVERSATIONS_STORAGE_MODE",
    databaseUrlEnv: "HASNA_CONVERSATIONS_DATABASE_URL",
    databaseUrlSecretPath: "hasna/oss/conversations/database-url",
    serviceUnit: "hasna-conversations-mcp",
    cliBin: "conversations",
    statusArgs: "storage status --json",
  },
  todos: {
    app: "todos",
    modeEnv: "HASNA_TODOS_STORAGE_MODE",
    databaseUrlEnv: "HASNA_TODOS_DATABASE_URL",
    databaseUrlSecretPath: "hasna/oss/todos/database-url",
    serviceUnit: "hasna-todos-mcp",
    cliBin: "todos",
    statusArgs: "storage status --json",
    // Sanctioned dual-write shadow: async mirror local->cloud, reads stay local
    // until the single-writer cutover. The cutover flips mode to remote and is
    // gated by a freeze-check.
    extraRemoteEnv: { HASNA_TODOS_SHADOW: "1" },
    freezeRequired: true,
    note: "Dual-write shadow first; single-writer cutover to remote is freeze-gated.",
  },
};

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
}

/**
 * Split ordered targets into canary -> batch(es). The final batch is the
 * remainder ("all"). Guarantees: canary is first, every target appears once,
 * order preserved.
 */
export function planWaves(targets: FlipTarget[], options: PlanWavesOptions = {}): FlipWave[] {
  const canarySize = Math.max(0, options.canarySize ?? 1);
  const batchSize = Math.max(1, options.batchSize ?? 4);
  const waves: FlipWave[] = [];
  let cursor = 0;
  if (targets.length === 0) return waves;
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
 * Build the remote bash script that applies (mode="remote") or reverts
 * (mode="local") the flip for one app on one machine.
 *
 * The DSN is fetched on-target from the secret store; it never appears in the
 * script text, argv, or orchestrator logs. The env file is written 0600.
 */
export function buildFlipScript(spec: FlipAppSpec, mode: FlipMode, options: BuildScriptOptions = {}): string {
  const envDir = options.envDir ?? "${HOME}/.hasna/cloud";
  const envFile = `${envDir}/${spec.app}.env`;
  const lines: string[] = [
    "set -euo pipefail",
    `APP=${sq(spec.app)}`,
    `ENV_DIR="${envDir}"`,
    `ENV_FILE="${envDir}/${spec.app}.env"`,
    'mkdir -p "$ENV_DIR"',
    "umask 077",
  ];

  if (mode === "remote") {
    // Fetch DSN on-target; abort if the secret is missing (never write a
    // half-configured remote env file).
    lines.push(
      `DSN="$(secrets get ${sq(spec.databaseUrlSecretPath)} --raw 2>/dev/null || secrets get ${sq(spec.databaseUrlSecretPath)} 2>/dev/null)"`,
      'if [ -z "${DSN:-}" ]; then echo "FLIP_ERROR: could not resolve DSN secret" >&2; exit 3; fi',
      'TMP_ENV="$(mktemp "${ENV_DIR}/.${APP}.env.XXXXXX")"',
      `printf '%s\\n' ${sq(`${spec.modeEnv}=remote`)} >> "$TMP_ENV"`,
      `printf '%s=%s\\n' ${sq(spec.databaseUrlEnv)} "$DSN" >> "$TMP_ENV"`,
    );
    for (const [key, value] of Object.entries(spec.extraRemoteEnv ?? {})) {
      lines.push(`printf '%s\\n' ${sq(`${key}=${value}`)} >> "$TMP_ENV"`);
    }
    lines.push('chmod 600 "$TMP_ENV"', 'mv -f "$TMP_ENV" "$ENV_FILE"', 'unset DSN');
  } else {
    // Revert: pin local mode, drop the DSN entirely.
    lines.push(
      'TMP_ENV="$(mktemp "${ENV_DIR}/.${APP}.env.XXXXXX")"',
      `printf '%s\\n' ${sq(`${spec.modeEnv}=local`)} >> "$TMP_ENV"`,
      'chmod 600 "$TMP_ENV"',
      'mv -f "$TMP_ENV" "$ENV_FILE"',
    );
  }

  // Wire the env file into the service manager and (re)start, unless skipped.
  if (!options.skipRestart) {
    lines.push(buildServiceWiring(spec));
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
 * Portable service-manager wiring: systemd (linux) via a drop-in EnvironmentFile,
 * launchd (macOS) by injecting the env file reference and kickstarting the label.
 * Detection is at runtime on the target so one script serves the mixed fleet.
 */
function buildServiceWiring(spec: FlipAppSpec): string {
  const unit = spec.serviceUnit;
  return [
    `UNIT=${sq(unit)}`,
    'ENV_FILE_ABS="$ENV_FILE"',
    'if command -v systemctl >/dev/null 2>&1; then',
    '  DROPIN_DIR="${HOME}/.config/systemd/user/${UNIT}.service.d"',
    '  mkdir -p "$DROPIN_DIR"',
    '  {',
    '    echo "[Service]"',
    '    echo "EnvironmentFile=${ENV_FILE_ABS}"',
    '  } > "${DROPIN_DIR}/10-cloud-flip.conf"',
    '  systemctl --user daemon-reload',
    '  systemctl --user restart "${UNIT}" || systemctl --user restart "${UNIT}.service"',
    'elif command -v launchctl >/dev/null 2>&1; then',
    '  # macOS: source the env file into the user launchd domain, then restart.',
    '  set -a; . "${ENV_FILE_ABS}"; set +a',
    '  DOMAIN="gui/$(id -u)"',
    '  while IFS="=" read -r k v; do [ -n "$k" ] && launchctl setenv "$k" "$v"; done < "${ENV_FILE_ABS}"',
    '  launchctl kickstart -k "${DOMAIN}/${UNIT}" 2>/dev/null || true',
    'else',
    '  echo "FLIP_WARN: no known service manager; env written, restart the app manually" >&2',
    'fi',
  ].join("\n");
}

// --- Verification ----------------------------------------------------------

export interface StorageStatusVerification {
  ok: boolean;
  observedMode: string | null;
  remoteEnabled: boolean | null;
  reason?: string;
}

/**
 * Parse `<app> storage status --json` output (possibly wrapped in the
 * FLIP_STATUS_BEGIN/END markers) and check it matches the expected mode.
 */
export function verifyStorageMode(rawOutput: string, expected: FlipMode): StorageStatusVerification {
  const json = extractStatusJson(rawOutput);
  if (!json) {
    return { ok: false, observedMode: null, remoteEnabled: null, reason: "no parseable storage status JSON" };
  }
  const observedMode = typeof json.mode === "string" ? json.mode : null;
  const remoteEnabled = typeof json.remote_enabled === "boolean" ? json.remote_enabled : null;
  if (expected === "remote") {
    const ok = observedMode === "remote" && remoteEnabled === true;
    return { ok, observedMode, remoteEnabled, reason: ok ? undefined : "expected mode=remote & remote_enabled=true" };
  }
  const ok = observedMode === "local" && remoteEnabled !== true;
  return { ok, observedMode, remoteEnabled, reason: ok ? undefined : "expected mode=local" };
}

interface StorageStatusJson {
  mode?: unknown;
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

// --- Freeze check (single-writer cutover gate) -----------------------------

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
 * Freeze-check hook for the todos single-writer cutover.
 *
 * Before flipping a freeze-required app we require an explicit freeze command
 * to succeed (exit 0). Callers supply `freezeCommand` — e.g. a maintenance
 * script that pauses writers / drains the shadow queue. If the app does not
 * require a freeze, this is a no-op pass.
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
      // Freeze gate applies per-machine before any mutation (remote flips only).
      if (execute && mode === "remote" && spec.freezeRequired) {
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
            verification: { ok: false, observedMode: null, remoteEnabled: null, reason: freeze.reason },
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
          verification: { ok: false, observedMode: null, remoteEnabled: null, reason: "dry-run" },
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
    secretPathsReferenced: mode === "remote" ? [spec.databaseUrlSecretPath] : [],
  };
}
