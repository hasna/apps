// Client-contract conformance checks (contracts 1.1.0, REPORT mode).
//
// Six checks prove, per repo, that a CLI or MCP bin reaches data only through
// the shared authenticated client, that the on-box store sits behind the one
// sanctioned door, that retired vocabulary and legacy hostnames are gone, and
// that the kit pin is exact and current. In 1.1.x every finding is reported
// with status `report` and never fails the repo; `strict` turns them into
// `fail`, which is the 1.2.0 default. A check that cannot run says so as
// `skip`, never as `pass`.
//
// Findings name FILES, LINES and PATTERN LABELS — never the matched text. This
// repository and its CI logs are public; a scanner that echoes a hostname it
// caught publishes the thing it exists to remove.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import type { ConformanceCheck, ConformanceStatus } from "./conformance.js";
import { FLEET_MIN_KIT_VERSION, type ServiceContractManifest } from "./schemas.js";
import { localOptInEnvKey } from "./client/local-opt-in.js";
import { clientTransportEnvKeys } from "./client/env-keys.js";
import { scopeHomeDirName } from "./client/app-home.js";
import {
  buildImportGraph,
  importsLocalOptInGate,
  maskSourceComments,
  resolveBinEntry,
  sqliteReachability,
  type ImportGraph,
} from "./conformance-import-graph.js";

/** The result of running a bin once for the black-box check. `stdout` and `stderr` are diagnostics, never credential material. */
export interface BlackboxRunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}
/** Runs `argv` with EXACTLY `env` (nothing inherited) in `cwd`. Injected by tests. */
export type BlackboxRunner = (argv: readonly string[], env: Record<string, string>, cwd: string) => BlackboxRunResult;

export interface ClientContractCheckOptions {
  /** Report findings as `fail` instead of `report`. Off in 1.1.x. */
  strict?: boolean;
  /** Run the black-box fail-closed probe against the BUILT bin when the manifest declares `client.readProbe`. Default true. */
  blackbox?: boolean;
  /** Per-run timeout for the black-box probe. Default 60 s. */
  blackboxTimeoutMs?: number;
  /** The process runner for the black-box probe. Defaults to `spawnSync` of the current runtime. */
  blackboxRunner?: BlackboxRunner;
}

/** Every check id this module emits, in emission order. */
export const CLIENT_CONTRACT_CHECK_IDS = [
  "client_transport_declared",
  "client_sqlite_isolation",
  "client_fail_closed_blackbox",
  "no_mode_vocabulary",
  "no_legacy_hostnames",
  "kit_version_pinned",
] as const;
export type ClientContractCheckId = (typeof CLIENT_CONTRACT_CHECK_IDS)[number];

const MAX_FINDINGS_IN_DETAIL = 8;

function verdict(id: ClientContractCheckId, findings: readonly string[], passDetail: string, strict: boolean): ConformanceCheck {
  if (findings.length === 0) return { id, status: "pass", detail: passDetail };
  const status: ConformanceStatus = strict ? "fail" : "report";
  const shown = findings.slice(0, MAX_FINDINGS_IN_DETAIL);
  const more = findings.length > shown.length ? `; +${findings.length - shown.length} more` : "";
  return { id, status, detail: `${shown.join("; ")}${more}` };
}

interface PackageInfo {
  present: boolean;
  name: string | null;
  bins: Record<string, string>;
  kitPin: string | null;
}

