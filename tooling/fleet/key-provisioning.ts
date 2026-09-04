/**
 * Fleet client-API-key lifecycle: mint-or-verify on deploy, and drift detection
 * across the whole fleet (hasna/apps#1595).
 *
 * THE DEFECT. A hosted Hasna service is unusable from a station until a CLIENT
 * key exists for it in Secrets Manager at `hasna/oss/<app>/api-key`, but key
 * provisioning was not part of any deploy. `messages-prod` ran, routed and
 * answered /health for days with no key at all; `projects` and `knowledge`
 * shipped keys that had been REVOKED at the origin while the Secrets Manager
 * copy still held the dead value. Both failures are invisible to /health,
 * which is why neither was caught by the deploy or by uptime monitoring.
 *
 * THE PROBE, AND WHY IT IS TWO-SIDED. Proving a key works needs an
 * authenticated request, and hard-coding one real route per app would be 30
 * route tables to keep in sync — a probe that 404s because a route moved would
 * report a dead key. So the probe asks for a path NO app implements
 * ({@link KEY_PROBE_PATH}) and reads the STATUS, not the body: the credential
 * gate runs before routing, so
 *
 *   401/403 without the key  +  anything else with it   => the key authenticates
 *   401/403 without the key  +  401/403 with it         => the key is dead
 *   not 401/403 without the key                         => /v1/* is NOT gated
 *
 * The third line is the reason the probe sends an unauthenticated request at
 * all. Without that control a service that had lost its auth middleware would
 * answer 404 to the keyed probe and be reported GREEN — a broken key check
 * that cannot fail is worse than none, because it is believed.
 *
 * NOTHING HERE LOGS A SECRET. The key value moves from `aws secretsmanager
 * get-secret-value` stdout into a request header inside one process and is
 * never printed, written, returned or embedded in an error. The reports carry
 * app names, statuses and verdicts only.
 */
import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Secrets Manager namespace holding one client key per hosted app. */
export const KEY_SECRET_PREFIX = "hasna/oss/";
/** Suffix of the client-key secret. */
export const KEY_SECRET_SUFFIX = "/api-key";
/** The api.hasna.com gateway; `<app>` is appended and the gateway strips it. */
export const GATEWAY_BASE = "https://api.hasna.com";

/**
 * A `/v1` path no service implements, used as the credential probe.
 *
 * Deliberately not a real route: a real route couples this check to another
 * app's API surface, and its 404 after a rename would be indistinguishable
 * from a dead key. A path that is always 404 for an AUTHENTICATED caller makes
 * the status unambiguous — the only way to get 401/403 from it is the gate.
 */
export const KEY_PROBE_PATH = "/v1/__fleet-key-probe__";

/** Statuses that mean "the credential gate refused this request". */
export const REFUSAL_STATUSES = [401, 403] as const;

export type AppSource = "monorepo" | "external";

/**
 * How an app's client key is checked.
 *
 * `probe` — the two-sided HTTP probe below.
 * `none`  — the app has NO API-key-gated HTTP route to probe (hooks verifies
 *   request signatures instead of presenting a client key). Its key must still
 *   EXIST; only the authentication probe is skipped, and the report names it
 *   every day so the exemption stays visible rather than becoming a silent
 *   hole. An entry may only claim it with `notes` saying why.
 */
export type KeyCheck = "probe" | "none";

/** One registry entry as written in hosted-apps.json. */
export interface FleetAppEntry {
  app: string;
  source: AppSource;
  baseUrl?: string;
  keySecretId?: string;
  /**
   * Path appended to `baseUrl` for the probe. Defaults to
   * {@link KEY_PROBE_PATH}. Overridden for the services that route BEFORE they
   * authenticate — they answer 404 to an unknown path whether or not a
   * credential was presented, so the default probe cannot tell a working key
   * from a dead one there and must name a real gated route instead.
   */
  probePath?: string;
  keyCheck?: KeyCheck;
  notes?: string;
}

/** A registry entry with every default resolved. */
export interface FleetApp {
  app: string;
  source: AppSource;
  /** Base URL WITHOUT a trailing slash and WITHOUT the `/v1` suffix. */
  baseUrl: string;
  keySecretId: string;
  probePath: string;
  keyCheck: KeyCheck;
  notes?: string;
}

