#!/usr/bin/env bun
/**
 * distribute-cloud-keys.ts — spark01-side fleet API-key / cloud-env distributor.
 *
 * WHY THIS EXISTS
 * ---------------
 * The fleet self-host flip (`machines flip apply --execute`) resolves each app's
 * bearer key ON THE TARGET machine via `secrets get 'hasna/oss/<app>/api-key'`.
 * That returns "Not found" on every target because:
 *   - the 25 OSS bearer keys live in AWS Secrets Manager (`hasna/oss/<app>/api-key`),
 *   - AWS Secrets Manager is only readable from a box that holds AWS credentials,
 *   - spark01 HAS AWS creds; the ~14 fleet targets have NEITHER AWS creds NOR the
 *     keys in their local `secrets` vault.
 * So every per-app flip safely reverts (no half-flip) and the fleet stays on
 * local sqlite islands.
 *
 * THE FIX
 * -------
 * spark01 becomes the key distributor. This tool:
 *   1. reads each app's bearer key from AWS Secrets Manager ON SPARK01
 *      (`aws secretsmanager get-secret-value --secret-id hasna/oss/<app>/api-key`),
 *   2. builds a per-app env file containing ONLY the two vars the installed
 *      @hasna/contracts@>=0.5.1 client resolver uses to select cloud-http mode:
 *          HASNA_<APP>_API_URL=https://<app>.<fleet-domain>
 *          HASNA_<APP>_API_KEY=<bearer>
 *      where `<fleet-domain>` comes from `HASNA_FLEET_API_DOMAIN` (REQUIRED for
 *      a real run; this repo never bakes in a real internal hostname — absent
 *      the env var it falls back to a neutral, non-resolving placeholder),
 *      (the resolver auto-appends `/v1`; presence of URL+KEY => transport
 *      "cloud-http". NO DSN. NO STORAGE_MODE=remote. NO AWS creds. NO subnet
 *      router. This matches the LOCKED self-hosted architecture.)
 *   3. pushes that env file over tailscale ssh to `$HOME/.hasna/fleet-env/<app>.env`
 *      on each REACHABLE target — the exact location the flipped MCP service
 *      sources via its systemd/launchd drop-in (`EnvironmentFile=`). The bearer
 *      value travels only over ssh STDIN (never argv/ps, never a spark01 temp
 *      file). Existing env files are backed up before overwrite. The write is
 *      atomic (mktemp+mv) and 0600.
 *   4. operates only on responders (ssh reachability probe); apple01 (DEAD) and
 *      apple07 (OFFLINE) are skipped by default.
 *
 * LIVE PRE-DISTRIBUTION VERIFICATION (added O15-04800)
 * ----------------------------------------------------
 * Before any key is pushed, every RESOLVED key is verified against the app's
 * LIVE service (fail-closed). The verifier fetches the app's public
 * `/openapi.json`, derives the first authenticated `/v1/*` GET route, then
 * probes it twice:
 *   - WITHOUT a key: the route must answer 401/403 (auth is enforced), and
 *   - WITH the candidate key: the route must NOT answer 401/403 (the key is
 *     accepted; 404/2xx both prove the key passed auth).
 * A key the live service refuses — revoked, expired, unknown, insufficient
 * scope, or an unverifiable service (5xx / network / no openapi) — is NEVER
 * distributed: that app is dropped from the run with a loud [REJECT] line.
 *
 * WHY: measured incident 2026-07-30/08-29 (O15-04800) — the telephony fleet
 * key was revoked after a leak (env|grep, incident 607515) and rotated to a
 * new kid, but station01's ~/.hasna/fleet-env/telephony.env still held the
 * REVOKED key, so every /v1 business route answered 401 "API key has been
 * revoked." and the telephony live-gate business route + client use were
 * blocked. The distributor had no verification step, so a revoked key in ANY
 * source (AWS SM or a stale local vault capture) would have been pushed to
 * fleet machines silently. The gate makes that impossible: a revoked key now
 * fails the probe and the distribution run refuses to write it anywhere.
 *
 * REVERSIBILITY
 * -------------
 * Every overwrite is backed up to `<app>.env.bak-<UTC-timestamp>` on the target.
 * To revert an app on a machine: remove (or empty) `$HOME/.hasna/fleet-env/<app>.env`
 * so HASNA_<APP>_API_URL / HASNA_<APP>_API_KEY are unset — the client resolver
 * falls straight back to the local store. No local DB is ever touched or deleted.
 *
 * SECRETS SAFETY
 * --------------
 * Key VALUES are never printed or logged. Everywhere a key is surfaced it is
 * masked as `<len=N last4=XXXX>`. The value only ever exists in memory and on
 * the ssh stdin stream to the target.
 *
 * The app->url->secret->env mapping is intentionally byte-identical to
 * src/commands/flip.ts (FLIP_APPS / defineFlipApp) — this tool is the spark01
 * key SOURCE; flip.ts is the on-target consumer contract.
 *
 * USAGE
 *   bun scripts/distribute-cloud-keys.ts [--apps <csv|all>] [--targets <csv|all>]
 *                                        [--dry-run] [--json] [--include-dead]
 *                                        [--probe-timeout <s>] [--ssh-timeout <s>]
 *
 *   # canary used for the cross-machine acceptance proof:
 *   bun scripts/distribute-cloud-keys.ts --apps machines --targets station02
 *
 *   # full fleet distribution (all 25 apps to every reachable target):
 *   bun scripts/distribute-cloud-keys.ts --apps all --targets all
 *
 *   # dry run: resolve keys + probe reachability, write nothing:
 *   bun scripts/distribute-cloud-keys.ts --apps all --targets all --dry-run
 */