function readPackage(repoRoot: string): PackageInfo {
  const path = join(repoRoot, "package.json");
  if (!existsSync(path)) return { present: false, name: null, bins: {}, kitPin: null };
  try {
    const pkg = JSON.parse(readFileSync(path, "utf8")) as {
      name?: unknown;
      bin?: unknown;
      dependencies?: Record<string, unknown>;
      devDependencies?: Record<string, unknown>;
      optionalDependencies?: Record<string, unknown>;
    };
    const name = typeof pkg.name === "string" ? pkg.name : null;
    const bins: Record<string, string> = {};
    if (typeof pkg.bin === "string" && name) bins[name.replace(/^@[^/]+\//, "")] = pkg.bin;
    else if (pkg.bin && typeof pkg.bin === "object") {
      for (const [bin, target] of Object.entries(pkg.bin as Record<string, unknown>)) if (typeof target === "string") bins[bin] = target;
    }
    const pin = [pkg.dependencies, pkg.devDependencies, pkg.optionalDependencies]
      .map((section) => section?.["@hasna/contracts"])
      .find((value) => typeof value === "string") as string | undefined;
    return { present: true, name, bins, kitPin: pin ?? null };
  } catch {
    return { present: true, name: null, bins: {}, kitPin: null };
  }
}

/** A repo that declares `client: null` is local-by-design: it makes no hosted claim, so the client checks do not apply. */
function localByDesign(manifest: ServiceContractManifest): boolean {
  return manifest.client === null;
}

interface ClientBin {
  surface: string;
  kind: "cli" | "mcp";
  bin: string;
  dataAccess: string | undefined;
}

/** The CLI and MCP bins a client contract governs: declared surfaces first, else the conventional `<name>` / `<name>-mcp` bins. */
function clientBins(manifest: ServiceContractManifest): ClientBin[] {
  const bins: ClientBin[] = [];
  for (const surface of manifest.serviceSurfaces) {
    if (surface.status !== "supported") continue;
    if (surface.kind === "cli" && surface.bin) bins.push({ surface: surface.name, kind: "cli", bin: surface.bin, dataAccess: surface.dataAccess });
    if (surface.kind === "mcp" && surface.mcpBin) bins.push({ surface: surface.name, kind: "mcp", bin: surface.mcpBin, dataAccess: surface.dataAccess });
  }
  if (bins.length === 0) {
    if (manifest.bins.includes(manifest.name)) bins.push({ surface: manifest.name, kind: "cli", bin: manifest.name, dataAccess: undefined });
    if (manifest.bins.includes(`${manifest.name}-mcp`)) bins.push({ surface: `${manifest.name}-mcp`, kind: "mcp", bin: `${manifest.name}-mcp`, dataAccess: undefined });
  }
  return bins;
}

/**
 * `client_transport_declared`: a repo with a CLI or MCP surface and a store
 * must say how its client reaches data — `client.transport: hosted`, or an
 * explicit `client: null` for a local-by-design tool.
 */
export function clientTransportDeclaredCheck(manifest: ServiceContractManifest, options: ClientContractCheckOptions = {}): ConformanceCheck {
  const id = "client_transport_declared";
  const bins = clientBins(manifest);
  if (bins.length === 0) return { id, status: "skip", detail: "no CLI or MCP surface declared" };
  if (!manifest.storage) return { id, status: "skip", detail: "no storage declared; nothing to reach" };
  if (localByDesign(manifest)) return { id, status: "pass", detail: "local-by-design: client is null" };
  const findings: string[] = [];
  if (!manifest.client) {
    findings.push(
      `hasna.contract.json declares ${bins.map((bin) => bin.bin).join(", ")} with storage but no client; declare client.transport: hosted (credentialChain: contracts), or client: null for a local-by-design tool`,
    );
  } else {
    for (const bin of bins) {
      if (bin.dataAccess === undefined) findings.push(`surface ${bin.surface} (${bin.bin}) declares no dataAccess; declare hosted, server-only or local-opt-in`);
    }
    if (!manifest.client.readProbe) findings.push("client.readProbe is not declared, so the black-box fail-closed check cannot run");
  }
  return verdict(id, findings, `client.transport hosted via the contracts credential chain for ${bins.map((bin) => bin.bin).join(", ")}`, options.strict ?? false);
}

/**
 * `client_sqlite_isolation`: no CLI or MCP bin may reach a module that opens a
 * SQLite store through its relative-import graph, except the ONE module the
 * manifest names as `client.localStoreModule` — and that module must import
 * `selectsLocalStore` from `@hasna/contracts` so the door is asked first.
 */
export function clientSqliteIsolationCheck(
  repoRoot: string,
  manifest: ServiceContractManifest,
  options: ClientContractCheckOptions = {},
  graph: ImportGraph = buildImportGraph(repoRoot),
): ConformanceCheck {
  const id = "client_sqlite_isolation";
  const bins = clientBins(manifest).filter((bin) => bin.dataAccess !== "server-only");
  if (bins.length === 0) return { id, status: "skip", detail: "no CLI or MCP surface declared" };
  if (localByDesign(manifest)) return { id, status: "skip", detail: "local-by-design: client is null" };
  const pkg = readPackage(repoRoot);
  if (!pkg.present) return { id, status: "skip", detail: "no package.json found" };
  const allowedModule = manifest.client?.localStoreModule ? resolve(repoRoot, manifest.client.localStoreModule) : null;
  const findings: string[] = [];
  let reachableSqlite = 0;
  for (const bin of bins) {
    const target = pkg.bins[bin.bin];
    if (!target) {
      findings.push(`bin ${bin.bin} is declared in hasna.contract.json but not in package.json bin`);
      continue;
    }
    const entry = resolveBinEntry(repoRoot, target);
    if (!entry) {
      findings.push(`bin ${bin.bin} (${target}) has no resolvable source entry; the import graph cannot be checked`);
      continue;
    }
    const reach = sqliteReachability(graph, entry);
    for (const module of reach.modules) {
      const rel = relative(repoRoot, module);
      const chain = reach.chains[rel]?.join(" -> ") ?? rel;
      if (allowedModule && module === allowedModule) {
        reachableSqlite += 1;
        if (!importsLocalOptInGate(module)) {
          findings.push(`${bin.bin}: client.localStoreModule ${rel} opens a store without importing selectsLocalStore from @hasna/contracts/client`);
        }
        continue;
      }
      findings.push(`${bin.bin} (${bin.kind}) reaches a SQLite module outside client.localStoreModule: ${chain}`);
    }
  }
  const pass =
    reachableSqlite > 0
      ? `only client.localStoreModule opens a store from ${bins.map((bin) => bin.bin).join(", ")}, behind selectsLocalStore`
      : `no SQLite module is reachable from ${bins.map((bin) => bin.bin).join(", ")}`;
  return verdict(id, findings, pass, options.strict ?? false);
}

const STORE_ARTIFACT = /\.(?:db|db-wal|db-shm|db-journal|sqlite|sqlite3|json)$/i;

function filesUnder(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(full);
    }
  };
  walk(root);
  return out;
}