/** Secrets Manager id of an app's client key. */
export function keySecretIdFor(app: string): string {
  return `${KEY_SECRET_PREFIX}${app}${KEY_SECRET_SUFFIX}`;
}

/**
 * Default base URL: the gateway, path-prefixed with the app.
 *
 * Path-prefixed on purpose — the canonical fleet base is
 * `https://api.hasna.com/<app>` and callers append `/v1` themselves
 * (hasna/apps#1601). An entry overrides this only while an app is still pinned
 * to its origin hostname.
 */
export function defaultBaseUrlFor(app: string): string {
  return `${GATEWAY_BASE}/${app}`;
}

/** Join a resolved base URL with a probe path, tolerating a trailing slash. */
export function probeUrlFor(baseUrl: string, probePath: string = KEY_PROBE_PATH): string {
  return `${baseUrl.replace(/\/+$/, "")}${probePath}`;
}

const APP_SLUG = /^[a-z][a-z0-9-]*$/;

/** Resolve one raw entry, validating it. Throws with the offending app named. */
export function resolveEntry(entry: FleetAppEntry): FleetApp {
  if (!APP_SLUG.test(entry.app ?? "")) {
    throw new Error(`hosted-apps.json: invalid app slug ${JSON.stringify(entry.app)}`);
  }
  if (entry.source !== "monorepo" && entry.source !== "external") {
    throw new Error(`hosted-apps.json: ${entry.app}: source must be "monorepo" or "external"`);
  }
  if (entry.source === "external" && !entry.notes?.trim()) {
    throw new Error(
      `hosted-apps.json: ${entry.app}: an external app must carry "notes" saying where it is built — ` +
        `an unexplained external entry is how a deleted app stays in the daily check forever`,
    );
  }
  const keyCheck: KeyCheck = entry.keyCheck ?? "probe";
  if (keyCheck !== "probe" && keyCheck !== "none") {
    throw new Error(`hosted-apps.json: ${entry.app}: keyCheck must be "probe" or "none"`);
  }
  if (keyCheck === "none" && !entry.notes?.trim()) {
    throw new Error(
      `hosted-apps.json: ${entry.app}: keyCheck "none" must carry "notes" saying why the app has no ` +
        "API-key-gated route — an undocumented exemption is indistinguishable from a forgotten one",
    );
  }
  if (keyCheck === "none" && entry.probePath) {
    throw new Error(`hosted-apps.json: ${entry.app}: keyCheck "none" cannot also set probePath`);
  }
  const probePath = entry.probePath ?? KEY_PROBE_PATH;
  if (!probePath.startsWith("/")) {
    throw new Error(`hosted-apps.json: ${entry.app}: probePath must start with "/"`);
  }
  const baseUrl = (entry.baseUrl ?? defaultBaseUrlFor(entry.app)).replace(/\/+$/, "");
  if (!baseUrl.startsWith("https://")) {
    throw new Error(`hosted-apps.json: ${entry.app}: baseUrl must be https`);
  }
  return {
    app: entry.app,
    source: entry.source,
    baseUrl,
    keySecretId: entry.keySecretId ?? keySecretIdFor(entry.app),
    probePath,
    keyCheck,
    ...(entry.notes ? { notes: entry.notes } : {}),
  };
}

/** The registry file, relative to the repo root. */
export const REGISTRY_PATH = path.join("tooling", "fleet", "hosted-apps.json");

/** Parse a registry document (already-read JSON text). */
export function parseRegistry(text: string): FleetApp[] {
  const doc = JSON.parse(text) as { apps?: FleetAppEntry[] };
  if (!Array.isArray(doc.apps) || doc.apps.length === 0) {
    throw new Error("hosted-apps.json: `apps` must be a non-empty array");
  }
  const resolved = doc.apps.map(resolveEntry);
  const seen = new Set<string>();
  for (const entry of resolved) {
    if (seen.has(entry.app)) throw new Error(`hosted-apps.json: duplicate entry for ${entry.app}`);
    seen.add(entry.app);
  }
  const sorted = [...resolved].map((e) => e.app);
  const monorepo = sorted.filter((_, i) => resolved[i]!.source === "monorepo");
  const external = sorted.filter((_, i) => resolved[i]!.source === "external");
  for (const group of [monorepo, external]) {
    const ordered = [...group].sort();
    if (group.join(",") !== ordered.join(",")) {
      throw new Error(
        `hosted-apps.json: entries must be alphabetical within their source group; expected ${ordered.join(", ")}`,
      );
    }
  }
  return resolved;
}