// --- Canonical app registry (mirrors src/commands/flip.ts ALL_APPS) ----------

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
 * Default fleet targets (tailscale MagicDNS hostnames). apple01 is DEAD and
 * apple07 is OFFLINE per the mission brief — kept here but excluded unless
 * --include-dead is passed; either way live ssh reachability is the final gate.
 */
const DEFAULT_TARGETS = [
  "station02",
  "station03",
  "station05",
  "machine001",
  "machine002",
  "machine003",
  "machine004",
  "machine005",
  "machine006",
  "machine007",
  "machine008",
  "machine009",
  "machine010",
  "machine011",
];

const KNOWN_DOWN = new Set(["apple01", "apple07"]);

/**
 * Fleet API domain suffix used to build each app's self-hosted URL. This repo
 * never bakes in a real internal hostname: set `HASNA_FLEET_API_DOMAIN` to the
 * operator's own private root domain (REQUIRED for a real distribution run).
 * Absent that env var this falls back to a neutral, non-resolving placeholder.
 */
const FLEET_API_DOMAIN = process.env.HASNA_FLEET_API_DOMAIN?.trim() || "your-deployment.example";

interface AppSpec {
  app: string;
  apiUrlEnv: string;
  apiKeyEnv: string;
  apiUrl: string;
  apiKeySecretPath: string;
}

function defineAppSpec(app: string): AppSpec {
  const UP = app.toUpperCase();
  return {
    app,
    apiUrlEnv: `HASNA_${UP}_API_URL`,
    apiKeyEnv: `HASNA_${UP}_API_KEY`,
    apiUrl: `https://${app}.${FLEET_API_DOMAIN}`,
    apiKeySecretPath: `hasna/oss/${app}/api-key`,
  };
}

// --- Secret masking (NEVER print a raw key) ----------------------------------

function mask(value: string): string {
  const v = value ?? "";
  const last4 = v.length >= 4 ? v.slice(-4) : "";
  return `<len=${v.length} last4=${last4}>`;
}