const defaultBlackboxRunner = (timeoutMs: number): BlackboxRunner => (argv, env, cwd) => {
  const result = spawnSync(argv[0]!, argv.slice(1), { cwd, env, encoding: "utf8", timeout: timeoutMs, stdio: ["ignore", "pipe", "pipe"] });
  return { status: result.status, stdout: String(result.stdout ?? ""), stderr: String(result.stderr ?? "") };
};

/**
 * `client_fail_closed_blackbox`: run the BUILT `<name>` bin with an empty HOME,
 * `HASNA_STATION=no-such-station`, `USER=nobody` and no `HASNA_*` variables.
 * The read probe must exit 2 naming `CREDENTIAL_ABSENT` and create no store
 * or JSON file under HOME. With the local door open it must exit 0 and keep
 * its store at `<HOME>/<scope root>/<name>/<name>.db`; with the door open AND a
 * hosted key declared it must exit 6 naming `LOCAL_OPT_IN_CONFLICT`.
 * "Unreadable" cannot be produced black-box; the injected-runner unit tests
 * cover it.
 */
export function clientFailClosedBlackboxCheck(
  repoRoot: string,
  manifest: ServiceContractManifest,
  options: ClientContractCheckOptions = {},
): ConformanceCheck {
  const id = "client_fail_closed_blackbox";
  if (options.blackbox === false) return { id, status: "skip", detail: "disabled by caller" };
  if (localByDesign(manifest)) return { id, status: "skip", detail: "local-by-design: client is null" };
  const probe = manifest.client?.readProbe;
  if (!manifest.client || !probe) return { id, status: "skip", detail: "client.readProbe is not declared" };
  const pkg = readPackage(repoRoot);
  const target = pkg.bins[manifest.name];
  if (!target) return { id, status: "skip", detail: `package.json declares no "${manifest.name}" bin` };
  const binPath = resolve(repoRoot, target);
  const strict = options.strict ?? false;
  if (!existsSync(binPath)) {
    return verdict(id, [`built bin ${relative(repoRoot, binPath)} is missing; build before running the probe`], "", strict);
  }
  const timeoutMs = options.blackboxTimeoutMs ?? 60_000;
  const run = options.blackboxRunner ?? defaultBlackboxRunner(timeoutMs);
  const optIn = manifest.client.localOptIn ?? null;
  const scopeDir = scopeHomeDirName(manifest.scope ?? "public");
  const findings: string[] = [];

  const probeOnce = (label: string, extra: Record<string, string>) => {
    const home = mkdtempSync(join(tmpdir(), "contracts-blackbox-"));
    try {
      const env: Record<string, string> = {
        HOME: home,
        HASNA_STATION: "no-such-station",
        USER: "nobody",
        PATH: process.env.PATH ?? "",
        ...extra,
      };
      const result = run([process.execPath, binPath, ...probe], env, repoRoot);
      const created = filesUnder(home).filter((file) => STORE_ARTIFACT.test(file));
      return { label, result, created: created.map((file) => relative(home, file)), home };
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  };

  const absent = probeOnce("no credential", {});
  if (absent.result.status !== 2) findings.push(`${absent.label}: exit ${absent.result.status ?? "signal"}, expected 2`);
  if (!absent.result.stderr.includes("CREDENTIAL_ABSENT")) findings.push(`${absent.label}: stderr does not name CREDENTIAL_ABSENT`);
  if (absent.created.length > 0) findings.push(`${absent.label}: created ${absent.created.length} store/JSON file(s) under an empty HOME (${absent.created.slice(0, 3).join(", ")})`);

  if (optIn) {
    const local = probeOnce(`${optIn}=1`, { [optIn]: "1" });
    const expectedStore = join(scopeDir, manifest.name, `${manifest.name}.db`);
    if (local.result.status !== 0) findings.push(`${local.label}: exit ${local.result.status ?? "signal"}, expected 0`);
    const stray = local.created.filter((file) => !file.startsWith(join(scopeDir, manifest.name) + "/"));
    if (stray.length > 0) findings.push(`${local.label}: wrote outside ${scopeDir}/${manifest.name}/ (${stray.slice(0, 3).join(", ")})`);
    if (!local.created.includes(expectedStore)) findings.push(`${local.label}: no store at ${expectedStore}`);

    const apiKey = clientTransportEnvKeys(manifest.name).apiKeyKeys[0]!;
    const conflict = probeOnce(`${optIn}=1 with ${apiKey}`, { [optIn]: "1", [apiKey]: "not-a-real-key" });
    if (conflict.result.status !== 6) findings.push(`${conflict.label}: exit ${conflict.result.status ?? "signal"}, expected 6`);
    if (!conflict.result.stderr.includes("LOCAL_OPT_IN_CONFLICT")) findings.push(`${conflict.label}: stderr does not name LOCAL_OPT_IN_CONFLICT`);
  }

  return verdict(
    id,
    findings,
    `${manifest.name} ${probe.join(" ")} exits 2 CREDENTIAL_ABSENT with no store created${optIn ? `; ${optIn}=1 keeps the store at ${scopeDir}/${manifest.name}/ and conflicts exit 6` : ""}`,
    strict,
  );
}

/** Assemble a literal from fragments so this file never spells a token it polices. */
function lit(...parts: string[]): string {
  return parts.join("");
}
function esc(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

interface VocabularyPattern {
  label: string;
  pattern: RegExp;
  /** Only outside the kit itself, which legitimately implements these. */
  outsideContracts?: boolean;
}

/** The retired vocabulary; labels are what a report prints. */
export function noModeVocabularyPatterns(): VocabularyPattern[] {
  const selfHosting = ["self", "hosted"];
  return [
    { label: "mode env var (*_MODE read)", pattern: new RegExp(`(?:process\\.env|\\benv)\\s*(?:\\.|\\[\\s*["'\`])[A-Z][A-Z0-9_]*_MODE\\b`) },
    { label: "storage-mode env var", pattern: new RegExp(`_${lit("STORAGE", "_MODE")}\\b`) },
    { label: "data-backend env var", pattern: new RegExp(`_${lit("DATA", "_BACKEND")}\\b`) },
    { label: "deployment selector env var", pattern: new RegExp(`\\b[A-Z][A-Z0-9_]*_${lit("DEPLOY", "MENT")}\\s*=`) },
    { label: "self-hosting word (underscore)", pattern: new RegExp(selfHosting.join("_"), "i") },
    { label: "self-hosting word (dash)", pattern: new RegExp(selfHosting.join("-"), "i") },
    { label: "mixed-mode word", pattern: new RegExp(`\\b${lit("hyb", "rid")}(?:\\b|_)`, "i") },
    { label: "retired env-file credential tier", pattern: new RegExp(lit("fleet", "[-.]", "env"), "i") },
    { label: "retired cloud runtime config dir", pattern: new RegExp(esc(lit(".hasna", "/", "cloud"))), outsideContracts: true },
    { label: "retired cloud runtime config env", pattern: new RegExp(lit("HASNA_", "CLOUD")), outsideContracts: true },
    { label: "XDG base directory variable", pattern: new RegExp(`\\b${lit("XDG_")}(?:CONFIG|DATA|STATE|CACHE)_HOME\\b`) },
    { label: "macOS library support root", pattern: new RegExp(lit("Application", " ", "Support")) },
    { label: "retired paths package", pattern: new RegExp(esc(lit("@hasna", "/paths")) + "|" + esc(lit("@hasna-", "internal", "/paths"))) },
    { label: "second local door (*_DB_PATH read)", pattern: new RegExp(`(?:process\\.env|\\benv)\\s*(?:\\.|\\[\\s*["'\`])[A-Z][A-Z0-9_]*_DB_PATH\\b`) },
    { label: "own Keychain read outside the seam", pattern: new RegExp(lit("find-generic", "-password")), outsideContracts: true },
    { label: "own credentials-file read outside the seam", pattern: new RegExp(esc(lit("config", "/credentials"))), outsideContracts: true },
  ];
}

function isContractsKit(repoRoot: string, manifest: ServiceContractManifest): boolean {
  return manifest.name === "contracts" && readPackage(repoRoot).name === "@hasna/contracts";
}

function scanSources(
  repoRoot: string,
  graph: ImportGraph,
  patterns: readonly VocabularyPattern[],
  skipOutsideContracts: boolean,
): string[] {
  const findings: string[] = [];
  const active = patterns.filter((pattern) => !(pattern.outsideContracts && skipOutsideContracts));
  for (const file of [...graph.files.keys()].sort()) {
    let text: string;
    try {
      text = maskSourceComments(readFileSync(file, "utf8"));
    } catch {
      continue;
    }
    const lines = text.split("\n");
    for (const { label, pattern } of active) {
      const index = lines.findIndex((line) => pattern.test(line));
      if (index === -1) continue;
      const count = lines.filter((line) => pattern.test(line)).length;
      findings.push(`${relative(repoRoot, file)}:${index + 1} ${label}${count > 1 ? ` (x${count})` : ""}`);
    }
  }
  return findings;
}

/** `no_mode_vocabulary`: shipped source (comments masked, tests excluded) carries none of the retired words or second doors. */
export function noModeVocabularyCheck(
  repoRoot: string,
  manifest: ServiceContractManifest,
  options: ClientContractCheckOptions = {},
  graph: ImportGraph = buildImportGraph(repoRoot),
): ConformanceCheck {
  const id = "no_mode_vocabulary";
  if (graph.files.size === 0) return { id, status: "skip", detail: "no source files found" };
  const findings = scanSources(repoRoot, graph, noModeVocabularyPatterns(), isContractsKit(repoRoot, manifest));
  return verdict(id, findings, `${graph.files.size} source files carry no retired mode vocabulary or second local door`, options.strict ?? false);
}

/** The legacy hostname shapes; labels only, the hostnames themselves are never printed. */
export function noLegacyHostnamePatterns(): VocabularyPattern[] {
  const originApex = ["hasna", "xyz"].join("\\.");
  const internalApex = ["hasna", "internal"].join("\\.");
  const loopbackHost = `(?:${lit("local", "host")}|127\\.0\\.0\\.1|0\\.0\\.0\\.0|\\[::1\\])`;
  return [
    { label: "per-app origin hostname (legacy apex)", pattern: new RegExp(`[a-z0-9-]+\\.${originApex}\\b`, "i") },
    { label: "internal apex hostname", pattern: new RegExp(`[a-z0-9-]+\\.${internalApex}\\b`, "i") },
    { label: "loopback default endpoint", pattern: new RegExp(`https?:\\/\\/${loopbackHost}(?::\\d+)?`, "i") },
  ];
}

/** `no_legacy_hostnames`: shipped source names no per-app origin, internal apex, or loopback default endpoint. */
export function noLegacyHostnamesCheck(
  repoRoot: string,
  manifest: ServiceContractManifest,
  options: ClientContractCheckOptions = {},
  graph: ImportGraph = buildImportGraph(repoRoot),
): ConformanceCheck {
  const id = "no_legacy_hostnames";
  if (graph.files.size === 0) return { id, status: "skip", detail: "no source files found" };
  const findings = scanSources(repoRoot, graph, noLegacyHostnamePatterns(), isContractsKit(repoRoot, manifest));
  return verdict(id, findings, `${graph.files.size} source files name no legacy origin, internal apex, or loopback default`, options.strict ?? false);
}

const EXACT_SEMVER = /^\d+\.\d+\.\d+$/;

function versionAtLeast(version: string, floor: string): boolean {
  const a = version.split(".").map(Number);
  const b = floor.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const left = a[index] ?? 0;
    const right = b[index] ?? 0;
    if (left !== right) return left > right;
  }
  return true;
}

/** `kit_version_pinned`: `kitVersion` equals the exact `@hasna/contracts` dependency pin (no range) and meets the fleet floor. */
export function kitVersionPinnedCheck(repoRoot: string, manifest: ServiceContractManifest, options: ClientContractCheckOptions = {}): ConformanceCheck {
  const id = "kit_version_pinned";
  if (isContractsKit(repoRoot, manifest)) return { id, status: "skip", detail: "the kit itself; its version is its kitVersion" };
  const pkg = readPackage(repoRoot);
  if (!pkg.present) return { id, status: "skip", detail: "no package.json found" };
  const findings: string[] = [];
  if (!pkg.kitPin) {
    findings.push("package.json declares no @hasna/contracts dependency; pin the exact kit version");
  } else if (!EXACT_SEMVER.test(pkg.kitPin)) {
    findings.push(`@hasna/contracts is pinned as a range (${pkg.kitPin}); pin the exact version`);
  } else if (pkg.kitPin !== manifest.kitVersion) {
    findings.push(`kitVersion ${manifest.kitVersion} differs from the @hasna/contracts pin ${pkg.kitPin}`);
  }
  if (EXACT_SEMVER.test(manifest.kitVersion) && !versionAtLeast(manifest.kitVersion, FLEET_MIN_KIT_VERSION)) {
    findings.push(`kitVersion ${manifest.kitVersion} is below the fleet floor ${FLEET_MIN_KIT_VERSION}`);
  } else if (!EXACT_SEMVER.test(manifest.kitVersion)) {
    findings.push(`kitVersion ${manifest.kitVersion} is not an exact version`);
  }
  return verdict(id, findings, `kitVersion ${manifest.kitVersion} equals the exact pin and meets the fleet floor ${FLEET_MIN_KIT_VERSION}`, options.strict ?? false);
}

/** All six client-contract checks, in the documented order. */
export function clientContractChecks(repoRoot: string, manifest: ServiceContractManifest, options: ClientContractCheckOptions = {}): ConformanceCheck[] {
  const graph = buildImportGraph(repoRoot);
  return [
    clientTransportDeclaredCheck(manifest, options),
    clientSqliteIsolationCheck(repoRoot, manifest, options, graph),
    clientFailClosedBlackboxCheck(repoRoot, manifest, options),
    noModeVocabularyCheck(repoRoot, manifest, options, graph),
    noLegacyHostnamesCheck(repoRoot, manifest, options, graph),
    kitVersionPinnedCheck(repoRoot, manifest, options),
  ];
}