/** Load and resolve the registry from a repo root. */
export function loadRegistry(root: string = repoRoot()): FleetApp[] {
  return parseRegistry(fs.readFileSync(path.join(root, REGISTRY_PATH), "utf8"));
}

/** Repo root, resolved from this file's location (tooling/fleet/…). */
export function repoRoot(): string {
  return path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
}

// --------------------------------------------------------------------------
// Probe classification — pure, and the part worth testing hardest.
// --------------------------------------------------------------------------

export type ProbeVerdict =
  /** The key was accepted: the gate refused the unkeyed call and not the keyed one. */
  | "authenticated"
  /** The gate refused the keyed call: the key is revoked, expired or wrong. */
  | "rejected"
  /** The unkeyed call was NOT refused: /v1/* is not credential-gated at all. */
  | "ungated"
  /** One of the two calls did not complete: nothing can be concluded. */
  | "unreachable"
  /** A call completed with a status that answers nothing about the credential. */
  | "inconclusive";

function isRefusal(status: number): boolean {
  return (REFUSAL_STATUSES as readonly number[]).includes(status);
}

/**
 * Statuses that say nothing about the credential presented.
 *
 * A 5xx is the origin failing before or independently of the gate, and a 429 is
 * the request never being judged at all. Reading either as "not a refusal, so
 * the key works" is how a rate-limited or broken origin reports a green key —
 * exactly the "a check that cannot fail is worse than none" failure the unkeyed
 * control exists to prevent, arriving through the other half of the probe.
 */
export function isInconclusiveStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/**
 * Classify a two-sided probe. `null` means the request did not complete.
 *
 * Order matters:
 *   - `unreachable` outranks everything (an incomplete probe proves nothing);
 *   - an inconclusive UNKEYED status outranks `ungated`, because "not a 401"
 *     from a 503 is not evidence that /v1/* is unguarded;
 *   - `ungated` outranks the keyed reading entirely (a service that accepts an
 *     unkeyed call would make ANY key look valid);
 *   - a refusal is a refusal, but anything else must still be a status the
 *     origin actually judged before it counts as `authenticated`.
 */
export function classifyProbe(withoutKey: number | null, withKey: number | null): ProbeVerdict {
  if (withoutKey === null || withKey === null) return "unreachable";
  if (isInconclusiveStatus(withoutKey)) return "inconclusive";
  if (!isRefusal(withoutKey)) return "ungated";
  if (isRefusal(withKey)) return "rejected";
  if (isInconclusiveStatus(withKey)) return "inconclusive";
  return "authenticated";
}

export type KeyState =
  /** A key exists and authenticates. Nothing to do. */
  | "verified"
  /** A key exists and the app has no gated route to probe (documented exemption). */
  | "exempt"
  /** No secret at all — the messages failure. Mint one. */
  | "missing"
  /** A secret exists but the origin refuses it — the projects/knowledge failure. Re-mint. */
  | "rejected"
  /** A secret exists but the probe could not prove anything. Report, do not re-mint. */
  | "unverifiable";

export interface KeyAssessment {
  app: string;
  state: KeyState;
  /** One line, safe to print and to post to #incidents. Never carries a key. */
  detail: string;
}

export interface AssessInput {
  app: string;
  secretPresent: boolean;
  verdict: ProbeVerdict;
  /** `none` when the app carries a documented probe exemption. */
  keyCheck?: KeyCheck;
  /** Observed statuses, for the report. */
  statuses?: { withoutKey: number | null; withKey: number | null };
}

