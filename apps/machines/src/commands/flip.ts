/**
 * Fleet env-flip mechanism (local store <-> hosted API client).
 *
 * Coordinates flipping an @hasna OSS app's client backend across the
 * fleet from local (on-box sqlite/json) to **api** (the app's hosted
 * API at https://<app>.<fleet-domain>) — and back — by:
 *   1. writing a per-app fleet env file on each target machine,
 *   2. wiring that env file into the app's service manager (systemd / launchd),
 *   3. restarting the service,
 *   4. verifying `<app> storage status --json` reports the expected mode,
 *   5. supporting one-command revert (unset the two vars -> local original).
 *
 * ARCHITECTURE (LOCKED): the only sanctioned cloud path for a CLIENT machine is
 * the app HTTPS API — client -> https://<app>.<fleet-domain>/v1 with a bearer
 * `HASNA_<APP>_API_KEY`. The raw RDS DSN is NEVER distributed to machines and
 * `STORAGE_MODE=remote` + `DATABASE_URL` is FORBIDDEN on clients. RDS is only
 * reachable by the in-VPC ECS services + the admin tunnel. This module therefore
 * writes exactly two vars per app:
 *     HASNA_<APP>_API_URL=https://<app>.<fleet-domain>
 *     HASNA_<APP>_API_KEY=<key from Secrets Manager hasna/oss/<app>/api-key>
 *
 * The `<fleet-domain>` is REQUIRED for a real deployment: set
 * `HASNA_FLEET_API_DOMAIN` to the operator's own private root domain before
 * running this for real. This published package never bakes in a real
 * internal hostname — absent that env var it falls back to a neutral,
 * non-resolving placeholder domain.
 *
 * SECRETS: the API key is NEVER transported in cleartext by the orchestrator.
 * The remote script fetches it on the target machine via `secrets exec`; the
 * orchestrator only ever handles the secret *path*. Nothing here logs a value
 * or captures it from stdout.
 *
 * Rollout shape: canary (1 machine) -> batch -> all, OR a single atomic wave via
 * `--all-machines` (used by the coordination-store cutover so machines flip
 * together, never half-flipped / split-brain). An optional freeze-check hook
 * (coordination stores) must pass before any mutation proceeds.
 */

import type { FleetManifest, MachinePlatform } from "../types.js";
import { buildSecretsExecShell } from "../child-env.js";

export type FlipMode = "api" | "local";

/** Retired deployment-mode words: rejected loudly, never remapped. */
const RETIRED_FLIP_MODE_WORDS = new Set(["self_hosted", "self-hosted", "remote", "hybrid"]);

/** Normalize user-facing mode aliases to the canonical FlipMode. */
export function normalizeFlipMode(value?: string): FlipMode {
  const v = (value ?? "api").trim().toLowerCase();
  if (v === "local" || v === "revert" || v === "off") return "local";
  if (RETIRED_FLIP_MODE_WORDS.has(v)) {
    // Deployment modes were removed (owner directive 2026-07-29). Remapping
    // the old word would keep it alive in every operator's muscle memory.
    throw new Error(
      `"${value}" is a retired deployment-mode word. Use --mode api (route the client to the hosted API) or --mode local (revert to the on-box store).`,
    );
  }
  // cloud/api/on all mean the sanctioned hosted-API client mode.
  return "api";
}