// --- Small process helpers ---------------------------------------------------

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function run(cmd: string[], input?: string, timeoutMs?: number): Promise<RunResult> {
  const proc = Bun.spawn(cmd, {
    stdin: input === undefined ? "ignore" : "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  if (input !== undefined && proc.stdin) {
    proc.stdin.write(input);
    await proc.stdin.end();
  }
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (timeoutMs && timeoutMs > 0) {
    timer = setTimeout(() => {
      timedOut = true;
      try {
        proc.kill();
      } catch {
        /* ignore */
      }
    }, timeoutMs);
  }
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const code = await proc.exited;
  if (timer) clearTimeout(timer);
  return { code: timedOut ? 124 : code, stdout, stderr };
}

// --- AWS Secrets Manager key resolution --------------------------------------

interface KeyResolution {
  app: string;
  resolved: boolean;
  key?: string; // in-memory only; never logged
  masked?: string;
  error?: string;
}

async function resolveKey(spec: AppSpec): Promise<KeyResolution> {
  const res = await run(
    [
      "aws",
      "secretsmanager",
      "get-secret-value",
      "--secret-id",
      spec.apiKeySecretPath,
      "--query",
      "SecretString",
      "--output",
      "text",
    ],
    undefined,
    30_000,
  );
  if (res.code !== 0) {
    const err = res.stderr.trim();
    const notFound = /ResourceNotFoundException|Secrets Manager can't find/i.test(err);
    return {
      app: spec.app,
      resolved: false,
      error: notFound ? "not-found-in-aws-sm" : `aws-error(code=${res.code}): ${err.split("\n")[0]}`,
    };
  }
  let value = res.stdout.replace(/\n$/, "");
  // Secrets in this account are stored as raw bearer strings, but tolerate a
  // JSON envelope ({ "api-key": "...", "value": "...", "key": "..." }).
  if (value.startsWith("{")) {
    try {
      const obj = JSON.parse(value);
      value = obj["api-key"] ?? obj["apiKey"] ?? obj["api_key"] ?? obj["value"] ?? obj["key"] ?? obj["token"] ?? "";
    } catch {
      /* keep raw */
    }
  }
  value = value.trim();
  // "None" is what `aws ... --output text` prints when a secret has no
  // SecretString (i.e. it is SecretBinary/null) — refuse rather than push a
  // literal "None" as a bearer key.
  if (!value || value === "None") {
    return {
      app: spec.app,
      resolved: false,
      error: value === "None" ? "no-secret-string-binary-or-null" : "empty-secret-value",
    };
  }
  // A bearer key MUST be a single line with no protocol sentinel; a multiline
  // or sentinel-bearing value would corrupt the stdin line-protocol and could
  // write the wrong app's env file. Refuse rather than mis-provision a target.
  if (/[\r\n]/.test(value) || value === "__EOF__" || value.startsWith("FILE ")) {
    return { app: spec.app, resolved: false, error: "malformed-secret-multiline-or-sentinel" };
  }
  return { app: spec.app, resolved: true, key: value, masked: mask(value) };
}

// --- Live pre-distribution verification (fail-closed; O15-04800) -------------

export type { AppSpec };

export interface LiveVerifyResult {
  app: string;
  ok: boolean;
  status: number | null;
  /** machine-readable refusal reason (null when verified) */
  reason: "auth_refused" | "probe_not_authenticated" | "service_unhealthy" | "network" | "openapi_unavailable" | null;
  /** human-readable detail, e.g. the server's 401 body message; never a key value */
  detail: string | null;
}

export interface VerifyKeyLiveDeps {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/** Pick the first authenticated `/v1/*` GET route from an OpenAPI document. */
export function deriveProbePath(openapi: { paths?: Record<string, { get?: unknown }> }): string | null {
  const paths = openapi?.paths ?? {};
  for (const path of Object.keys(paths)) {
    if (path.startsWith("/v1/") && paths[path]?.get) return path;
  }
  return null;
}

/**
 * Verify a resolved key against the app's LIVE service before distribution.
 * Two probes on the derived authenticated route:
 *   1. WITHOUT a key — must answer 401/403 (proves the route is behind auth);
 *   2. WITH the key   — must NOT answer 401/403 (proves the key is accepted).
 * Anything else (network, 5xx, no openapi, route not auth-enforced) is a
 * refusal: an unverifiable key is never distributed.
 */
export async function verifyKeyLive(
  spec: AppSpec,
  key: string,
  deps: VerifyKeyLiveDeps = {},
): Promise<LiveVerifyResult> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const timeoutMs = deps.timeoutMs ?? 12_000;
  const fail = (
    reason: LiveVerifyResult["reason"],
    detail: string | null,
    status: number | null = null,
  ): LiveVerifyResult => ({ app: spec.app, ok: false, status, reason, detail });

  const get = async (url: string, withKey: boolean): Promise<Response> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetchImpl(url, {
        method: "GET",
        headers: withKey ? { Authorization: `Bearer ${key}` } : {},
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  };

  let openapi: Response;
  try {
    openapi = await get(`${spec.apiUrl}/openapi.json`, false);
  } catch {
    return fail("network", "openapi fetch failed (DNS/TLS/connect)", null);
  }
  if (openapi.status !== 200) {
    return fail("openapi_unavailable", `openapi.json answered HTTP ${openapi.status}`, openapi.status);
  }
  let doc: { paths?: Record<string, { get?: unknown }> };
  try {
    doc = (await openapi.json()) as { paths?: Record<string, { get?: unknown }> };
  } catch {
    return fail("openapi_unavailable", "openapi.json was not valid JSON", openapi.status);
  }
  const probePath = deriveProbePath(doc);
  if (!probePath) {
    return fail("openapi_unavailable", "no authenticated /v1/* GET route in openapi.json", openapi.status);
  }

  // Probe 1: no key — the route must enforce auth (401/403).
  let noKey: Response;
  try {
    noKey = await get(`${spec.apiUrl}${probePath}`, false);
  } catch {
    return fail("network", "no-key probe failed (DNS/TLS/connect)", null);
  }
  if (noKey.status >= 500) {
    return fail("service_unhealthy", `service answered HTTP ${noKey.status} during verification`, noKey.status);
  }
  if (!(noKey.status === 401 || noKey.status === 403)) {
    return fail(
      "probe_not_authenticated",
      `${probePath} answered HTTP ${noKey.status} WITHOUT a key — not auth-enforced; cannot discriminate a revoked key`,
      noKey.status,
    );
  }

  // Probe 2: with the candidate key — must NOT be refused.
  let withKey: Response;
  try {
    withKey = await get(`${spec.apiUrl}${probePath}`, true);
  } catch {
    return fail("network", "with-key probe failed (DNS/TLS/connect)", null);
  }
  if (withKey.status === 401 || withKey.status === 403) {
    let detail = `HTTP ${withKey.status}`;
    try {
      const body = (await withKey.json()) as { message?: string };
      if (typeof body?.message === "string") detail = body.message;
    } catch {
      /* keep the status-only detail */
    }
    return fail("auth_refused", `live service refused the key: ${detail}`, withKey.status);
  }
  if (withKey.status >= 500) {
    return fail("service_unhealthy", `service answered HTTP ${withKey.status} during verification`, withKey.status);
  }
  // 2xx and 4xx-non-auth (e.g. 404 on an unknown entity) both prove the key
  // passed authentication.
  return { app: spec.app, ok: true, status: withKey.status, reason: null, detail: null };
}

/**
 * Verify every resolved key against its live service and DROP every app whose
 * key is refused. Fail-closed: a refused app is never pushed to any target.
 */
export async function verifyResolvedKeys(
  specs: AppSpec[],
  keys: Map<string, string>,
  verify: (spec: AppSpec, key: string) => Promise<LiveVerifyResult>,
): Promise<{ keys: Map<string, string>; verified: LiveVerifyResult[]; rejected: LiveVerifyResult[] }> {
  const kept = new Map<string, string>();
  const verified: LiveVerifyResult[] = [];
  const rejected: LiveVerifyResult[] = [];
  for (const spec of specs) {
    const key = keys.get(spec.app);
    if (!key) continue; // unresolved keys are handled by the resolution step
    const result = await verify(spec, key);
    if (result.ok) {
      kept.set(spec.app, key);
      verified.push(result);
    } else {
      rejected.push(result);
    }
  }
  return { keys: kept, verified, rejected };
}

// --- Target reachability -----------------------------------------------------

async function isReachable(host: string, probeTimeoutS: number): Promise<boolean> {
  const res = await run(
    [
      "ssh",
      "-o",
      "BatchMode=yes",
      "-o",
      `ConnectTimeout=${probeTimeoutS}`,
      "-o",
      "StrictHostKeyChecking=accept-new",
      host,
      "true",
    ],
    undefined,
    (probeTimeoutS + 4) * 1000,
  );
  return res.code === 0;
}

// --- Env push (one ssh per target; secret only on stdin) ---------------------

function envFileContent(spec: AppSpec, key: string): string {
  return `${spec.apiUrlEnv}=${spec.apiUrl}\n${spec.apiKeyEnv}=${key}\n`;
}

/**
 * Remote installer. Reads a line protocol from stdin and writes each app env
 * file atomically with a timestamped backup. The remote side NEVER echoes a
 * value — only "WROTE <app> perms=<mode> lines=<n>".
 *
 * Protocol (all on stdin):
 *   FILE <app>
 *   <env line 1>
 *   <env line 2>
 *   __EOF__
 *   FILE <app2>
 *   ...
 * (Env values never contain a newline or the literal "__EOF__".)
 */
// Built from an array of plain strings (NOT a template literal) so bash
// `${...}` expansions survive verbatim. The only escape that matters is the
// printf newline, written as "\\n" so bash receives a literal backslash-n.
const REMOTE_INSTALLER = [
  "set -eu",
  'DIR="$HOME/.hasna/fleet-env"',
  'mkdir -p "$DIR"',
  'chmod 700 "$DIR" 2>/dev/null || true',
  'TS="$(date -u +%Y%m%dT%H%M%SZ)"',
  "umask 077",
  "perms() { stat -c '%a' \"$1\" 2>/dev/null || stat -f '%Lp' \"$1\" 2>/dev/null || echo '?'; }",
  'app=""',
  'tmp=""',
  'while IFS= read -r line || [ -n "$line" ]; do',
  '  case "$line" in',
  '    "FILE "*)',
  '      app="${line#FILE }"',
  '      tmp="$(mktemp "$DIR/.$app.env.XXXXXX")"',
  '      : > "$tmp"',
  "      ;;",
  '    "__EOF__")',
  '      [ -n "$app" ] || continue',
  '      chmod 600 "$tmp"',
  '      f="$DIR/$app.env"',
  '      if [ -f "$f" ]; then cp -p "$f" "$f.bak-$TS"; bak=" backup=$app.env.bak-$TS"; else bak=" backup=none"; fi',
  '      mv "$tmp" "$f"',
  '      n="$(wc -l < "$f" | tr -d \' \')"',
  '      echo "WROTE $app perms=$(perms "$f") lines=$n$bak"',
  '      app=""; tmp=""',
  "      ;;",
  "    *)",
  '      [ -n "$tmp" ] && printf \'%s\\n\' "$line" >> "$tmp"',
  "      ;;",
  "  esac",
  "done",
  "",
].join("\n");

interface PushResult {
  host: string;
  ok: boolean;
  wrote: string[];
  raw: string;
  error?: string;
}

async function pushToTarget(
  host: string,
  specs: AppSpec[],
  keys: Map<string, string>,
  sshTimeoutS: number,
): Promise<PushResult> {
  let payload = "";
  const requested: string[] = [];
  for (const spec of specs) {
    const key = keys.get(spec.app);
    if (!key) continue; // unresolved keys are never pushed
    payload += `FILE ${spec.app}\n${envFileContent(spec, key)}__EOF__\n`;
    requested.push(spec.app);
  }
  if (requested.length === 0) {
    return { host, ok: false, wrote: [], raw: "", error: "no-resolved-keys-to-push" };
  }
  const res = await run(
    [
      "ssh",
      "-o",
      "BatchMode=yes",
      "-o",
      `ConnectTimeout=${sshTimeoutS}`,
      "-o",
      "StrictHostKeyChecking=accept-new",
      host,
      "bash -s",
    ],
    REMOTE_INSTALLER + "\n" + payload,
    Math.max(30, sshTimeoutS + requested.length + 20) * 1000,
  );
  const wrote = (res.stdout.match(/^WROTE (\S+)/gm) ?? []).map((l) => l.replace("WROTE ", ""));
  const wroteSet = new Set(wrote);
  // Identity match, not just count: every requested app must be confirmed
  // written by name (a sentinel-corrupted stream could write a different file
  // and still match on count).
  const allRequestedWritten =
    wrote.length === requested.length && requested.every((a) => wroteSet.has(a));
  return {
    host,
    ok: res.code === 0 && allRequestedWritten,
    wrote,
    raw: (res.stdout + res.stderr).trim(),
    error: res.code === 0 ? undefined : `ssh-code=${res.code}: ${res.stderr.trim().split("\n")[0]}`,
  };
}

// --- CLI ---------------------------------------------------------------------

function parseArgs(argv: string[]) {
  const opts: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        opts[key] = next;
        i++;
      } else {
        opts[key] = true;
      }
    }
  }
  return opts;
}