/** Turn a secret lookup + a probe verdict into the state that drives action. */
export function assessKey(input: AssessInput): KeyAssessment {
  const { app, secretPresent, verdict } = input;
  const seen = input.statuses
    ? ` (unkeyed=${input.statuses.withoutKey ?? "n/a"}, keyed=${input.statuses.withKey ?? "n/a"})`
    : "";
  if (!secretPresent) {
    return { app, state: "missing", detail: `${keySecretIdFor(app)} does not exist — nothing can call ${app}` };
  }
  if (input.keyCheck === "none") {
    // The key EXISTS, which is the half that can be checked without a gated
    // route. Reported every run so the exemption never goes quiet.
    return { app, state: "exempt", detail: `${keySecretIdFor(app)} exists; ${app} has no API-key-gated route to probe` };
  }
  switch (verdict) {
    case "authenticated":
      return { app, state: "verified", detail: `key authenticates against ${app}${seen}` };
    case "rejected":
      return {
        app,
        state: "rejected",
        detail: `${keySecretIdFor(app)} exists but ${app} refuses it — revoked, expired, or signed by a rotated secret${seen}`,
      };
    case "ungated":
      return {
        app,
        state: "unverifiable",
        detail: `${app} answered an UNAUTHENTICATED /v1 request without refusing it — /v1/* is not credential-gated${seen}`,
      };
    case "unreachable":
      return { app, state: "unverifiable", detail: `${app} did not answer the probe${seen}` };
    case "inconclusive":
      return {
        app,
        state: "unverifiable",
        detail:
          `${app} answered the probe with a status that judges no credential (5xx or 429), ` +
          `so neither half of the check proved anything${seen}`,
      };
  }
}

/** States that must fail the daily check and open an incident. */
export const FAILING_STATES: readonly KeyState[] = ["missing", "rejected"];

/**
 * Partition assessments into failures, warnings and passes.
 *
 * `unverifiable` is a WARNING by default: a momentary network fault on a
 * scheduled job must not page anyone, and liveness is uptime monitoring's job.
 * `--strict` promotes it, which is what a deploy lane wants — right after a
 * rollout, "I could not reach the thing I just deployed" is a finding.
 */
export function partition(
  assessments: readonly KeyAssessment[],
  options: { strict?: boolean } = {},
): { failures: KeyAssessment[]; warnings: KeyAssessment[]; passes: KeyAssessment[]; exempt: KeyAssessment[] } {
  const failures: KeyAssessment[] = [];
  const warnings: KeyAssessment[] = [];
  const passes: KeyAssessment[] = [];
  const exempt: KeyAssessment[] = [];
  for (const a of assessments) {
    if (FAILING_STATES.includes(a.state)) failures.push(a);
    else if (a.state === "unverifiable") (options.strict ? failures : warnings).push(a);
    else if (a.state === "exempt") exempt.push(a);
    else passes.push(a);
  }
  return { failures, warnings, passes, exempt };
}

/**
 * The #incidents message. Plain text, one line per finding, no secret values —
 * this is posted verbatim by the scheduled workflow.
 */
export function renderIncidentReport(input: {
  failures: readonly KeyAssessment[];
  warnings: readonly KeyAssessment[];
  passes: readonly KeyAssessment[];
  exempt?: readonly KeyAssessment[];
  runUrl?: string;
}): string {
  const exempt = input.exempt ?? [];
  const lines: string[] = [];
  lines.push(
    `fleet client-API-key drift: ${input.failures.length} failing, ${input.warnings.length} unverified, ` +
      `${input.passes.length} healthy, ${exempt.length} exempt`,
  );
  for (const f of input.failures) lines.push(`FAIL ${f.app}: ${f.detail}`);
  for (const w of input.warnings) lines.push(`WARN ${w.app}: ${w.detail}`);
  for (const e of exempt) lines.push(`EXEMPT ${e.app}: ${e.detail}`);
  lines.push(
    "Remedy: re-run the app's deploy lane, or mint by hand with the in-VPC one-off task " +
      "(hasna-ops-mint-key-<app>); see hasna/apps#1595.",
  );
  if (input.runUrl) lines.push(input.runUrl);
  return lines.join("\n");
}

// --------------------------------------------------------------------------
// IO seams. Every one is injectable so the logic above is tested without AWS.
// --------------------------------------------------------------------------

export interface Io {
  /** Read a Secrets Manager string value; `null` when the secret does not exist. */
  readSecret(secretId: string, region: string): Promise<string | null>;
  /** GET a URL, returning the status; `null` when the request did not complete. */
  probe(url: string, apiKey: string | null): Promise<number | null>;
  /** Run one `aws` invocation, returning stdout. Throws on a non-zero exit. */
  aws(args: readonly string[]): Promise<string>;
}

/** Sentinel AWS error meaning "no such secret" — the `missing` case, not a fault. */
const NOT_FOUND = /ResourceNotFoundException|Secrets Manager can't find the specified secret/i;

/** AWS's several ways of saying "this role may not do that". */
const ACCESS_DENIED = /AccessDenied|UnauthorizedOperation|is not authorized to perform|AuthorizationError/i;

