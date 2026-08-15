/**
 * Member census + exception registry for the standard-adherence suite.
 *
 * Measured 2026-08-14 against origin/main @ ce470e4ad; refreshed by the
 * integrator lane at the ci/test-suites merge ref (2026-08-14) for the
 * imports that landed after that base — connectors (#80), shield (#74),
 * terminal (#88). Refreshed again 2026-08-14 by the ci/test-suites
 * iterate-to-green fixer at the fresh merge of current main (a7d60a96,
 * todos import #105): files (#90) gained hasna.contract.json (contracts
 * conformance + kitVersion records added, task b0845699), instructions
 * kitVersion advanced to 0.10.6 by #111 (record added, task 8417a133),
 * and todos (#105) gained a pre-backend-schema-era manifest validated at
 * pinned 0.5.2 (conformance + kitVersion records added, task 0ad82b16).
 * The monitor (#97) and testers (#95) imports landed 2026-08-14: monitor
 * gained a conformance + NO_VALIDATOR_PIN record (bins_match_package —
 * package ships monitor-server/monitor-web the manifest does not declare;
 * task d2c6d20f) plus serve/sdk WARN records, testers gained an sdk WARN
 * record.
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
 * validates clean (the two-sided registry contract: a recorded exception
 * that passes fails the suite). Cause strings refreshed to exact current
 * failure text for calendar, catalog, emails, instructions, prompts and
 * shield. Locally on station01, machines and telephony still report
 * server_backend_configuration because the retired HASNA_*_STORAGE_MODE
 * env vars remain exported in the interactive shell (deployment residue,
 * same class as the telephony note above; machines cleanup is part of
 * todos 7abbf333, telephony 26ad6a16) — in CI's clean environment both
 * pass and neither has a registry entry.
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
import { fileURLToPath } from "node:url";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
export const APPS_DIR = path.join(REPO_ROOT, "apps");

/** Contract validator resolution: pinned dep >= 0.4.1 exposes
 * repo-conformance (measured: 0.2.2 does not). Below that, the manifest's
 * kitVersion is tried; kit versions missing from npm (0.8.3) or too old for
 * the subcommand (0.1.0) fall back to `latest`. */
export const MIN_VALIDATOR_VERSION = "0.4.1";

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
  { member: "router", reason: "Gateway-shaped; no MCP surface (also missing the HARD CLI bin — see CLI_EXCEPTIONS)." },
  { member: "sheets", reason: "Library-shaped (spreadsheet format); no MCP surface." },
  { member: "slides", reason: "Library-shaped; no MCP surface (also missing the HARD CLI bin — see CLI_EXCEPTIONS)." },
  { member: "tables", reason: "Library-shaped (tabular data); no MCP surface." },
  { member: "tenants", reason: "Registry-shaped; no MCP surface." },
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
  { member: "catalog", reason: "Client-shaped; no server surface." },
  { member: "contracts", reason: "Library-shaped (manifest validator kit); no server surface." },
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
  { member: "router", reason: "Gateway-shaped; no server surface (also missing the HARD CLI bin — see CLI_EXCEPTIONS)." },
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
  { member: "monitor", reason: "SDK lane (c7ce8b75); no ./sdk export yet. Imported by #97 after the original census." },
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
  { member: "slides", reason: "SDK lane (c7ce8b75); no ./sdk export yet." },
  { member: "snapshots", reason: "SDK lane (c7ce8b75); no ./sdk export yet." },
  { member: "statusline", reason: "SDK lane (c7ce8b75); no ./sdk export yet." },
  { member: "styles", reason: "SDK lane (c7ce8b75); no ./sdk export yet." },
  { member: "tables", reason: "SDK lane (c7ce8b75); no ./sdk export yet." },
  { member: "telephony", reason: "SDK lane (c7ce8b75); no ./sdk export yet." },
  { member: "terminal", reason: "SDK lane (c7ce8b75); no ./sdk export yet. Imported by #88 after the original census." },
  { member: "tickets", reason: "SDK lane (c7ce8b75); no ./sdk export yet." },
  { member: "treasury", reason: "SDK lane (c7ce8b75); no ./sdk export yet." },
  { member: "ui", reason: "Legacy ui.sh mirror; SDK lane (c7ce8b75)." },
  { member: "workforce", reason: "SDK lane (c7ce8b75); no ./sdk export yet." },
];

