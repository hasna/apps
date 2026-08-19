/**
 * Member census + exception registry for the standard-adherence suite.
 *
 * DESIGN (f05fe292, 2026-08-15): the census exception records are a
 * REPORTING lane — the hand-refresh loop is gone. New (unrecorded)
 * violations auto-file a reconcile task keyed on a stable fingerprint and
 * are reported; the suite passes while reporting them. The two-sided
 * registry contract is UNCHANGED and load-bearing: a member IN the registry
 * must actually FAIL today — a recorded exception whose member now passes
 * (stale entry) still fails the suite until the entry is deleted — and a
 * member NOT in the registry must PASS (its violations are the auto-filed
 * reporting set). The contracts-manifest and kitVersion checks remain hard
 * gates (recorded exceptions allowed, stale records still fail); the
 * recorded-exception-must-still-fail direction fires in every lane.
 *
 * Historical record of the refresh loop this design replaces (kept for
 * provenance, not as a procedure): measured 2026-08-14 against
 * origin/main @ ce470e4ad; refreshed by the integrator lane at the
 * ci/test-suites merge ref (2026-08-14) for the imports that landed after
 * that base — connectors (#80), shield (#74), terminal (#88). Refreshed
 * again 2026-08-14 by the ci/test-suites iterate-to-green fixer at the
 * fresh merge of current main (a7d60a96, todos import #105): files (#90)
 * gained hasna.contract.json (contracts conformance + kitVersion records
 * added, task b0845699), instructions kitVersion advanced to 0.10.6 by
 * #111 (record added, task 8417a133), and todos (#105) gained a
 * pre-backend-schema-era manifest validated at pinned 0.5.2 (conformance +
 * kitVersion records added, task 0ad82b16). The monitor (#97) and testers
 * (#95) imports landed 2026-08-14: monitor gained a conformance +
 * NO_VALIDATOR_PIN record (bins_match_package — package ships
 * monitor-server/monitor-web the manifest does not declare; task d2c6d20f)
 * plus serve/sdk WARN records, testers gained an sdk WARN record.
 * The telephony conformance record was REMOVED 2026-08-14 after CI
 * (clean environment, no HASNA_TELEPHONY_STORAGE_MODE) reported it as a
 * recorded exception that now passes: the mode_enum_compliance violation
 * fires only where the removed runtime-placement env var is still set
 * (station01 deployment state; remediation task 26ad6a16 stays open for
 * the deployment-side cleanup).
 * Refreshed 2026-08-15 by the fixer for the ci/test-suites main-gate
 * break (todos ee9fbb4d) at origin/main @ 607c03ec, after the
 * deployment-modes vocabulary-removal family landed (#124 machines,
 * #123 telephony, #122 accounts): the machines conformance record was
 * REMOVED — #124 bumped @hasna/contracts to 0.10.6 and its manifest now
 * validates clean. Cause strings refreshed to exact current
 * failure text for calendar, catalog, emails, instructions, prompts and
 * shield. Locally on station01, machines and telephony still report
 * server_backend_configuration because the retired HASNA_*_STORAGE_MODE
 * env vars remain exported in the interactive shell (deployment residue,
 * same class as the telephony note above; machines cleanup is part of
 * todos 7abbf333, telephony 26ad6a16) — in CI's clean environment both
 * pass and neither has a registry entry.
 * 2026-08-15 (this change): skills' SDK exception entry DELETED — the
 * member now ships ./sdk, so the recorded exception that passes was a
 * stale-entry failure under the two-sided contract; and the loops
 * credential_seam_compliance violation (unrecorded at the 0.10.6
 * validator) auto-files its reconcile task rather than failing the suite.
 * 2026-08-18 (this change): treasury's SDK exception entry DELETED — the
 * member now ships ./sdk, so the recorded exception that passes was a
 * stale-entry failure under the two-sided contract (main-gate repair,
 * todos b66b3f04).
 * 2026-08-18 (rebase repair, todos b66b3f04): the context and crawl
 * manifest-missing exception entries DELETED — both members gained
 * hasna.contract.json in the contracts-align wave 2 merges, so the
 * recorded exceptions that passed were stale-entry failures under the
 * two-sided contract. They are recorded in NO_VALIDATOR_PIN pending a
 * validator pin. The datasets CONTRACTS_EXCEPTIONS entry DELETED — the
 * member's manifest now wires artifactScan (contracts task 226bfc01
 * completed). Its kit/pin mismatch (kit 0.11.1, pinned 0.10.6) is
 * RECORDED in KIT_VERSION_EXCEPTIONS: the code imports parseContract,
 * which contracts 0.11.1 does not export, so the pin stays 0.10.6 until
 * the API migration lands (measured: pin bump to ^0.11.1 breaks the
 * datasets prepare build).
 * 2026-08-19 (current-main rebase, todos b66b3f04): the validator at
 * @hasna/contracts 0.11.1 now passes the previously recorded docs, draw,
 * hooks, loops, mementos, orgs, releases, router, search and ui entries;
 * those stale conformance entries were deleted. Current kit/pin drift for
 * hooks (0.8.4/0.11.1), mementos (0.11.1/0.10.6) and orgs (0.10.6/0.11.1)
 * is recorded in KIT_VERSION_EXCEPTIONS pending their pin migrations.
 * The exception registry is DATA, not prose: every entry
 * is keyed to a measured violation class and carries the reason and the
 * tracked remediation task. When a violation is fixed, DELETE its exception
 * entry — a check that cannot fail is not a check.
 *
 * The four-surface standard (repo law 4 in AGENTS.md): every publishable
 * member ships a `<name>` CLI bin (HARD), an `<name>-mcp` bin, an
 * `<name>-serve` bin and an `./sdk` export (the last three WARN, P5-census
 * exceptions below). The SDK WARNs are owned by the standing P5 lane
 * (todos c7ce8b75-3d4e-4376-854c-875cd20c605b).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
export const APPS_DIR = path.join(REPO_ROOT, "apps");

/** Contract validator resolution: pinned dep >= 0.4.1 exposes
 * repo-conformance (measured: 0.2.2 does not). Below that, the manifest's
 * kitVersion is tried; kit versions missing from npm (0.8.3) or too old for
 * the subcommand (0.1.0) fall back to `latest`. */