/** AWS's ways of saying "the thing you named does not exist". */
const NO_SUCH_TARGET =
  /ClusterNotFoundException|TaskDefinitionNotFoundException|Unable to describe task definition|ParameterNotFound/i;

/**
 * The AWS side of this checker is NOT in this repository.
 *
 * Every grant and every task definition it needs lives in
 * hasna-internal/infra-live (tracked in hasna-internal/infra-live#46; the
 * rollout switches that keep the lanes off until it lands are hasna/apps#1768).
 * Verified absent at infra-live@1ab5ad4: `infra/modules/deploy-oidc-role` —
 * which conversations, mementos, projects and skills all instantiate — grants
 * NO secretsmanager action at all and scopes `ecs:RunTask` to
 * `${migration_task_family}:*`, and no `hasna-ops-mint-key-*` task definition
 * exists anywhere.
 *
 * So the failure this code will actually meet first is `AccessDeniedException`,
 * not a broken key. An `AccessDeniedException` re-raised as a generic error
 * reads, in a deploy lane's log, exactly like the app's key being unreadable —
 * one is a missing IAM statement a human must add once, the other is an
 * incident. This error type keeps them apart and says which grant is missing.
 */
export class FleetKeyPrerequisiteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FleetKeyPrerequisiteError";
  }
}

/** stderr and message together: an injected Io throws plain Errors, execFile attaches stderr. */
function awsErrorText(e: unknown): string {
  const stderr = (e as { stderr?: string }).stderr ?? "";
  const message = e instanceof Error ? e.message : String(e);
  return `${stderr}\n${message}`;
}

/** The message shown when the lane's role cannot read a client key at all. */
export function secretReadDeniedMessage(secretId: string): string {
  return [
    `this role may not read ${secretId} (AccessDenied).`,
    "That is a missing IAM statement, not a missing or dead key: nothing has been proved about the",
    "key itself and nothing has been written.",
    `Grant secretsmanager:GetSecretValue on arn:aws:secretsmanager:<region>:<account>:secret:${secretId}-*`,
    "to the role this lane assumes — infra/modules/deploy-oidc-role for a deploy lane, the",
    "fleet-key-audit-gha role for the daily drift lane. Tracked in hasna-internal/infra-live#46;",
    "the rollout switches are hasna/apps#1768.",
  ].join("\n");
}

/** The message shown when the lane's role may not read the app's deploy manifest. */
export function manifestReadDeniedMessage(manifestName: string): string {
  return [
    `this role may not read the SSM deploy manifest ${manifestName} (AccessDenied).`,
    "Nothing was minted and no secret was written.",
    `Grant ssm:GetParameter on parameter${manifestName} to the role this lane assumes.`,
    "Tracked in hasna-internal/infra-live#46.",
  ].join("\n");
}

/** The message shown when the lane's role may not start the mint task. */
export function mintDeniedMessage(taskFamily: string, cluster: string): string {
  return [
    `this role may not run the mint task ${taskFamily} in ${cluster} (AccessDenied).`,
    "Nothing was minted and no secret was written.",
    `Grant ecs:RunTask on task-definition/${taskFamily}:* (conditioned on this cluster),`,
    "ecs:DescribeTasks, and iam:PassRole for the mint task's task and execution roles.",
    "infra/modules/deploy-oidc-role scopes ecs:RunTask to the migration family only today.",
    "Tracked in hasna-internal/infra-live#46.",
  ].join("\n");
}

/** The message shown when the mint task definition or cluster does not exist. */
export function mintTargetMissingMessage(taskFamily: string, cluster: string): string {
  return [
    `the mint task ${taskFamily} does not exist in ${cluster}.`,
    "Nothing was minted and no secret was written.",
    `Register the in-VPC one-off task definition ${taskFamily} — it runs "@hasna/contracts issue-key"`,
    "and writes the result straight to Secrets Manager, so the plaintext never leaves the VPC.",
    "Tracked in hasna-internal/infra-live#46.",
  ].join("\n");
}

/**
 * Re-raise an AWS failure as a prerequisite error when it is one.
 *
 * `denied` and `missing` are built lazily so a caller pays nothing on the happy
 * path. Anything else is re-thrown untouched — this must not swallow a real
 * fault into a reassuring message.
 */