/** HARD four-surface exceptions — members missing the `<name>` CLI bin.
 * These are the only four-surface violations that are task-mandated (the
 * bin must NOT be invented in-suite; remediation is a tracked task). */
export const CLI_EXCEPTIONS: Array<{ member: string; reason: string; task: string }> = [
  {
    member: "router",
    reason: "Gateway-shaped member shipping only an internal binary; no public `router` CLI bin. Remediation task filed.",
    task: "todos 452b7a32 (router missing CLI bin)",
  },
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
  { member: "announce", reason: "No hasna.contract.json; manifest lane (todos 41208cbe)." },
  { member: "brains", reason: "No hasna.contract.json; manifest lane (todos 41208cbe)." },
  { member: "browser", reason: "No hasna.contract.json; manifest lane (todos 41208cbe)." },
  { member: "changelog", reason: "No hasna.contract.json; manifest lane (todos 41208cbe)." },
  { member: "computer", reason: "No hasna.contract.json; manifest lane (todos 41208cbe)." },
  { member: "computers", reason: "No hasna.contract.json; manifest lane (todos 41208cbe)." },
  { member: "context", reason: "No hasna.contract.json; manifest lane (todos 41208cbe)." },
  { member: "crawl", reason: "No hasna.contract.json; manifest lane (todos 41208cbe)." },
  { member: "datasets", reason: "No hasna.contract.json; manifest lane (todos 41208cbe)." },
  { member: "evals", reason: "No hasna.contract.json; manifest lane (todos 41208cbe)." },
  { member: "markdown", reason: "No hasna.contract.json; manifest lane (todos 41208cbe)." },
  { member: "orgs", reason: "No hasna.contract.json; manifest lane (todos 41208cbe)." },
  { member: "pixels", reason: "No hasna.contract.json; manifest lane (todos 41208cbe). Imported by #69." },
  { member: "releases", reason: "No hasna.contract.json; manifest lane (todos 41208cbe)." },
  { member: "repos", reason: "No hasna.contract.json; manifest lane (todos 41208cbe)." },
  { member: "router", reason: "No hasna.contract.json; manifest lane (todos 41208cbe)." },
  { member: "skills", reason: "No hasna.contract.json; manifest lane (todos 41208cbe)." },
  { member: "snapshots", reason: "No hasna.contract.json; manifest lane (todos 41208cbe)." },
  { member: "statusline", reason: "No hasna.contract.json; manifest lane (todos 41208cbe)." },
  { member: "styles", reason: "No hasna.contract.json; manifest lane (todos 41208cbe)." },
  { member: "tai", reason: "No hasna.contract.json; manifest lane (todos 41208cbe)." },
  { member: "tenants", reason: "No hasna.contract.json; manifest lane (todos 41208cbe)." },
  { member: "tickets", reason: "No hasna.contract.json; manifest lane (todos 41208cbe)." },
  { member: "ui", reason: "No hasna.contract.json; legacy mirror member; manifest lane (todos 41208cbe)." },
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
    member: "automations",
    cause: "Pinned @hasna/contracts 0.8.1 predates the manifest shape (storage.backend, no deploymentModes); manifest validates clean at 0.9.0. Pinned kit is stale.",
    task: "todos 99f670fe-246a-48be-80dc-46457d4fc013 (contracts task — automations)",
  },
  {
    member: "calendar",
    cause: "manifest_valid at pinned 0.4.2 (mode-era schema vs mixed-era manifest): storage.mode Invalid enum value. Expected 'local' | 'cloud', received 'sqlite'; storage Unrecognized key(s) in object: 'engines', 'pgTestGate'; <root> Unrecognized key(s) in object: 'hosting', 'serviceSurfaces'. The earlier mode_enum_compliance env-var cause no longer fires.",
    task: "todos a967c9bd (contracts task — calendar)",
  },
  {
    member: "catalog",
    cause: "kitVersion 0.8.3 does not exist on npm and no @hasna/contracts dep is pinned; validated at latest, manifest is pre-backend-schema era: storage.backend Required; storage Unrecognized key(s) in object: 'mode'; serviceSurfaces.* Unrecognized key(s) in object: 'deploymentModes'; metadata.conformance.waivedStorageEngines.0.engine Invalid enum value. Expected 'postgresql', received 'postgres'; <root> Unrecognized key(s) in object: 'deploymentModes'.",
    task: "todos e4d8cd62 (contracts task — catalog)",
  },
  {
    member: "contacts",
    cause: "manifest_valid: service-class manifest declares no service surface (service repos must declare at least one). Imported by #149; validated at pinned 0.5.2 (kitVersion 0.4.2; pin ^0.5.2 — ^0.5.1 resolves to 0.5.2, the literal 0.5.1 does not exist on npm).",
    task: "todos ee9fbb4d (import row — contacts; add serviceSurfaces or modernize the manifest)",
  },
  {
    member: "conversations",
    cause: "bins_match_package: package.json ships bins conversations-inbox and conversations-hook that the manifest does not declare (manifest declares conversations, conversations-mcp, conversations-serve only). Imported by #100 after the original census; validated at pinned ^0.4.2 (kitVersion 0.4.2).",
    task: "todos ee9fbb4d (import row — conversations; reconcile the two bins against the manifest or extend the manifest's bins)",
  },
  {
    member: "docs",
    cause: "kitVersion 0.1.0 predates repo-conformance; no @hasna/contracts dep pinned; validated at latest, manifest is pre-backend-schema era.",
    task: "todos 6818348f (contracts task — docs)",
  },
  {
    member: "draw",
    cause: "kitVersion 0.1.0 predates repo-conformance; no @hasna/contracts dep pinned; validated at latest, manifest is pre-backend-schema era.",
    task: "todos 5698b7d3 (contracts task — draw)",
  },
  {
    member: "emails",
    cause: "published_artifact_gate: metadata.release.artifactScan.script is required for a published package: name the script that scans the PACKED artifact, then wire it into prepack. (The earlier no_cloud_guard cause no longer fires at main.)",
    task: "todos e0ef3e32 (contracts task — emails)",
  },
  {
    member: "files",
    cause: "manifest_valid: service-class manifest declares no service surface (service repos must declare at least one). Imported by #90 after the original census; validated at pinned 0.5.2.",
    task: "todos b0845699-4e54-49f7-817e-025d4f6ca270 (contracts task — files)",
  },
  {
    member: "gateway",
    cause: "kitVersion 0.4.1 predates the manifest shape (deploymentModes/serviceSurfaces); validates clean at 0.5.2. kitVersion claim is stale; pinned dep 0.2.2 lacks repo-conformance.",
    task: "todos 9dc0ee28 (contracts task — gateway)",
  },
  {
    member: "hooks",
    cause: "manifest_valid: manifest added by #102 (2026-08-14) is pre-backend-schema era — storage.mode Required, storage.engines.1 'postgresql' invalid (expected sqlite|postgres), storage.backend unrecognized. Validated at pinned 0.8.4.",
    task: "todos 03d497e8-adff-4226-9f78-903f1c17645b (contracts task — hooks)",
  },
  {
    member: "instructions",
    cause: "manifest_valid at pinned 0.4.2 (mode-era validator vs backend-era manifest): storage.mode Required; storage Unrecognized key(s) in object: 'backend'. (The earlier bins-allowlist cause no longer fires at main.)",
    task: "todos c15cca18 (contracts task — instructions)",
  },
  {
    member: "knowledge",
    cause: "manifest_valid: service-class manifest declares no service surface (service repos must declare at least one).",
    task: "todos a8c97621 (contracts task — knowledge)",
  },
  {
    member: "loops",
    cause: "credential_seam_compliance at validator 0.10.6: src/lib/cloud/storage.ts:218 resolveStorageClient and src/lib/cloud/transport.ts:89/241/358 (resolveClientTransport/createHasnaHttpTransport/createClientTransport) are vendored copies of the @hasna/contracts client seam — a fork does not receive credential-resolution fixes; import from @hasna/contracts/client instead. Main-gate break caused by the 0.10.6 validator (todos ee9fbb4d).",
    task: "todos ee9fbb4d (main-gate break — loops; replace vendored contracts client seam with @hasna/contracts/client imports)",
  },
  {
    member: "logs",
    cause: "manifest_valid: service-class manifest declares no service surface (service repos must declare at least one). Validated at pinned 0.5.2.",
    task: "todos d166125e (contracts task — logs)",
  },
  {
    member: "mementos",
    cause: "surface_bindings: serviceSurfaces[1].generatedFrom is required for a supported service SDK.",
    task: "todos 5695459d (contracts task — mementos)",
  },
  {
    member: "monitor",
    cause: "bins_match_package: package.json ships bins monitor-server and monitor-web that the manifest does not declare (manifest declares monitor, monitor-mcp only). Imported by #97 after the original census; validated at kitVersion 0.8.5 (no pinned dep).",
    task: "todos d2c6d20f-7c80-4b84-ae35-a92ce866bc14 (contracts task — monitor)",
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
    cause: "kitVersion 0.1.0 predates repo-conformance; no @hasna/contracts dep pinned; validated at latest, manifest is pre-backend-schema era.",
    task: "todos ccc2e931 (contracts task — slides)",
  },
  {
    member: "tables",
    cause: "kitVersion 0.1.0 predates repo-conformance; no @hasna/contracts dep pinned; validated at latest, manifest is pre-backend-schema era.",
    task: "todos daaa2841 (contracts task — tables)",
  },
  {
    member: "shield",
    cause: "surface_matrix/service_api_topology: no supported API surface declared; surface_bindings: serviceSurfaces[2].exportSubpath targets missing ./sdk/dist files and generatedFrom is required. Imported by #74 after the original census; validated at 0.8.5 (no pinned dep, kitVersion resolution). (The earlier self_host_artifact cause no longer fires at main.)",
    task: "todos 2aceeb94-7077-4479-b61a-0a7b33b856f7 (contracts task — shield)",
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
  { member: "contacts", kitVersion: "0.4.2", pinned: "0.5.2" },
  { member: "domains", kitVersion: "0.4.2", pinned: "0.5.2" },
  { member: "files", kitVersion: "0.4.2", pinned: "0.5.2" },
  { member: "gateway", kitVersion: "0.4.1", pinned: "0.2.2" },
  { member: "instructions", kitVersion: "0.10.6", pinned: "0.4.2" },
  { member: "logs", kitVersion: "0.4.2", pinned: "0.5.2" },
  { member: "shortlinks", kitVersion: "0.4.2", pinned: "0.5.2" },
  { member: "todos", kitVersion: "0.8.4", pinned: "0.5.2" },
];

/** Members with a manifest but NO pinned @hasna/contracts dependency —
 * their manifest has no validator pin, so conformance runs at the
 * manifest's kitVersion (or latest). */
export const NO_VALIDATOR_PIN: string[] = [
  "banking",
  "bridge",
  "catalog",
  "contracts",
  "docs",
  "draw",
  "guardrails",
  "hooks",
  "monitor",
  "sheets",
  "slides",
  "tables",
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