export const MIN_VALIDATOR_VERSION = "0.4.1";

/** Numeric segment compare — "0.10.4" >= "0.4.1" must be TRUE (string
 * compare gets this wrong: "1" < "4"). */
export function versionAtLeast(v: string, min: string): boolean {
  const a = v.split(".").map(Number);
  const b = min.split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av !== bv) return av > bv;
  }
  return true;
}

/** Effective validator version for a member: the pinned @hasna/contracts
 * dependency when it exposes `repo-conformance` (>= MIN_VALIDATOR_VERSION);
 * else the manifest's kitVersion when that version exists on npm; else
 * `latest`. Shared by the standard-adherence suite and the
 * check-manifests CI gate, so both validate at the same effective version. */
export function resolveValidatorVersion(pinned: string | undefined, kitVersion: string | undefined, known: Set<string>): string {
  if (pinned && versionAtLeast(pinned, MIN_VALIDATOR_VERSION)) return pinned;
  if (kitVersion && known.has(kitVersion)) return kitVersion;
  return "latest";
}

/** Run the canonical manifest validator (`contracts repo-conformance` from
 * @hasna/contracts) against one member directory. Returns a verdict and the
 * raw output. Shared by the standard-adherence suite and the check-manifests
 * CI gate, so a member is validated by exactly the same invocation in both. */