function selectApps(spec: string | undefined): AppSpec[] {
  if (!spec || spec === "all") return ALL_APPS.map(defineAppSpec);
  const wanted = spec.split(",").map((s) => s.trim()).filter(Boolean);
  const known = new Set<string>(ALL_APPS);
  const bad = wanted.filter((w) => !known.has(w));
  if (bad.length) throw new Error(`Unknown app(s): ${bad.join(", ")}. Known: ${ALL_APPS.join(", ")}`);
  return wanted.map(defineAppSpec);
}

function selectTargets(spec: string | undefined, includeDead: boolean): string[] {
  let base: string[];
  if (!spec || spec === "all") base = [...DEFAULT_TARGETS];
  else base = spec.split(",").map((s) => s.trim()).filter(Boolean);
  // Allowlist hostnames (first char alphanumeric) so a value like
  // "-oProxyCommand=..." can never be parsed by ssh as an option (argv injection).
  const badHosts = base.filter((h) => !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(h));
  if (badHosts.length) {
    throw new Error(`Invalid target hostname(s): ${badHosts.join(", ")}. Allowed chars [A-Za-z0-9._-], no leading '-'.`);
  }
  if (includeDead) base = [...new Set([...base, ...KNOWN_DOWN])];
  else base = base.filter((h) => !KNOWN_DOWN.has(h));
  return base;
}