/** Per-app fleet-flip profile. Add a new app by adding an entry here. */
export interface FlipAppSpec {
  /** App identifier, e.g. "todos". */
  app: string;
  /** Env var carrying the app API base URL, e.g. HASNA_TODOS_API_URL. */
  apiUrlEnv: string;
  /** Env var carrying the app API bearer key, e.g. HASNA_TODOS_API_KEY. */
  apiKeyEnv: string;
  /** App API base URL, e.g. https://todos.<fleet-domain> (client appends /v1). */
  apiUrl: string;
  /** Secret PATH (never the value) resolved on-target via `secrets exec`. */
  apiKeySecretPath: string;
  /** systemd/launchd service unit/label base name, e.g. hasna-todos-mcp. */
  serviceUnit: string;
  /** CLI binary used to read storage status, e.g. "todos". */
  cliBin: string;
  /** Args passed to the CLI to emit redacted JSON storage status. */
  statusArgs: string;
  /**
   * Extra env lines (KEY=VALUE) applied only in api mode. Values here
   * are non-secret literals only (e.g. shadow flags). Never a secret/DSN.
   */
  extraApiEnv?: Record<string, string>;
  /**
   * When true this app requires a passing freeze-check before any flip
   * (coordination stores: drain the dual-write shadow to divergence==0 before
   * the atomic cutover). See runFreezeCheck.
   */
  freezeRequired?: boolean;
  /**
   * When true the credential is a Vault POINTER consumed by the app's own CLI:
   * the generated script writes `${apiKeyEnv}=${apiKeySecretPath}` (the
   * pointer — a non-secret path) into the fleet env file instead of fetching
   * the secret value on-target and materialising a literal key. Use for apps
   * whose consumer contract resolves a stored secret pointer itself (emails
   * resolves EMAILS_CLIENT_ENV_SECRET through `secrets` at runtime).
   */
  keyViaSecretPointer?: boolean;
  /**
   * Env keys the provisioned fleet env file MUST carry after an api-mode
   * write, verified ON the target machine before the file becomes the
   * provisioned state. Defaults to [apiUrlEnv, apiKeyEnv] — the effective
   * pair every app's script writes. A provision that would leave a reduced
   * env file aborts with FLIP_ERROR (exit 3) instead of starting a session
   * whose CLIs silently fall back to empty local stores (incident 715712:
   * a harness session-env re-provision dropped the hosted API env for
   * TODOS/KNOWLEDGE/EMAILS and the CLIs served false-empty SQLite at rc=0).
   */
  clientEnvRequiredKeys?: readonly string[];
  /**
   * Dotted JSON path to the reported mode string inside the app's
   * `<cliBin> <statusArgs>` payload. Default "mode" (all generic apps).
   * Emails reports its mode at `mode.current`.
   */
  verifyModePath?: string;
  /** Human note surfaced in plans/docs. */
  note?: string;
}

/**
 * All 25 @hasna OSS apps that expose a hosted API at <app>.<fleet-domain>.
 * Coordination hot stores are freeze-gated (drain shadow before atomic flip).
 *
 * "mailery" was retired from this list 2026-08-19: Mailery is a separate,
 * unrelated SaaS product and never exposed a hosted API on the client flips
 * route, so keeping it registered would let `machines flip mailery` attempt to
 * route a dead host. It is replaced by "emails" (the hosted mailbox app), whose
 * consumer contract and deployment profile are covered by an explicit per-app
 * override below.
 */