export function runConformance(dir: string, version: string): { verdict: "ok" | "fail" | "cannot-run"; fails: string[]; raw: string } {
  const res = spawnSync("bunx", ["--bun", `@hasna/contracts@${version}`, "repo-conformance", dir], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: 180_000,
    maxBuffer: 32 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout = String(res.stdout ?? "");
  const stderr = String(res.stderr ?? "");
  const raw = `${stdout}\n${stderr}`;
  const lines = raw.split("\n");
  const verdictLine = lines.find((l) => /^(ok|fail) hasna\.service_contract\.v1/.test(l.trim()));
  const fails = lines.filter((l) => l.trimStart().startsWith("fail ")).slice(1); // drop the verdict line itself
  if (!verdictLine) {
    const errLine = lines.find((l) => l.trim().startsWith("error:"));
    return { verdict: "cannot-run", fails: fails.length ? fails : [errLine?.trim() ?? `no verdict line; rc=${res.status}`], raw };
  }
  return { verdict: verdictLine.trim().startsWith("ok ") ? "ok" : "fail", fails: fails.map((f) => f.trim()), raw };
}

export interface Member {
  name: string;
  pkgName: string;
  publishable: boolean;
  license: string;
  access: string | undefined;
  bins: string[];
  hasCli: boolean;
  hasMcp: boolean;
  hasServe: boolean;
  hasSdk: boolean;
  hasManifest: boolean;
  hasFilesField: boolean;
  contractsDep: string | undefined;
}

export function membersIn(appsDir: string): Member[] {
  return fs
    .readdirSync(appsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => fs.existsSync(path.join(appsDir, name, "package.json")))
    .map((name) => {
      const pkg = JSON.parse(fs.readFileSync(path.join(appsDir, name, "package.json"), "utf8")) as Record<
        string,
        unknown
      >;
      const bins = Object.keys((pkg.bin as Record<string, string> | undefined) ?? {});
      const exports = (pkg.exports as Record<string, unknown> | undefined) ?? {};
      const allDeps = { ...((pkg.dependencies as Record<string, string>) ?? {}), ...((pkg.devDependencies as Record<string, string>) ?? {}) };
      let hasManifest = false;
      try {
        hasManifest = fs.statSync(path.join(appsDir, name, "hasna.contract.json")).isFile();
      } catch {
        hasManifest = false;
      }
      return {
        name,
        pkgName: String(pkg.name ?? ""),
        publishable: pkg.private !== true,
        license: String(pkg.license ?? ""),
        access: (pkg.publishConfig as Record<string, unknown> | undefined)?.access as string | undefined,
        bins,
        hasCli: bins.includes(name),
        hasMcp: bins.includes(`${name}-mcp`),
        hasServe: bins.includes(`${name}-serve`),
        hasSdk: exports["./sdk"] !== undefined,
        hasManifest,
        hasFilesField: Array.isArray(pkg.files),
        contractsDep: allDeps["@hasna/contracts"]?.replace(/^\^/, ""),
      };
    });
}

export function members(): Member[] {
  return membersIn(APPS_DIR);
}

export function publishableMembers(): Member[] {
  return members().filter((m) => m.publishable);
}

/** Members recorded as non-publishable. Measured 2026-08-14: NONE — every
 * member under apps/ has `private` unset/false and publishes a public
 * @hasna/* package. Kept as data so a future private member fails the
 * suite until it is deliberately recorded here. */
export const NON_PUBLISHABLE: string[] = [];

/** publishConfig.access === "public" is required for every publishable
 * member. Exceptions: none — the one member lacking publishConfig
 * (actions) was fixed in this suite's landing change; the fix is tracked
 * by todos 14a7ddcb-5068-41dd-a9eb-4278ceca22d9. */
export const PUBLISH_CONFIG_EXCEPTIONS: string[] = [];

/** private:true members recorded as intentional non-publishables. None
 * measured. */
export const PRIVATE_TRUE_EXCEPTIONS: string[] = [];

/** license must be Apache-2.0. Recorded exceptions (each with reason): */
export const LICENSE_EXCEPTIONS: Array<{ member: string; license: string; reason: string }> = [
  {
    member: "ui",
    license: "MIT",
    reason: "Intentional: apps/ui is the ui.sh skill mirror; its LICENSE file is MIT (Copyright (c) 2026 hasna). Revisit only if the org standard is applied retroactively.",
  },
  {
    member: "notes",
    license: "MIT",
    reason: "Imported as-is from hasna/notes: the repository LICENSE file is MIT (Copyright (c) 2026 Hasna); the license field follows the repo's own LICENSE file. Revisit only if the org standard is applied retroactively.",
  },
];

/** Four-surface WARN exceptions — members missing the <name>-mcp bin. */
export const MCP_EXCEPTIONS: Array<{ member: string; reason: string }> = [
  { member: "automations", reason: "Daemon-shaped member (automations-daemon); no MCP surface declared." },
  { member: "contracts", reason: "Library-shaped (manifest validator kit); ships `contracts` + `contracts-cli` bins only." },
  { member: "docs", reason: "Docs/instruction renderer; library-shaped, no MCP surface." },
  { member: "draw", reason: "Library-shaped (canvas/design tokens); no MCP surface." },
  { member: "guardrails", reason: "Library-shaped (guardrail policies); no MCP surface." },
  { member: "hooks", reason: "CLI+serve member (hooks registry/serve); no MCP surface yet." },
  { member: "models", reason: "Library-shaped (model metadata); no MCP surface." },
  { member: "orgs", reason: "Registry-shaped; no MCP surface." },
  { member: "router", reason: "Gateway-shaped; no MCP surface." },
  { member: "sheets", reason: "Library-shaped (spreadsheet format); no MCP surface." },
  { member: "slides", reason: "Library-shaped; no MCP surface (also missing the HARD CLI bin — see CLI_EXCEPTIONS)." },
  { member: "tables", reason: "Library-shaped (tabular data); no MCP surface." },
  { member: "terminal", reason: "CLI-only member (terminal tooling); no MCP surface. Imported by #88 after the original census; aggregate task (todos 35e136f2)." },
  { member: "ui", reason: "Legacy ui.sh mirror; single `ui` bin, no MCP surface." },
];

/** Four-surface WARN exceptions — members missing the <name>-serve bin. */
export const SERVE_EXCEPTIONS: Array<{ member: string; reason: string }> = [
  { member: "actions", reason: "Library-shaped (action contracts); no server surface." },
  { member: "announce", reason: "CLI-only member; no server surface." },
  { member: "automations", reason: "Daemon-shaped (automations-daemon); no HTTP serve bin." },
  { member: "banking", reason: "Client-shaped (bank data access); no server surface." },
  { member: "bridge", reason: "Client-shaped (bridge to other tools); no server surface." },
  { member: "contracts", reason: "Library-shaped (manifest validator kit); no server surface." },
  { member: "catalog", reason: "Local read model; the HTTP read API is a documented local dev convenience bound to loopback (README 'Security and deployment scope'), not a supported service surface — the manifest declares the api surface deferred with that reason." },
  { member: "datasets", reason: "CLI-only member; no server surface." },
  { member: "dispatch", reason: "Dispatch daemon surface only; no HTTP serve bin." },
  { member: "docs", reason: "Docs renderer; no server surface." },
  { member: "draw", reason: "Library-shaped; no server surface." },
  { member: "guardrails", reason: "Library-shaped; no server surface." },
  { member: "mcps", reason: "CLI-only member (MCP registry tooling); no server surface." },
  { member: "models", reason: "Library-shaped; no server surface." },
  { member: "monitor", reason: "CLI+MCP member (system monitoring); no server surface. Imported by #97 after the original census; aggregate task (todos 35e136f2)." },
  { member: "orgs", reason: "Registry-shaped; no server surface." },
  { member: "pixels", reason: "CLI/MCP-shaped (browser pixel + MCP clients); no server surface. Imported by #69." },
  { member: "releases", reason: "CLI-only member; no server surface." },
  { member: "router", reason: "Gateway-shaped; no server surface." },
  { member: "servers", reason: "CLI-only member (server lifecycle tooling); no server surface." },
  { member: "sheets", reason: "Library-shaped; no server surface." },
  { member: "skills", reason: "CLI-only member (skill corpus tooling); no server surface." },
  { member: "slides", reason: "Library-shaped; no server surface (also missing the HARD CLI bin — see CLI_EXCEPTIONS)." },
  { member: "statusline", reason: "CLI-only member; no server surface." },
  { member: "styles", reason: "Library-shaped (style tokens); no server surface." },
  { member: "tables", reason: "Library-shaped; no server surface." },
  { member: "tai", reason: "Client-shaped; no server surface." },
  { member: "terminal", reason: "CLI-only member (terminal tooling); no server surface. Imported by #88 after the original census; aggregate task (todos 35e136f2)." },
  { member: "ui", reason: "Legacy ui.sh mirror; no server surface." },
];

/** Four-surface WARN exceptions — members missing the ./sdk export. The
 * SDK standardization lane is tracked by todos c7ce8b75-3d4e-4376-854c-875cd20c605b
 * ([P5] Standardize typed ./sdk exports + embedding contracts); entries
 * here reference it. */
export const SDK_EXCEPTIONS: Array<{ member: string; reason: string }> = [
  { member: "access", reason: "SDK lane (c7ce8b75); no ./sdk export yet." },
  { member: "announce", reason: "SDK lane (c7ce8b75); no ./sdk export yet." },
  { member: "attachments", reason: "SDK lane (c7ce8b75); no ./sdk export yet." },
  { member: "automations", reason: "SDK lane (c7ce8b75); no ./sdk export yet." },
  { member: "banking", reason: "SDK lane (c7ce8b75); no ./sdk export yet." },
  { member: "billing", reason: "SDK lane (c7ce8b75); no ./sdk export yet." },
  { member: "brains", reason: "SDK lane (c7ce8b75); no ./sdk export yet." },
  { member: "bridge", reason: "SDK lane (c7ce8b75); no ./sdk export yet." },
  { member: "catalog", reason: "SDK lane (c7ce8b75); no ./sdk export yet." },
  { member: "changelog", reason: "SDK lane (c7ce8b75); no ./sdk export yet." },
  { member: "computer", reason: "SDK lane (c7ce8b75); no ./sdk export yet." },
  { member: "consolidations", reason: "SDK lane (c7ce8b75); no ./sdk export yet." },
  { member: "context", reason: "SDK lane (c7ce8b75); no ./sdk export yet." },
  { member: "controls", reason: "SDK lane (c7ce8b75); no ./sdk export yet." },
  { member: "crawl", reason: "SDK lane (c7ce8b75); no ./sdk export yet." },
  { member: "connectors", reason: "SDK lane (c7ce8b75); no ./sdk export yet. Imported by #80 after the original census." },
  { member: "datasets", reason: "SDK lane (c7ce8b75); no ./sdk export yet." },
  { member: "docs", reason: "SDK lane (c7ce8b75); no ./sdk export yet." },
  { member: "draw", reason: "SDK lane (c7ce8b75); no ./sdk export yet." },
  { member: "emails", reason: "SDK lane (c7ce8b75); no ./sdk export yet." },
  { member: "evals", reason: "SDK lane (c7ce8b75); no ./sdk export yet." },
  { member: "fleet", reason: "SDK lane (c7ce8b75); no ./sdk export yet." },
  { member: "gateway", reason: "SDK lane (c7ce8b75); no ./sdk export yet." },
  { member: "holdings", reason: "SDK lane (c7ce8b75); no ./sdk export yet." },
  { member: "hooks", reason: "SDK lane (c7ce8b75); no ./sdk export yet." },
  { member: "instructions", reason: "SDK lane (c7ce8b75); no ./sdk export yet." },
  { member: "logs", reason: "SDK lane (c7ce8b75); no ./sdk export yet." },
  { member: "markdown", reason: "SDK lane (c7ce8b75); no ./sdk export yet." },
  { member: "mcps", reason: "SDK lane (c7ce8b75); no ./sdk export yet." },
  { member: "models", reason: "SDK lane (c7ce8b75); no ./sdk export yet." },
  { member: "testers", reason: "SDK lane (c7ce8b75); no ./sdk export yet. Imported by #95 after the original census." },
  { member: "orgs", reason: "SDK lane (c7ce8b75); no ./sdk export yet." },
  { member: "pixels", reason: "SDK lane (c7ce8b75); no ./sdk export yet. Imported by #69." },
  { member: "prompts", reason: "SDK lane (c7ce8b75); no ./sdk export yet." },
  { member: "releases", reason: "SDK lane (c7ce8b75); no ./sdk export yet." },
  { member: "repos", reason: "SDK lane (c7ce8b75); no ./sdk export yet." },
  { member: "router", reason: "SDK lane (c7ce8b75); no ./sdk export yet." },
  { member: "servers", reason: "SDK lane (c7ce8b75); no ./sdk export yet." },
  { member: "sheets", reason: "SDK lane (c7ce8b75); no ./sdk export yet." },
  { member: "signatures", reason: "SDK lane (c7ce8b75); no ./sdk export yet." },
  { member: "search", reason: "SDK lane (c7ce8b75); no ./sdk export yet. Imported by #68." },
  { member: "slides", reason: "SDK lane (c7ce8b75); no ./sdk export yet." },
  { member: "snapshots", reason: "SDK lane (c7ce8b75); no ./sdk export yet." },
  { member: "statusline", reason: "SDK lane (c7ce8b75); no ./sdk export yet." },
  { member: "styles", reason: "SDK lane (c7ce8b75); no ./sdk export yet." },
  { member: "tables", reason: "SDK lane (c7ce8b75); no ./sdk export yet." },
  { member: "telephony", reason: "SDK lane (c7ce8b75); no ./sdk export yet." },
  { member: "terminal", reason: "SDK lane (c7ce8b75); no ./sdk export yet. Imported by #88 after the original census." },
  { member: "tickets", reason: "SDK lane (c7ce8b75); no ./sdk export yet." },
  { member: "ui", reason: "Legacy ui.sh mirror; SDK lane (c7ce8b75)." },
];

/** HARD four-surface exceptions — members missing the `<name>` CLI bin.
 * These are the only four-surface violations that are task-mandated (the
 * bin must NOT be invented in-suite; remediation is a tracked task). */
export const CLI_EXCEPTIONS: Array<{ member: string; reason: string; task: string }> = [
  {
    member: "slides",
    reason: "Library-shaped member; no public `slides` CLI bin. Remediation task filed.",
    task: "todos 62ec9dbc (slides missing CLI bin)",
  },
];

/** hasna.contract.json must exist for every publishable member. Members
 * measured without one (25 — 24 at the original census, connectors +
 * terminal added by the integrator lane for imports #80/#88, hooks removed
 * when #102 added its manifest on 2026-08-14) — each recorded with the
 * manifest lane pointer (aggregate task; see README). */
export const MANIFEST_MISSING_EXCEPTIONS: Array<{ member: string; reason: string }> = [
  { member: "brains", reason: "No hasna.contract.json; manifest lane (todos 41208cbe)." },
  { member: "browser", reason: "No hasna.contract.json; manifest lane (todos 41208cbe)." },
  { member: "computer", reason: "No hasna.contract.json; manifest lane (todos 41208cbe)." },
  { member: "evals", reason: "No hasna.contract.json; manifest lane (todos 41208cbe)." },
  { member: "repos", reason: "No hasna.contract.json; manifest lane (todos 41208cbe)." },
  { member: "skills", reason: "No hasna.contract.json; manifest lane (todos 41208cbe)." },
  { member: "snapshots", reason: "No hasna.contract.json; manifest lane (todos 41208cbe)." },
  { member: "statusline", reason: "No hasna.contract.json; manifest lane (todos 41208cbe)." },
  { member: "styles", reason: "No hasna.contract.json; manifest lane (todos 41208cbe)." },
  { member: "tai", reason: "No hasna.contract.json; manifest lane (todos 41208cbe)." },
  { member: "tickets", reason: "No hasna.contract.json; manifest lane (todos 41208cbe)." },
  { member: "connectors", reason: "No hasna.contract.json; imported by #80 after the original census; manifest lane (todos 41208cbe)." },
  { member: "terminal", reason: "No hasna.contract.json; imported by #88 after the original census; manifest lane (todos 41208cbe)." },
];

/** Contracts conformance exceptions — members whose manifest does not pass
 * `contracts repo-conformance` at the resolved validator version. Each
 * carries the measured failure cause and the filed remediation task. */
export const CONTRACTS_EXCEPTIONS: Array<{ member: string; cause: string; task: string }> = [
  {
    member: "accounts",
    cause: "manifest_valid: pre-backend-schema-era manifest after #122 (deployment-mode vocabulary removal) validated at pinned 0.5.2 — storage.mode Required; storage Unrecognized key(s) in object: 'backend','engines','pgTestGate'; serviceSurfaces.*.deploymentModes Required; serviceSurfaces.* Unrecognized key(s) in object: 'kind'/'exportSubpath'/'generatedFrom'.",
    task: "todos f6869bad-0aa9-466a-824b-b4a76a0b9b7b (contracts task — accounts)",
  },
  {
    member: "calendar",
    cause: "manifest_valid at pinned 0.4.2 (mode-era schema vs mixed-era manifest): storage.mode Invalid enum value. Expected 'local' | 'cloud', received 'sqlite'; storage Unrecognized key(s) in object: 'engines', 'pgTestGate'; <root> Unrecognized key(s) in object: 'hosting', 'serviceSurfaces'. The earlier mode_enum_compliance env-var cause no longer fires.",
    task: "todos a967c9bd (contracts task — calendar)",
  },
  {
    member: "conversations",
    cause: "bins_match_package: package.json ships bins conversations-inbox and conversations-hook that the manifest does not declare (manifest declares conversations, conversations-mcp, conversations-serve only). Imported by #100 after the original census; validated at pinned ^0.4.2 (kitVersion 0.4.2).",
    task: "todos ee9fbb4d (import row — conversations; reconcile the two bins against the manifest or extend the manifest's bins)",
  },
  {
    member: "controls",
    cause: "manifest_valid at pinned 0.4.1 (mode-era validator vs backend-era manifest, modes-removal lane): storage.mode Required; storage Unrecognized key(s) in object: 'backend'. The mode vocabulary is removed from the app; the two-backend schema (storage.backend sqlite|postgresql, no mode) ships with the contracts lane, which also must regenerate the vendor-kit without mode.ts.",
    task: "todos reconcile task 'Reconcile @hasna/controls contracts conformance: manifest_valid' (auto-filed by the standard suite; resolves when the contracts lane publishes the two-backend validator and controls re-pins)",
  },
  {
    member: "economy",
    cause: "manifest_valid: manifest (imported by #147) declares bin economy-otel, which is not in ALLOWED_BIN_SUFFIXES; npm @hasna/economy 0.3.9 ships the bin (faithful import), so the exception is recorded until the allowlist or the bin is reconciled.",
    task: "todos 2a70ece0-d4af-4aae-bea8-4dff128a38ca (contracts task — economy)",
  },
  {
    member: "events",
    cause: "bins_match_package: package.json ships bin hasna-events (alias of events, npm parity with 0.1.15) that the manifest does not declare; hasna-events is not in CANONICAL_HASNA_BIN_ALIASES so it can never be allowlisted. Imported by #160.",
    task: "todos 9b78ba7e-d859-4928-a999-3184fa6baf97 (contracts task — events)",
  },
  {
    member: "feedback",
    cause: "surface_matrix: missing supported api surface (feedback-serve publishes no /ready, /version, or /openapi.json; api surface deferred truthfully); self_host_artifact: no Dockerfile/docker-compose; storage_capabilities: pgTestGate required; service_api_topology: no supported API surface. Manifest schema-valid at kit 0.11.1.",
    task: "todos 5e31148b-6552-44ea-93ba-d7c4e1676079 (contracts task — feedback)",
  },
  {
    member: "files",
    cause: "manifest_valid: service-class manifest declares no service surface (service repos must declare at least one). Imported by #90 after the original census; validated at pinned 0.5.2.",
    task: "todos b0845699-4e54-49f7-817e-025d4f6ca270 (contracts task — files)",
  },
  {
    member: "gateway",
    cause: "surface_matrix: missing sdk surface (no ./sdk export; SDK lane c7ce8b75); self_host_artifact: no Dockerfile/docker-compose; storage_capabilities: pgTestGate required; published_artifact_gate: artifactScan.script required. Manifest schema-valid at kit 0.11.1.",
    task: "todos 9dc0ee28 (contracts task — gateway)",
  },
  {
    member: "instructions",
    cause: "bins_match_package: package.json ships legacy alias bins configs/configs-mcp (fleet-compat, not contract-allowlisted — same class as the recorded economy hasna-events precedent); surface_matrix: missing sdk surface (no ./sdk export; SDK lane c7ce8b75); storage_capabilities: pgTestGate required; published_artifact_gate: artifactScan.script required; credential_seam_compliance: src/db/database.ts reads HASNA_INSTRUCTIONS_API_KEY from the process environment. Manifest schema-valid at kit 0.11.1.",
    task: "todos c15cca18 (contracts task — instructions)",
  },
  {
    member: "knowledge",
    cause: "manifest_valid: service-class manifest declares no service surface (service repos must declare at least one).",
    task: "todos a8c97621 (contracts task — knowledge)",
  },
  {
    member: "logs",
    cause: "surface_matrix: missing supported sdk surface (no ./sdk export; SDK deferred truthfully); storage_capabilities: pgTestGate required; published_artifact_gate: artifactScan.script required. Manifest schema-valid at kit 0.11.1.",
    task: "todos d166125e (contracts task — logs)",
  },
  {
    member: "markdown",
    cause: "surface_matrix (api/sdk missing or unwaived; cli-with-store shipping markdown-serve requires all four surfaces) and service_api_topology (a supported API surface is required — markdown-serve implements GET /health and POST /validate,/compile,/inspect,/lint,/run but no GET /ready or GET /version); self_host_artifact (no Dockerfile/compose at the app root); storage_capabilities (storage.pgTestGate is required to prove live PostgreSQL support — the optional Postgres feedback mirror has no PG test command). Manifest created by the contracts-alignment-r2 missing-manifest lane; server-topology and self-host work is the follow-up.",
    task: "todos 1bfb26b7-05eb-4cf5-9762-e554afd02de6 (contracts-alignment-r2 missing-manifest lane)",
  },
  {
    member: "monitor",
    cause: "bins_match_package: package.json ships bins monitor-server and monitor-web that the manifest does not declare (manifest declares monitor, monitor-mcp only). Imported by #97 after the original census; validated at kitVersion 0.8.5 (no pinned dep).",
    task: "todos d2c6d20f-7c80-4b84-ae35-a92ce866bc14 (contracts task — monitor)",
  },
  {
    member: "pixels",
    cause: "surface_matrix: missing supported surface declarations or eligible waivers: api, sdk, mcp; published_artifact_gate: metadata.release.artifactScan.script is required for a published package: name the script that scans the PACKED artifact, then wire it into prepack. Imported by the delta lane from the org-side manifest (kitVersion 0.10.6, no pinned dep); alignment owned by the manifest lane.",
    task: "todos 41208cbe (manifest lane — align imported pixels manifest)",
  },
  {
    member: "prompts",
    cause: "surface_matrix (api/sdk missing or unwaived) and service_api_topology (a supported API surface is required). (The earlier self_host_artifact and storage_capabilities causes no longer fire at main.)",
    task: "todos eb3f331d (contracts task — prompts)",
  },
  {
    member: "sheets",
    cause: "manifest_valid: unrecognized 'exports' key at root; library-repo storage shape drift.",
    task: "todos d766ac9c (contracts task — sheets)",
  },
  {
    member: "signatures",
    cause: "manifest_valid: storage.engines must declare both sqlite and postgres unless a metadata.conformance.waivedStorageEngines waiver exists; postgres missing.",
    task: "todos 7001d8d7 (contracts task — signatures)",
  },
  {
    member: "slides",
    cause: "surface_matrix: no supported cli surface declared; library-class cli waivers are not permitted by the kit and slides ships no CLI bin (package.json bin is empty; the SDK is the consumer surface). Declared cli deferred truthfully in the manifest. published_artifact_gate fixed (scan:artifact wired into prepack).",
    task: "todos ccc2e931 (contracts task — slides)",
  },
  {
    member: "tables",
    cause: "kitVersion 0.1.0 predates repo-conformance; no @hasna/contracts dep pinned; validated at latest, manifest is pre-backend-schema era.",
    task: "todos daaa2841 (contracts task — tables)",
  },
  {
    member: "shield",
    cause: "surface_matrix/service_api_topology: api and sdk surfaces declared deferred truthfully (shield-serve has no GET /ready, GET /version, /v1 base, or /openapi.json), so no supported API surface exists; the kit requires one for a service-capable cli-with-store. storage.engines postgresql is validator-forced (kit refuses the waiver for service-capable cli-with-store) and disclosed in metadata.conformance.notes. Mode vocabulary removed from src/db/database.ts and README.",
    task: "todos 2aceeb94-7077-4479-b61a-0a7b33b856f7 (contracts task — shield)",
  },
  {
    member: "tenants",
    cause: "manifest_valid at pinned 0.4.2 (mode-era validator vs backend-era manifest, kitVersion 0.10.6): storage.mode Required; storage Unrecognized key(s) in object: 'backend','engines'; <root> Unrecognized key(s) in object: 'hosting','serviceSurfaces'. Manifest imported with the org delta (e74cb94) from hasna/tenants.",
    task: "todos 03671218-84ac-4859-9b8d-ff6cedeef82a (contracts task — tenants)",
  },
  {
    member: "todos",
    cause: "manifest_valid: pre-backend-schema-era manifest (kitVersion 0.8.4) validated at pinned 0.5.2 — storage.mode Invalid enum value. Expected 'local' | 'cloud', received 'sqlite'; storage Unrecognized key(s) in object: 'engines', 'pgTestGate'; serviceSurfaces.*.deploymentModes Required; serviceSurfaces.* Unrecognized key(s) in object: 'kind'/'exportSubpath'/'generatedFrom'; <root> Unrecognized key(s) in object: 'hosting'. Imported by #105 after the original census.",
    task: "todos 0ad82b16-5a7c-43c3-95b9-db2dc64f7ffa (contracts task — todos)",
  },
];

/** kitVersion must match the member's pinned @hasna/contracts version
 * (normalized). Recorded mismatches: */
export const KIT_VERSION_EXCEPTIONS: Array<{ member: string; kitVersion: string; pinned: string }> = [
  { member: "accounts", kitVersion: "0.10.6", pinned: "0.5.2" },
  { member: "calendar", kitVersion: "0.8.4", pinned: "0.4.2" },
  { member: "datasets", kitVersion: "0.11.1", pinned: "0.10.6" },
  { member: "domains", kitVersion: "0.4.2", pinned: "0.5.2" },
  { member: "files", kitVersion: "0.4.2", pinned: "0.5.2" },
  { member: "gateway", kitVersion: "0.11.1", pinned: "0.2.2" },
  { member: "tenants", kitVersion: "0.10.6", pinned: "0.4.2" },
  { member: "todos", kitVersion: "0.8.4", pinned: "0.5.2" },
  { member: "mementos", kitVersion: "0.11.1", pinned: "0.10.6" },
  { member: "orgs", kitVersion: "0.10.6", pinned: "0.11.1" },
  { member: "hooks", kitVersion: "0.8.4", pinned: "0.11.1" },
];

/** Members with a manifest but NO pinned @hasna/contracts dependency —
 * their manifest has no validator pin, so conformance runs at the
 * manifest's kitVersion (or latest). */
export const NO_VALIDATOR_PIN: string[] = [
  "banking",
  "bridge",
  "catalog",
  "changelog",
  "computers",
  "context",
  "contracts",
  "crawl",
  "docs",
  "draw",
  "guardrails",
  "hooks",
  "monitor",
  "notes",
  "orgs",
  "pixels",
  "sheets",
  "slides",
  "tables",
  "search",
  "router",
  "releases",
  "ui",
];

export const CONTRACTS_EXCEPTION_MEMBERS = new Set(CONTRACTS_EXCEPTIONS.map((e) => e.member));
export const MANIFEST_MISSING_MEMBERS = new Set(MANIFEST_MISSING_EXCEPTIONS.map((e) => e.member));
export const KIT_VERSION_EXCEPTION_MEMBERS = new Set(KIT_VERSION_EXCEPTIONS.map((e) => e.member));

export function classificationTable(): string {
  const rows = members()
    .map((m) => {
      const flags = [
        m.publishable ? "pub" : "priv",
        m.hasCli ? "cli" : "NO-CLI",
        m.hasMcp ? "mcp" : "no-mcp",
        m.hasServe ? "serve" : "no-serve",
        m.hasSdk ? "sdk" : "no-sdk",
        m.hasManifest ? "ctr" : "no-ctr",
        m.license === "Apache-2.0" ? "apache" : m.license || "no-license",
      ].join(" ");
      return `| ${m.name.padEnd(14)} | ${flags.padEnd(52)} |`;
    })
    .join("\n");
  const header = `| member         | surfaces                                            |`;
  return `${header}\n${rows}`;
}

/** Todos project where standard-suite reconcile tasks are filed. Defaults to
 * the release/versioning lane project (agent-ea, where every census
 * remediation task lives); override with HASNA_TODOS_PROJECT. */
export const RECONCILE_TASKS_PROJECT = process.env.HASNA_TODOS_PROJECT ?? "5e44770b-694c-46a3-864f-20a2b9ec1de2";

/** Agent identity that created reconcile tasks carry. Defaults to agent-ea,
 * the release/versioning lane seat the README documents as the tasks' owner
 * (passing --assign/--assign-seat makes attribution independent of the
 * ambient TODOS_AGENT_ID); override with HASNA_TODOS_AGENT. */
export const RECONCILE_TASKS_AGENT = process.env.HASNA_TODOS_AGENT ?? "agent-ea";

/** Find-or-create a reconcile task keyed on the exact fingerprint title
 * (`todos task upsert --fingerprint <title>`). Returns the task id and
 * whether it was created; null when the todos CLI is unavailable — the
 * reporting lanes must never fail on a task-sync failure, they report
 * NOT FILED and pass. */
export async function ensureReconcileTask(title: string, description: string): Promise<{ id: string; created: boolean } | null> {
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn(
      ["todos", "task", "upsert", "--fingerprint", title, "--title", title, "-d", description, "-p", "high", "--project", RECONCILE_TASKS_PROJECT, "--assign", RECONCILE_TASKS_AGENT, "--assign-seat", "--json"],
      { stdout: "pipe", stderr: "pipe" },
    );
  } catch (err) {
    // A missing `todos` executable throws at spawn time instead of exiting
    // non-zero; the reporting lanes must never fail on a task-sync failure —
    // report NOT FILED and pass (measured on CI runners without the CLI).
    console.info(`[standard] reconcile task upsert unavailable for "${title}": ${(err as Error).message?.slice(0, 200)} — NOT FILED`);
    return null;
  }
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  if (exitCode !== 0) {
    console.info(`[standard] reconcile task upsert failed for "${title}": ${stderr.trim().slice(0, 240)}`);
    return null;
  }
  try {
    const parsed = JSON.parse(stdout.trim()) as { task?: { id?: string }; created?: boolean };
    if (!parsed.task?.id) return null;
    return { id: parsed.task.id, created: parsed.created === true };
  } catch {
    return null;
  }
}