async function main() {
  const opts = parseArgs(Bun.argv.slice(2));
  const dryRun = Boolean(opts["dry-run"]);
  const json = Boolean(opts["json"]);
  const includeDead = Boolean(opts["include-dead"]);
  const probeTimeoutS = Number(opts["probe-timeout"] ?? 8);
  const sshTimeoutS = Number(opts["ssh-timeout"] ?? 12);

  const specs = selectApps(opts["apps"] as string | undefined);
  const targets = selectTargets(opts["targets"] as string | undefined, includeDead);

  const log = (s: string) => {
    if (!json) console.log(s);
  };

  log(`# distribute-cloud-keys — ${dryRun ? "DRY RUN" : "APPLY"}`);
  log(`# apps: ${specs.length}   candidate targets: ${targets.length}`);

  // 1. Resolve keys from AWS SM (spark01-side).
  log(`\n## 1. Resolving bearer keys from AWS Secrets Manager (masked)`);
  const keys = new Map<string, string>();
  const resolutions: KeyResolution[] = [];
  for (const spec of specs) {
    const r = await resolveKey(spec);
    resolutions.push(r);
    if (r.resolved && r.key) {
      keys.set(spec.app, r.key);
      log(`  [ok ] ${spec.app.padEnd(14)} ${spec.apiKeySecretPath.padEnd(34)} ${r.masked}`);
    } else {
      log(`  [MISS] ${spec.app.padEnd(14)} ${spec.apiKeySecretPath.padEnd(34)} ${r.error}`);
    }
  }
  const missing = resolutions.filter((r) => !r.resolved).map((r) => r.app);

  // 1.5 Verify every resolved key against its app's LIVE service (fail-closed,
  // O15-04800). A key the live service refuses — revoked, expired, unknown,
  // insufficient scope, or an unverifiable service — is dropped from the run:
  // it must NEVER be pushed to a fleet target.
  log(`\n## 1.5 Verifying resolved keys against live services (fail-closed)`);
  const { keys: verifiedKeys, verified: verifiedResults, rejected: rejectedKeys } = await verifyResolvedKeys(
    specs,
    keys,
    (s, k) => verifyKeyLive(s, k),
  );
  for (const spec of specs) {
    if (rejectedKeys.some((r) => r.app === spec.app)) {
      const r = rejectedKeys.find((rr) => rr.app === spec.app)!;
      log(`  [REJECT] ${spec.app.padEnd(14)} NOT distributed: ${r.reason}${r.detail ? ` (${r.detail})` : ""}`);
    } else if (verifiedResults.some((v) => v.app === spec.app)) {
      const v = verifiedResults.find((vv) => vv.app === spec.app)!;
      log(`  [ok  ] ${spec.app.padEnd(14)} live-accepted (HTTP ${v.status ?? "?"})`);
    }
  }
  if (rejectedKeys.length) {
    log(`  # ${rejectedKeys.length} app(s) dropped — resolve the refusal in the API-key store or AWS SM, then re-run.`);
  }

  // 2. Probe reachability.
  log(`\n## 2. Probing target reachability over tailscale ssh`);
  const reachable: string[] = [];
  const unreachable: string[] = [];
  await Promise.all(
    targets.map(async (host) => {
      const ok = await isReachable(host, probeTimeoutS);
      if (ok) reachable.push(host);
      else unreachable.push(host);
    }),
  );
  reachable.sort();
  unreachable.sort();
  for (const h of reachable) log(`  [reachable  ] ${h}`);
  for (const h of unreachable) log(`  [unreachable] ${h} (skipped)`);
  if (includeDead) log(`  # note: --include-dead set; known-down still skipped if unreachable`);
  else log(`  # known-down excluded by default: ${[...KNOWN_DOWN].join(", ")}`);

  // 3. Push (unless dry-run).
  const pushResults: PushResult[] = [];
  if (dryRun) {
    log(`\n## 3. DRY RUN — no env files written. Would push ${verifiedKeys.size} app(s) to ${reachable.length} target(s).`);
  } else {
    log(`\n## 3. Pushing env files to reachable targets (backup-before-overwrite, 0600, atomic)`);
    for (const host of reachable) {
      const r = await pushToTarget(host, specs, verifiedKeys, sshTimeoutS);
      pushResults.push(r);
      if (r.ok) log(`  [ok ] ${host.padEnd(12)} wrote ${r.wrote.length} env file(s)`);
      else log(`  [ERR] ${host.padEnd(12)} ${r.error ?? "partial"} (wrote ${r.wrote.length})`);
    }
  }

  // Summary
  const summary = {
    mode: dryRun ? "dry-run" : "apply",
    appsRequested: specs.map((s) => s.app),
    keysResolved: [...keys.keys()],
    keysVerified: verifiedResults.map((v) => v.app),
    keysRejected: rejectedKeys.map((r) => ({ app: r.app, reason: r.reason, status: r.status, detail: r.detail })),
    keysMissing: missing,
    reachableTargets: reachable,
    unreachableTargets: unreachable,
    knownDownSkipped: includeDead ? [] : [...KNOWN_DOWN],
    pushes: pushResults.map((p) => ({ host: p.host, ok: p.ok, wrote: p.wrote, error: p.error })),
  };

  if (json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    log(`\n## Summary`);
    log(`  keys resolved: ${keys.size}/${specs.length}   live-verified: ${verifiedKeys.size}   rejected: ${rejectedKeys.length}`);
    if (missing.length) log(`  keys MISSING (reconcile in AWS SM): ${missing.join(", ")}`);
    if (rejectedKeys.length) {
      log(`  keys REJECTED by the live service (NOT distributed — reconcile, then re-run):`);
      for (const r of rejectedKeys) log(`    - ${r.app}: ${r.reason}${r.detail ? ` (${r.detail})` : ""}`);
    }
    log(`  reachable targets: ${reachable.length}/${targets.length}`);
    if (!dryRun) {
      const okCount = pushResults.filter((p) => p.ok).length;
      log(`  targets fully provisioned: ${okCount}/${pushResults.length}`);
    }
    log(`\n  Revert an app on a machine:`);
    log(`    ssh <host> 'rm -f ~/.hasna/fleet-env/<app>.env'   # unsets URL+KEY -> client falls back to local`);
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(`distribute-cloud-keys FAILED: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