const ALL_APPS = [
  "accounts",
  "attachments",
  "calendar",
  "contacts",
  "conversations",
  "domains",
  "economy",
  "emails",
  "files",
  "identities",
  "instructions",
  "knowledge",
  "logs",
  "loops",
  "machines",
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
 * to api must be preceded by a passing freeze-check (drain shadow to
 * divergence==0) so machines never split-brain.
 */
const FREEZE_REQUIRED_APPS = new Set(["todos", "loops", "mementos", "conversations"]);

/**
 * Per-app profile overrides for apps whose consumer contracts deviate from the
 * generic HASNA_<APP>_API_URL / HASNA_<APP>_API_KEY conventions.
 *
 * Emails is the one real case. The `emails` CLI does NOT read
 * HASNA_EMAILS_API_URL / HASNA_EMAILS_API_KEY: it routes to the hosted API via
 * EMAILS_SELF_HOSTED_URL plus EMAILS_CLIENT_ENV_SECRET — a Vault POINTER the
 * CLI resolves itself (`secrets get <path>`) at runtime — or a literal
 * EMAILS_SELF_HOSTED_API_KEY. We therefore pin the URL env to
 * EMAILS_SELF_HOSTED_URL and treat the credential as a Vault pointer
 * (keyViaSecretPointer), so no literal key is ever materialised into the fleet
 * env file; the apiUrl keeps the generic https://emails.<fleet-domain> shape.
 * The service unit on the fleet is hasna-emails-mcp and its status reports the
 * runtime mode at `mode.current` (e.g. "self_hosted"), not `mode`/api_enabled.
 */
const APP_SPEC_OVERRIDES: Record<string, Partial<FlipAppSpec>> = {
  emails: {
    apiUrlEnv: "EMAILS_SELF_HOSTED_URL",
    apiKeyEnv: "EMAILS_CLIENT_ENV_SECRET",
    apiKeySecretPath: "hasna/xyz/opensource/emails/live/client-env",
    serviceUnit: "hasna-emails-mcp",
    cliBin: "emails",
    statusArgs: "status --json",
    verifyModePath: "mode.current",
    keyViaSecretPointer: true,
    note: "Emails routes via EMAILS_SELF_HOSTED_URL + EMAILS_CLIENT_ENV_SECRET (Vault pointer resolved by the emails CLI; no literal key is written).",
  },
};

/** Per-app non-secret env overlays applied only in api mode. */
const EXTRA_API_ENV: Record<string, Record<string, string>> = {};

/**
 * Fleet API domain suffix used to build each app's default hosted-API URL.
 * REQUIRED for a real deployment: set `HASNA_FLEET_API_DOMAIN` to the
 * operator's own private root domain before running fleet-flip for real. This
 * published package never bakes in a real internal hostname — absent that env
 * var, it falls back to a neutral, non-resolving placeholder domain.
 */
const FLEET_API_DOMAIN = process.env.HASNA_FLEET_API_DOMAIN?.trim() || "your-deployment.example";

function defineFlipApp(app: string): FlipAppSpec {
  const UP = app.toUpperCase();
  const spec: FlipAppSpec = {
    app,
    apiUrlEnv: `HASNA_${UP}_API_URL`,
    apiKeyEnv: `HASNA_${UP}_API_KEY`,
    apiUrl: `https://${app}.${FLEET_API_DOMAIN}`,
    apiKeySecretPath: `hasna/oss/${app}/api-key`,
    serviceUnit: `hasna-${app}-mcp`,
    cliBin: app,
    statusArgs: "storage status --json",
  };
  if (FREEZE_REQUIRED_APPS.has(app)) {
    spec.freezeRequired = true;
    spec.note = "Coordination store: drain dual-write shadow to divergence==0, then atomic --all-machines cutover.";
  }
  const override = APP_SPEC_OVERRIDES[app];
  if (override) Object.assign(spec, override);
  const extra = EXTRA_API_ENV[app];
  if (extra) spec.extraApiEnv = extra;
  return spec;
}

/**
 * Canonical per-app flip registry — ALL 25 @hasna OSS apps.
 *
 * Secret paths follow the shared convention `hasna/oss/<app>/api-key`.
 * LOCKED: the client talks to the app's HTTPS API; no DSN ever
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
  /** Override the fleet env dir (default $HOME/.hasna/fleet-env). */
  envDir?: string;
  /** Skip the service restart (env written but not activated). */
  skipRestart?: boolean;
}

/**
 * Bash lines that abort (FLIP_ERROR, exit 3) when the freshly written env
 * file is missing any key of the app's required per-app env contract.
 *
 * Incident 715712: a harness session-env re-provision dropped the hosted API
 * env and the CLIs silently fell back to empty on-box SQLite stores (false
 * empty reads at rc=0). The verification runs against the TEMP file BEFORE
 * it is moved into place, so a reduced env can never become the provisioned
 * state — every provision either restores the full hosted API env contract
 * or fails loudly before the session starts.
 */
function buildEnvContractVerification(spec: FlipAppSpec): string[] {
  const requiredKeys = spec.clientEnvRequiredKeys ?? [spec.apiUrlEnv, spec.apiKeyEnv];
  return [
    "set -eu",
    "for REQUIRED_KEY in " + requiredKeys.map((k) => sq(k)).join(" ") + "; do",
    '  grep -q "^${REQUIRED_KEY}=" "$TMP_ENV" || { echo "FLIP_ERROR: provisioned env is missing required key ${REQUIRED_KEY}; refusing to start with a reduced env (hosted API vars must be restored on every provision)" >&2; exit 3; }',
    "done",
  ];
}

/**
 * Build the remote bash script that applies (mode="api") or reverts
 * (mode="local") the flip for one app on one machine.
 *
 * The API key is fetched on-target from the secret store; it never appears in
 * the script text, argv, or orchestrator logs. The env file is written 0600.
 * Revert removes the env file and the service drop-in entirely so the two vars
 * are fully unset and the app falls back to its untouched local original.
 */