export async function withPrerequisiteContext<T>(
  run: () => Promise<T>,
  messages: { denied: () => string; missing?: () => string },
): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof FleetKeyPrerequisiteError) throw e;
    const text = awsErrorText(e);
    if (ACCESS_DENIED.test(text)) throw new FleetKeyPrerequisiteError(messages.denied());
    if (messages.missing && NO_SUCH_TARGET.test(text)) throw new FleetKeyPrerequisiteError(messages.missing());
    throw e;
  }
}

export function createIo(options: { timeoutMs?: number } = {}): Io {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const aws = async (args: readonly string[]): Promise<string> => {
    const { stdout } = await execFileAsync("aws", [...args], { maxBuffer: 8 * 1024 * 1024 });
    return stdout;
  };
  return {
    aws,
    async readSecret(secretId, region) {
      try {
        // --output text on --query SecretString keeps the value out of any JSON
        // envelope, and the value goes straight into a variable. It is never
        // echoed, and a failure below re-raises WITHOUT stdout.
        const out = await aws([
          "secretsmanager",
          "get-secret-value",
          "--secret-id",
          secretId,
          "--region",
          region,
          "--query",
          "SecretString",
          "--output",
          "text",
        ]);
        const value = out.trim();
        return value.length > 0 ? value : null;
      } catch (e) {
        const stderr = (e as { stderr?: string }).stderr ?? "";
        // "no such secret" is the `missing` case the whole lane exists to fix.
        if (NOT_FOUND.test(stderr)) return null;
        // "you may not look" is a missing IAM statement, and saying so is the
        // difference between a one-line infra fix and a hunt for a dead key.
        if (ACCESS_DENIED.test(stderr)) throw new FleetKeyPrerequisiteError(secretReadDeniedMessage(secretId));
        throw new Error(`reading ${secretId} failed: ${firstLine(stderr) || (e as Error).message}`);
      }
    },
    async probe(url, apiKey) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const headers: Record<string, string> = { accept: "application/json" };
        if (apiKey) headers["x-api-key"] = apiKey;
        const response = await fetch(url, { method: "GET", headers, signal: controller.signal });
        return response.status;
      } catch {
        return null;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/** Trim an AWS stderr blob to one line so a report never carries a payload. */
function firstLine(text: string): string {
  return text.split("\n").find((l) => l.trim().length > 0)?.trim() ?? "";
}

/** Probe one app two-sidedly and assess it. */
export async function checkApp(app: FleetApp, io: Io, region: string): Promise<KeyAssessment> {
  const secret = await io.readSecret(app.keySecretId, region);
  if (!secret) return assessKey({ app: app.app, secretPresent: false, verdict: "unreachable" });
  if (app.keyCheck === "none") {
    return assessKey({ app: app.app, secretPresent: true, verdict: "unreachable", keyCheck: "none" });
  }
  const url = probeUrlFor(app.baseUrl, app.probePath);
  const withoutKey = await io.probe(url, null);
  const withKey = await io.probe(url, secret);
  const verdict = classifyProbe(withoutKey, withKey);
  return assessKey({ app: app.app, secretPresent: true, verdict, statuses: { withoutKey, withKey } });
}

// --------------------------------------------------------------------------
// Minting.
// --------------------------------------------------------------------------

/**
 * Everything the mint route needs, read out of the app's SSM deploy manifest.
 *
 * The mint task is a one-off Fargate task INSIDE the VPC: the key store's
 * Postgres is only reachable from `sg-…`, and `@hasna/contracts issue-key`
 * needs both the app's signing secret and its owner database URL. The task
 * writes the minted key straight to Secrets Manager and prints only kid/exp —
 * the plaintext never crosses the VPC boundary and never reaches a CI log.
 *
 * TODO(hasna/apps#1595, part 2): once `@hasna/contracts` ships the
 * operator-only key-lifecycle route (bootstrap-key gated — PR hasna/apps#1641
 * `feat(contracts): … operator key routes`), replace this ECS round trip with
 * a call to `POST <base>/v1/operator/keys` using the app's bootstrap key. That
 * removes the VPC dependency and the per-app task definition entirely. It is
 * NOT wired here because that route is unreleased and this repo's contracts
 * pin (0.14.2) does not carry it; the ECS path below is the one that works
 * today and is what the fleet was minting by hand.
 */
export interface MintTarget {
  cluster: string;
  taskFamily: string;
  subnets: string[];
  securityGroups: string[];
  assignPublicIp: string;
}

/** Read the mint target out of a deploy manifest document. Null when unset. */
export function mintTargetFrom(manifest: Record<string, unknown>): MintTarget | null {
  const family = typeof manifest.mint_key_task_family === "string" ? manifest.mint_key_task_family.trim() : "";
  const cluster = typeof manifest.cluster === "string" ? manifest.cluster.trim() : "";
  const subnets = Array.isArray(manifest.subnets) ? manifest.subnets.map(String) : [];
  const securityGroups = Array.isArray(manifest.security_groups) ? manifest.security_groups.map(String) : [];
  const assignPublicIp =
    typeof manifest.assign_public_ip === "string" ? manifest.assign_public_ip : String(manifest.assign_public_ip ?? "");
  if (!family || !cluster || subnets.length === 0 || securityGroups.length === 0 || !assignPublicIp) return null;
  return { cluster, taskFamily: family, subnets, securityGroups, assignPublicIp };
}

/** The message shown when an app needs a key and no mint route is configured. */
export function missingMintTargetMessage(app: string, manifestName: string): string {
  return [
    `${app} needs a client key (${keySecretIdFor(app)}) and this lane cannot mint one.`,
    `Add "mint_key_task_family" to the SSM deploy manifest ${manifestName}, naming the in-VPC`,
    `one-off task definition that runs "@hasna/contracts issue-key" for ${app} and writes the`,
    `result to ${keySecretIdFor(app)} (the hasna-ops-mint-key-${app} family). The deploy itself`,
    "succeeded; the service is running without a usable client key until this is done.",
    "Neither the task family nor the grant to start it exists yet — hasna-internal/infra-live#46.",
  ].join("\n");
}

/**
 * Run the in-VPC mint task and wait for it. Returns the task's exit code.
 *
 * The task's own IAM role is what may write the secret; this lane's role only
 * starts it. No key value passes through here.
 */
export async function runMintTask(target: MintTarget, io: Io, region: string, startedBy: string): Promise<number> {
  const network =
    `awsvpcConfiguration={subnets=[${target.subnets.join(",")}],` +
    `securityGroups=[${target.securityGroups.join(",")}],assignPublicIp=${target.assignPublicIp}}`;
  // Both prerequisites this call depends on are absent from infra-live today
  // (see FleetKeyPrerequisiteError): the deploy role's ecs:RunTask is scoped to
  // the migration family, and no hasna-ops-mint-key-* task definition exists.
  // Whichever lands last, the operator must be told WHICH — not "mint task
  // failed to start".
  const taskArn = (
    await withPrerequisiteContext(
      () =>
        io.aws([
          "ecs",
          "run-task",
          "--region",
          region,
          "--cluster",
          target.cluster,
          "--task-definition",
          target.taskFamily,
          "--launch-type",
          "FARGATE",
          "--count",
          "1",
          "--started-by",
          startedBy,
          "--network-configuration",
          network,
          "--query",
          "tasks[0].taskArn",
          "--output",
          "text",
        ]),
      {
        denied: () => mintDeniedMessage(target.taskFamily, target.cluster),
        missing: () => mintTargetMissingMessage(target.taskFamily, target.cluster),
      },
    )
  ).trim();
  if (!taskArn || taskArn === "None") throw new Error("mint task failed to start");
  await io.aws(["ecs", "wait", "tasks-stopped", "--region", region, "--cluster", target.cluster, "--tasks", taskArn]);
  const exit = (
    await withPrerequisiteContext(
      () =>
        io.aws([
          "ecs",
          "describe-tasks",
          "--region",
          region,
          "--cluster",
          target.cluster,
          "--tasks",
          taskArn,
          "--query",
          "tasks[0].containers[0].exitCode",
          "--output",
          "text",
        ]),
      { denied: () => mintDeniedMessage(target.taskFamily, target.cluster) },
    )
  ).trim();
  const code = Number(exit);
  return Number.isFinite(code) ? code : 1;
}

// --------------------------------------------------------------------------
// Rotation policy — when provisioning may OVERWRITE an existing secret.
// --------------------------------------------------------------------------

/**
 * WHY THIS IS NOT "mint whenever the probe is unhappy".
 *
 * `hasna/oss/<app>/api-key` holds ONE shared client key, and stations do not
 * read it live: an operator copies it by hand into the macOS Keychain
 * (`hasna.credentials.<app>.api-key`, see ~/.claude/rules). Overwriting that
 * secret therefore invalidates every station's copy of it, silently, until
 * somebody re-pulls — so an automatic overwrite is a fleet-wide outage waiting
 * for an unlucky probe.
 *
 * And the `rejected` verdict is a HEURISTIC, not a proof. It is reached from a
 * keyed 401 **or 403**, and a 403 is exactly what a perfectly valid key that
 * merely lacks the scope of the probed path returns (`loops` answers 403 on the
 * default probe path today). Rotating on that reading would destroy a live key
 * to fix a permission that was never broken.
 *
 * So the rule is asymmetric, and deliberately so:
 *
 *   missing      — no secret exists, nothing can be invalidated => MINT.
 *   rejected     — a secret exists => REFUSE, report, and leave it alone. The
 *                  lane goes red and a human decides, unless the caller opted
 *                  in with `--allow-rotate` (and then only after a second,
 *                  confirming probe, and with a rotation notice published).
 *   unverifiable — the probe proved nothing => never touch the secret.
 *
 * The cost of refusing is a red job on a service whose key was genuinely dead.
 * The cost of rotating wrongly is every station losing an app at once. The
 * first is loud and cheap; the second is silent and expensive.
 */

/** What `provision` should do about one assessment. */
export type MintPlan =
  /** The key is fine (or documented-exempt): do nothing, exit clean. */
  | { action: "none"; reason: string }
  /** No secret exists: mint one. Nothing can be invalidated. */
  | { action: "mint"; cause: "missing" }
  /** A secret exists and was refused, and the caller opted into replacing it. */
  | { action: "rotate"; cause: "rejected" }
  /** Do not write: report and exit non-zero. */
  | { action: "refuse"; reason: string };

/** The message shown when a live secret is refused and rotation was not authorised. */
export function rotationRefusedMessage(app: string): string {
  return [
    `${app} has a client key (${keySecretIdFor(app)}) that the origin refused.`,
    "NOT re-minting: that secret is the one every station copied into its Keychain, and a keyed",
    "403 is also what a valid key lacking the probed path's scope returns — overwriting on this",
    "reading can take the app away from every station to fix a permission that was never broken.",
    "Decide, then act:",
    `  - the key really is dead  -> re-run this lane with --allow-rotate (workflow input`,
    `    allow_rotate: true), or mint by hand with the hasna-ops-mint-key-${app} task, and tell`,
    "    station operators to re-pull the secret into their Keychain;",
    `  - the key is fine and the probe path is not in its scope -> give ${app} a probePath naming`,
    "    a route the fleet key IS scoped for, in tooling/fleet/hosted-apps.json.",
  ].join("\n");
}

/** The notice published whenever an existing key is actually replaced. */
export function rotationNotice(app: string): string {
  return [
    `ROTATED ${keySecretIdFor(app)}: the previous client key for ${app} was refused by the origin and`,
    "has been replaced. Every station still holds the OLD value in its Keychain and will fail against",
    `${app} until it is re-pulled:`,
    `  aws secretsmanager get-secret-value --secret-id ${keySecretIdFor(app)} --region us-east-1 \\`,
    "    --query SecretString --output text  ->  security add-generic-password -U -a <station> \\",
    `    -s hasna.credentials.${app}.api-key -w "$value"`,
    "(move the value process-to-process; never print, echo or write it. See hasna/apps#1595.)",
  ].join("\n");
}

/**
 * Decide what provisioning may do, from the assessment alone.
 *
 * Pure on purpose: this is the rule that protects a live credential, so it is
 * readable and testable without AWS, a network or a workflow.
 */
export function planMint(assessment: KeyAssessment, options: { allowRotate?: boolean } = {}): MintPlan {
  switch (assessment.state) {
    case "verified":
      return { action: "none", reason: assessment.detail };
    case "exempt":
      return { action: "none", reason: assessment.detail };
    case "missing":
      return { action: "mint", cause: "missing" };
    case "unverifiable":
      // A probe that proved nothing must never be answered by writing a new
      // credential over a possibly-good one.
      return {
        action: "refuse",
        reason: `refusing to mint for ${assessment.app}: the probe proved nothing. ${assessment.detail}`,
      };
    case "rejected":
      return options.allowRotate
        ? { action: "rotate", cause: "rejected" }
        : { action: "refuse", reason: rotationRefusedMessage(assessment.app) };
  }
}