export function buildFlipScript(spec: FlipAppSpec, mode: FlipMode, options: BuildScriptOptions = {}): string {
  const envDir = options.envDir ?? "${HOME}/.hasna/fleet-env";
  const lines: string[] = [
    "set -euo pipefail",
    `APP=${sq(spec.app)}`,
    `ENV_DIR="${envDir}"`,
    `ENV_FILE="${envDir}/${spec.app}.env"`,
    'mkdir -p "$ENV_DIR"',
    "umask 077",
  ];

  if (mode === "api") {
    if (spec.keyViaSecretPointer) {
      // The app resolves the credential itself from a Vault pointer, so the
      // env file carries the URL plus the non-secret pointer — no secret is
      // fetched on-target and no literal key is ever materialised.
      const pointerLines = [
        "set -eu",
        'TMP_ENV="$(mktemp "${ENV_DIR}/.${APP}.env.XXXXXX")"',
        'trap \'rm -f "$TMP_ENV"\' EXIT',
        `printf '%s\\n' ${sq(`${spec.apiUrlEnv}=${spec.apiUrl}`)} >> "$TMP_ENV"`,
        `printf '%s\\n' ${sq(`${spec.apiKeyEnv}=${spec.apiKeySecretPath}`)} >> "$TMP_ENV"`,
      ];
      for (const [key, value] of Object.entries(spec.extraApiEnv ?? {})) {
        pointerLines.push(`printf '%s\\n' ${sq(`${key}=${value}`)} >> "$TMP_ENV"`);
      }
      pointerLines.push(...buildEnvContractVerification(spec));
      pointerLines.push(
        'chmod 600 "$TMP_ENV"',
        'mv -f "$TMP_ENV" "$ENV_FILE"',
        // Sterile probe: report the sha256 of the file the flip ACTUALLY wrote,
        // so the orchestrator's ledger can prove the new file supplied the
        // connection without any credential value crossing the wire.
        'S="$(sha256sum "$ENV_FILE")"; echo "FLIP_SHA256=${S%% *}"',
      );
      lines.push("export APP ENV_DIR ENV_FILE", pointerLines.join("\n"));
    } else {
      // Fetch the API key on-target into the child environment; abort if the
      // secret is missing or empty before writing any fleet env file.
      const writeEnvLines = [
        "set -eu",
        'if [ -z "${API_KEY:-}" ]; then echo "FLIP_ERROR: could not resolve API key secret" >&2; exit 3; fi',
        'TMP_ENV="$(mktemp "${ENV_DIR}/.${APP}.env.XXXXXX")"',
        'trap \'rm -f "$TMP_ENV"\' EXIT',
        `printf '%s\\n' ${sq(`${spec.apiUrlEnv}=${spec.apiUrl}`)} >> "$TMP_ENV"`,
        `printf '%s=%s\\n' ${sq(spec.apiKeyEnv)} "$API_KEY" >> "$TMP_ENV"`,
      ];
      for (const [key, value] of Object.entries(spec.extraApiEnv ?? {})) {
        writeEnvLines.push(`printf '%s\\n' ${sq(`${key}=${value}`)} >> "$TMP_ENV"`);
      }
      writeEnvLines.push(...buildEnvContractVerification(spec));
      writeEnvLines.push(
        'chmod 600 "$TMP_ENV"',
        'mv -f "$TMP_ENV" "$ENV_FILE"',
        // Sterile probe: report the sha256 of the file the flip ACTUALLY wrote.
        'S="$(sha256sum "$ENV_FILE")"; echo "FLIP_SHA256=${S%% *}"',
      );
      lines.push(
        "export APP ENV_DIR ENV_FILE",
        buildSecretsExecShell(spec.apiKeySecretPath, "API_KEY", writeEnvLines.join("\n")),
      );
    }
  } else {
    // Revert: remove the fleet env file entirely so ${apiUrlEnv} and
    // ${apiKeyEnv} are unset and the app returns to its local original.
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
 *  - systemd (linux): api mode writes a drop-in EnvironmentFile; local
 *    removes that drop-in so the vars are gone.
 *  - launchd (macOS): api mode setenv's each var from the env file; local
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
  if (mode === "api") {
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
  if (mode === "api") {
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
  /** Result of the provenance gates (P1-C): ok only when the new fleet-env file supplied the connection. */
  provenanceOk?: boolean;
  /** The source the app reported for its API key (absolute path or env key), or null. Never a value. */
  apiKeySource?: string | null;
  /** The source the app reported for its API URL, or null. Never a value. */
  apiUrlSource?: string | null;
  /** The credential tier the app reported (e.g. fleet-env / legacy-cloud / legacy-env), or null. */
  apiKeyTier?: string | null;
  /** The source that proved the new file supplied the connection. */
  sourceOfValue?: string | null;
  /** sha256 of the env file the flip wrote (from the FLIP_SHA256 marker), or null. */
  envSha256?: string | null;
}

/** Match a source that names a file under the legacy cloud dir. */
const LEGACY_CLOUD_SOURCE = /\/\.hasna\/cloud\//;

/** Extract the sha256 the flip script reported for the env file it wrote. */
export function extractFlipSha256(rawOutput: string): string | null {
  const match = rawOutput.match(/FLIP_SHA256=([0-9a-f]{64})/);
  return match ? match[1] : null;
}

/**
 * Provenance gates for a flip (P1-C, review P0-3 / Sol 5).
 *
 * The flip must PROVE the freshly written fleet-env file supplied the
 * connection, not merely that required vars exist and the app reports api
 * mode. When the app's status JSON reports the credential resolution fields
 * (`apiKeyTier` / `apiUrlSource` / `apiKeySource`, the `@hasna/contracts`
 * client-transport fields), this verifies them and rejects:
 *
 *   1. `apiKeyTier === "legacy-env"` — the key came from a process env var,
 *      not the fleet file;
 *   2. a `transportSource`/`apiUrlSource`/`apiKeySource` that names a file
 *      under `~/.hasna/cloud` — the app is still resolving from the legacy
 *      cloud dir;
 *   3. api mode whose exact source cannot be reported — api-backed mode with
 *      no reportable source fields (or a tier that is not a fleet/disk tier).
 *
 * Positive case: the reported key/URL source is the fleet-env file the flip
 * just wrote (matched on its `/fleet-env/<app>.env` suffix so any HOME
 * resolves), which proves the new file supplied the connection.
 */
export function verifyFlipProvenance(
  rawOutput: string,
  spec: FlipAppSpec,
  expected: FlipMode,
  options: { expectedEnvFile?: string } = {},
): Pick<StorageStatusVerification, "provenanceOk" | "apiKeySource" | "apiUrlSource" | "apiKeyTier" | "sourceOfValue" | "envSha256" | "reason"> {
  const envSha256 = extractFlipSha256(rawOutput);
  const json = extractStatusJson(rawOutput);
  const apiKeySource = typeof json?.apiKeySource === "string" ? json.apiKeySource : null;
  const apiUrlSource = typeof json?.apiUrlSource === "string" ? json.apiUrlSource : null;
  const transportSource = typeof json?.transportSource === "string" ? json.transportSource : null;
  const apiKeyTier = typeof json?.apiKeyTier === "string" ? json.apiKeyTier : null;

  // Revert (local) mode: the env file was removed; there is no connection
  // source to prove. The gates apply to api mode only.
  if (expected !== "api") {
    return { provenanceOk: true, apiKeySource, apiUrlSource, apiKeyTier, sourceOfValue: null, envSha256 };
  }

  const fleetEnvSuffix = `/fleet-env/${spec.app}.env`;
  const expectedSource = options.expectedEnvFile?.endsWith(fleetEnvSuffix)
    ? options.expectedEnvFile
    : fleetEnvSuffix;

  // Gate 1: legacy process-env tier.
  if (apiKeyTier === "legacy-env") {
    return {
      provenanceOk: false,
      apiKeySource,
      apiUrlSource,
      apiKeyTier,
      sourceOfValue: null,
      envSha256,
      reason: `provenance gate rejected: app '${spec.app}' resolved its API key from the legacy process env (apiKeyTier=legacy-env), not from the fleet file`,
    };
  }
  // Gate 2: any source under the legacy cloud dir.
  for (const [label, src] of [
    ["transportSource", transportSource],
    ["apiUrlSource", apiUrlSource],
    ["apiKeySource", apiKeySource],
  ] as const) {
    if (src && LEGACY_CLOUD_SOURCE.test(src)) {
      return {
        provenanceOk: false,
        apiKeySource,
        apiUrlSource,
        apiKeyTier,
        sourceOfValue: null,
        envSha256,
        reason: `provenance gate rejected: app '${spec.app}' reports ${label}=${src}, a legacy ~/.hasna/cloud source; the flip must move it to ${fleetEnvSuffix}`,
      };
    }
  }
  // Gate 3: api mode whose exact source cannot be reported.
  const keySourceIsFleet = apiKeySource !== null && (apiKeySource === expectedSource || apiKeySource.endsWith(fleetEnvSuffix));
  const urlSourceIsFleet = apiUrlSource !== null && (apiUrlSource === expectedSource || apiUrlSource.endsWith(fleetEnvSuffix));
  const tierIsFleet = apiKeyTier !== null && apiKeyTier !== "legacy-env" && apiKeyTier !== "legacy-cloud" && apiKeyTier !== "config-legacy";
  if (!keySourceIsFleet || !tierIsFleet) {
    const reported = [
      apiKeyTier ? `apiKeyTier=${apiKeyTier}` : null,
      apiKeySource ? `apiKeySource=${apiKeySource}` : null,
      apiUrlSource ? `apiUrlSource=${apiUrlSource}` : null,
    ]
      .filter(Boolean)
      .join(", ") || "no source fields reported";
    return {
      provenanceOk: false,
      apiKeySource,
      apiUrlSource,
      apiKeyTier,
      sourceOfValue: null,
      envSha256,
      reason:
        `provenance gate rejected: app '${spec.app}' reports api mode but its exact source cannot be confirmed ` +
        `(reported ${reported}); the new fleet file (${fleetEnvSuffix}) must supply the connection before the flip is ok`,
    };
  }
  return {
    provenanceOk: true,
    apiKeySource,
    apiUrlSource,
    apiKeyTier,
    sourceOfValue: keySourceIsFleet ? apiKeySource : null,
    envSha256,
  };
}

/**
 * Parse `<app> storage status --json` output (possibly wrapped in the
 * FLIP_STATUS_BEGIN/END markers) and check it matches the expected mode.
 * Accepts either `api_enabled` or the legacy `remote_enabled` boolean.
 *
 * Read-side compat: the fleet updates in waves, so a not-yet-updated app may
 * still REPORT a retired mode word (e.g. `self_hosted`) in its status JSON.
 * Any non-local reported mode counts as api-backed; this code never emits the
 * retired words itself.
 */
export function verifyStorageMode(rawOutput: string, expected: FlipMode, spec?: FlipAppSpec): StorageStatusVerification {
  const json = extractStatusJson(rawOutput);
  if (!json) {
    return { ok: false, observedMode: null, apiEnabled: null, reason: "no parseable storage status JSON" };
  }
  const rawMode = readJsonPath(json, spec?.verifyModePath ?? "mode");
  const observedMode = typeof rawMode === "string" ? rawMode : null;
  let apiEnabled =
    typeof json.api_enabled === "boolean"
      ? json.api_enabled
      : typeof json.remote_enabled === "boolean"
        ? json.remote_enabled
        : null;
  if (apiEnabled === null && spec?.verifyModePath && observedMode !== null) {
    // Apps without an api_enabled boolean (emails reports mode.current only)
    // treat any non-local reported mode as api-backed.
    apiEnabled = observedMode !== "local";
  }
  if (expected === "api") {
    const ok = observedMode !== null && observedMode !== "local" && apiEnabled !== false;
    return { ok, observedMode, apiEnabled, reason: ok ? undefined : "expected an api-backed mode & api_enabled!=false" };
  }
  const ok = observedMode === "local" && apiEnabled !== true;
  return { ok, observedMode, apiEnabled, reason: ok ? undefined : "expected mode=local" };
}

/** Read a dotted JSON path (e.g. "mode.current"); undefined when absent. */
function readJsonPath(obj: unknown, path: string): unknown {
  if (!path) return undefined;
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc === null || acc === undefined || typeof acc !== "object") return undefined;
    return (acc as Record<string, unknown>)[key];
  }, obj);
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

/** One row of the per-run flip ledger (P1-C). No credential values, ever. */
export interface FlipLedgerEntry {
  ts: string;
  machine: string;
  app: string;
  wave: string;
  mode: FlipMode;
  /** dry-run | ok | FAIL */
  result: string;
  /** The source that supplied the connection (fleet-env file path) or null. */
  sourceOfValue: string | null;
  /** sha256 of the fleet env file the flip wrote, or null (dry-run / revert). */
  envSha256: string | null;
  /** Provenance gate verdict. */
  provenanceOk: boolean;
}

/** Ledger sink, injectable for tests and CLI `--ledger` overrides. */
export type FlipLedgerWriter = (entries: FlipLedgerEntry[]) => void;

/** Default no-op ledger sink — the CLI wires the file writer. */
export const NOOP_LEDGER_WRITER: FlipLedgerWriter = () => {};

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
  /** Ledger sink; defaults to NOOP (the CLI wires the file writer). */
  ledger?: FlipLedgerWriter;
}

export interface RunFlipReport {
  app: string;
  mode: FlipMode;
  execute: boolean;
  results: FlipMachineResult[];
  aborted: boolean;
  abortReason?: string;
  /** Per-run ledger rows (P1-C): machine, app, ts, result, source-of-value, sha256. */
  ledger: FlipLedgerEntry[];
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
  const ledger: FlipLedgerEntry[] = [];
  const report: RunFlipReport = { app: spec.app, mode, execute, results: [], aborted: false, ledger };
  const expectedEnvFile = options.scriptOptions?.envDir
    ? `${options.scriptOptions.envDir}/${spec.app}.env`
    : undefined;

  for (const wave of waves) {
    let waveFailed = false;
    for (const target of wave.targets) {
      const pushLedger = (entry: Omit<FlipLedgerEntry, "ts" | "machine" | "app" | "wave" | "mode">) => {
        ledger.push({
          ts: new Date().toISOString(),
          machine: target.id,
          app: spec.app,
          wave: wave.name,
          mode,
          ...entry,
        });
      };

      // Freeze gate applies per-machine before any mutation (api mode only).
      if (execute && mode === "api" && spec.freezeRequired) {
        const freeze = runFreezeCheck(spec, runner, {
          machineId: target.id,
          freezeCommand: options.freezeCommand,
          timeoutMs: options.timeoutMs,
        });
        if (!freeze.ok) {
          const verification: StorageStatusVerification = { ok: false, observedMode: null, apiEnabled: null, reason: freeze.reason };
          report.results.push({
            machineId: target.id,
            wave: wave.name,
            applied: false,
            verification,
            exitCode: -1,
            error: freeze.reason,
          });
          pushLedger({ result: "FAIL", sourceOfValue: null, envSha256: null, provenanceOk: false });
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
        // Dry-run still shows the ledger row (source + provenance plan), so an
        // operator can see exactly what an execute would record. No file is
        // written and no hash exists yet.
        pushLedger({
          result: "dry-run",
          sourceOfValue: expectedEnvFile ?? `$HOME/.hasna/fleet-env/${spec.app}.env (planned)`,
          envSha256: null,
          provenanceOk: false,
        });
        continue;
      }

      const res = runner(target.id, script, { timeoutMs: options.timeoutMs ?? 120_000 });
      const verification = verifyStorageMode(res.stdout, expected, spec);
      const provenance = verifyFlipProvenance(res.stdout, spec, expected, { expectedEnvFile });
      // The provenance gates are mandatory in api mode: mode-ok alone is not a
      // pass (P1-C, P0-3). Revert (local) has no connection source to prove.
      const provenanceGate = mode === "api" ? (provenance.provenanceOk ?? false) : true;
      const ok = res.exitCode === 0 && verification.ok && provenanceGate;
      const combinedVerification: StorageStatusVerification = {
        ...verification,
        ...provenance,
        ok: verification.ok && provenanceGate,
        reason: !verification.ok ? verification.reason : !provenanceGate ? provenance.reason : undefined,
      };
      report.results.push({
        machineId: target.id,
        wave: wave.name,
        applied: res.exitCode === 0,
        verification: combinedVerification,
        exitCode: res.exitCode,
        error: ok ? undefined : (res.stderr.trim().slice(0, 300) || combinedVerification.reason),
      });
      pushLedger({
        result: ok ? "ok" : "FAIL",
        sourceOfValue: combinedVerification.sourceOfValue ?? null,
        envSha256: combinedVerification.envSha256 ?? null,
        provenanceOk: provenanceGate,
      });
      if (!ok) waveFailed = true;
    }
    if (waveFailed && stopOnWaveFailure) {
      report.aborted = true;
      report.abortReason = `wave "${wave.name}" had failures; halting before next wave`;
      break;
    }
  }
  // Write the ledger only for a real run — a dry-run must not mutate state,
  // though its rows are returned so `flip apply --dry-run` can display them.
  if (execute) options.ledger?.(ledger);
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
    secretPathsReferenced: mode === "api" ? [spec.apiKeySecretPath] : [],
  };
}
