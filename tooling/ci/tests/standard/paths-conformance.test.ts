/**
 * Paths conformance — standard-adherence suite (ruling hasna/apps#1668).
 *
 * One paths resolver lives in `@hasna/contracts` (subpath `./paths`). Every
 * app resolves its local data/config/state/cache roots through it, with the
 * ruled placement: `~/.hasna/<app>/` on macOS for every kind, XDG on other
 * platforms, `HASNA_<KIND>_HOME` kind overrides first, per-app exact-app
 * overrides layered on top by each app's thin wrapper module.
 *
 * This check enforces the ruling's acceptance:
 *
 *   1. NO embedded resolver copies: no file under `apps/<app>/src` or
 *      `apps/<app>/scripts` may carry the in-package resolver marker
 *      (`PATHS_RESOLVER_*` identifiers or the "Local path resolver" comment)
 *      or read the `HASNA_{CONFIG,DATA,STATE,CACHE}_HOME` kind env names
 *      directly — the kind overrides are the resolver's, not the apps'.
 *   2. NO hard-coded placement literals: `git grep -E
 *      "\.hasna/(<app>)|Application Support" apps/<app>/src` — the letter of the
 *      ruling — must return only the resolver implementation
 *      (`apps/contracts/src/paths.ts`) plus the recorded allowlist below for
 *      paths that are NOT home data roots.
 *
 * The allowlist is the measured set of project-relative / product-convention
 * paths that are explicitly NOT home data placement (the `.hasna/projects`
 * rule #1590 domain — repo/project-scoped stores, not `$HOME` data roots):
 *
 *   - `apps/instructions/src/lib/project-context.ts`,
 *     `project-dashboard-standard.ts`, `provider-context.ts`,
 *     `session-apply.ts`, `global-agent-rules-standard.ts`,
 *     `session-render-ownership.ts`, `raw-store-root.ts`,
 *     `station-profile.ts` — relative paths inside a project clone
 *     (`.hasna/project/…`, `.hasna/instructions/…`, …), never `$HOME` joins.
 *   - `apps/knowledge/src/workspace.ts`, `private-ref.ts`, `app-wiki.ts`,
 *     `cli.ts`, `service.ts`, `rules-provenance.ts`, `workspace-migration.ts`,
 *     `api-display-url.ts` — the knowledge workspace convention
 *     (`<cwd>/.hasna/knowledge`) and rule/prompt project paths.
 *   - `apps/contracts/src/schemas.ts`, `no-cloud.ts`, `cli/index.ts`,
 *     `client/credentials.ts` — contracts' own schema defaults
 *     (`.hasna/project`, `.hasna/cloud`) and the credential seam; contracts is
 *     the seam owner.
 *   - `apps/conversations/src/lib/contracts-client/transport.ts`,
 *     `apps/conversations/src/lib/store/status-location.ts` — the retired
 *     fleet-env credential convention (documented legacy, separate track).
 *   - `apps/recordings/src/native/**`, `apps/recordings/scripts/macos_artifact.ts`
 *     — native (Swift/ObjC) updater code and packaging scripts outside the TS
 *     app src; the macOS updater's `~/.hasna` convention matches the ruling's
 *     macOS root.
 *   - `apps/secrets/src/api-display-url.ts`, `apps/economy/src/lib/api-display-url.ts`
 *     — display-helpers that print other apps' documented legacy homes
 *     (reworded to resolver roots where the target app is a member).
 *   - `apps/workflows/src/types.ts`, `apps/todos/src/lib/sync-utils.ts` —
 *     cross-app legacy path constants for historical migration.
 */
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { APPS_DIR, REPO_ROOT } from "./census";

const RESOLVER_MARKERS = [
  /PATHS_RESOLVER_/,
  /Local path resolver/,
  // CODE reads of the kind envs (doc-comment mentions are fine; reading the
  // kind override is the resolver's job — apps probe it via kindEnv()).
  /(?:process\.env|env)\[["']?HASNA_(CONFIG|DATA|STATE|CACHE)_HOME/,
  /(?:process\.env|env)\.[A-Z_]*HASNA_(CONFIG|DATA|STATE|CACHE)_HOME/,
];

/** The single allowed implementation. */
const RESOLVER_IMPL = path.join("apps", "contracts", "src", "paths.ts");

/**
 * Recorded exceptions — project-relative `/ product-convention paths that are
 * NOT home data roots, measured at the wave's HEAD; each entry states the
 * convention it belongs to (see header).
 */
const LITERAL_EXCEPTIONS: Array<{ file: string; reason: string }> = [
  { file: "apps/instructions/src/lib/project-context.ts", reason: "project-relative paths (#1590 domain)" },
  { file: "apps/instructions/src/lib/project-dashboard-standard.ts", reason: "project-relative paths (#1590 domain)" },
  { file: "apps/instructions/src/lib/provider-context.ts", reason: "project-relative paths (#1590 domain)" },
  { file: "apps/instructions/src/lib/session-apply.ts", reason: "project-relative paths (#1590 domain)" },
  { file: "apps/instructions/src/lib/global-agent-rules-standard.ts", reason: "project-relative paths (#1590 domain)" },
  { file: "apps/instructions/src/lib/session-render-ownership.ts", reason: "project-relative paths (#1590 domain)" },
  { file: "apps/instructions/src/lib/raw-store-root.ts", reason: "project-relative paths (#1590 domain)" },
  { file: "apps/instructions/src/lib/station-profile.ts", reason: "project-relative paths (#1590 domain)" },
  { file: "apps/knowledge/src/workspace.ts", reason: "knowledge workspace convention (<cwd>/.hasna/knowledge)" },
  { file: "apps/knowledge/src/private-ref.ts", reason: "knowledge workspace convention" },
  { file: "apps/knowledge/src/app-wiki.ts", reason: "knowledge workspace convention" },
  { file: "apps/knowledge/src/cli.ts", reason: "knowledge workspace convention (help text)" },
  { file: "apps/knowledge/src/service.ts", reason: "knowledge workspace convention (project-scoped store messages)" },
  { file: "apps/knowledge/src/rules-provenance.ts", reason: "rule/plan project paths" },
  { file: "apps/knowledge/src/workspace-migration.ts", reason: "knowledge workspace convention (diagnostic tombstone)" },
  { file: "apps/knowledge/src/api-display-url.ts", reason: "display string for the workspace convention" },
  { file: "apps/contracts/src/schemas.ts", reason: "contracts schema defaults (.hasna/project, legacy store path template)" },
  { file: "apps/contracts/src/no-cloud.ts", reason: "contracts no-cloud policy literals" },
  { file: "apps/contracts/src/cli/index.ts", reason: "contracts CLI help text" },
  { file: "apps/contracts/src/client/credentials.ts", reason: "contracts credential seam" },
  { file: "apps/conversations/src/lib/contracts-client/transport.ts", reason: "retired fleet-env credential convention" },
  { file: "apps/conversations/src/lib/store/status-location.ts", reason: "retired fleet-env credential convention" },
  { file: "apps/recordings/scripts/macos_artifact.ts", reason: "macOS packaging script (updater convention)" },
  { file: "apps/secrets/src/api-display-url.ts", reason: "display helper for documented legacy homes" },
  { file: "apps/economy/src/lib/api-display-url.ts", reason: "display helper for documented legacy homes" },
  { file: "apps/recordings/src/cli/macos-permissions.ts", reason: "Apple TCC system database paths (not the Hasna layout)" },
  { file: "apps/recordings/src/__tests__/macos-permissions.test.ts", reason: "Apple TCC system database paths (not the Hasna layout)" },
  { file: "apps/recordings/src/__tests__/macos-updater-packaging-contract.test.ts", reason: "native macOS updater packaging layout (Application Support = app bundle tree, not data home)" },
  { file: "apps/recordings/src/__tests__/macos-app-lifecycle.test.ts", reason: "native macOS updater conventions (ruling keeps ~/.hasna on macOS)" },
  { file: "apps/recordings/src/__tests__/macos-shortcut-contract.test.ts", reason: "native macOS updater conventions" },
  { file: "apps/recordings/src/__tests__/trigger-diagnosis.test.ts", reason: "native macOS updater conventions" },
  { file: "apps/dispatch/src/lib/engine.test.ts", reason: "projects workspace fixture paths (#1590 domain)" },
  { file: "apps/dispatch/src/lib/exec-policy.test.ts", reason: "projects workspace fixture paths (#1590 domain)" },
  { file: "apps/instructions/src/lib/project-context.test.ts", reason: "projects workspace fixture + project-relative paths (#1590 domain)" },
  { file: "apps/instructions/src/lib/global-agent-rules-standard.test.ts", reason: "rule text mirror (worktree placement convention, #1590 domain)" },
  { file: "apps/instructions/src/lib/global-agent-rules-render-integration.test.ts", reason: "project-relative fragment paths (#1590 domain)" },
  { file: "apps/instructions/src/lib/dangerous-operation-guard-standard.test.ts", reason: "project-relative fragment paths (#1590 domain)" },
  { file: "apps/instructions/src/lib/provider-version-adapters.test.ts", reason: "project-relative fragment paths (#1590 domain)" },
  { file: "apps/instructions/src/lib/session-render.test.ts", reason: "project-relative fragment/manifest paths (#1590 domain)" },
  { file: "apps/instructions/src/lib/session-render-ownership.test.ts", reason: "project-relative fragment paths (#1590 domain)" },
  { file: "apps/instructions/src/lib/session-apply.test.ts", reason: "project-relative fragment paths (#1590 domain)" },
  { file: "apps/instructions/src/cli/session.test.ts", reason: "configs-store override fixture (exact-app override, not a literal home)" },
  { file: "apps/mementos/src/db/projects.test.ts", reason: "projects workspace fixture paths (#1590 domain)" },
  { file: "apps/mementos/src/db/api-mode-update-not-persisted.test.ts", reason: "projects workspace fixture paths (#1590 domain)" },
  { file: "apps/mementos/src/sdk/projects.test.ts", reason: "projects workspace fixture paths (#1590 domain)" },
  { file: "apps/todos/src/cli/cloud-router.test.ts", reason: "projects workspace fixture paths (#1590 domain)" },
  { file: "apps/connectors/src/lib/installer.test.ts", reason: "connector doc-corpus assertions (docs live outside apps/connectors/src)" },
  { file: "apps/connectors/src/cli/cli.test.ts", reason: "connector doc-corpus assertions" },
  { file: "apps/connectors/src/mcp/mcp.test.ts", reason: "connector doc-corpus assertions" },
  { file: "apps/files/src/lib/google-drive-canonical.test.ts", reason: "connector doc-corpus / legacy-migration fixture assertions" },
  // Post-wave main drift re-measured at the #1749 rebase (env wave #1100 +
  // fail-closed wave + S3 wave, all merged into main after the wave's
  // measurement): the refusal messages, comments, and assertions naming the
  // documented macOS legacy home (`.hasna/<app>` == the ruling's macOS root;
  // `Application Support` == the pre-ruling legacy root) as FORBIDDEN/legacy
  // text. None of these files computes or joins a home: they cite the legacy
  // path in error text, comments, and assertions that local mode is never a
  // default. Deliberate, like the secrets/economy api-display-url entries.
  { file: "apps/instructions/src/lib/project-dashboard-standard.test.ts", reason: "dashboard render path assertion (#1590 domain)" },
  { file: "apps/instructions/src/cli/fail-closed-no-env.test.ts", reason: "asserts the fail-closed refusal text naming the legacy macOS home" },
  { file: "apps/attachments/src/cli/fail-closed.test.ts", reason: "asserts the fail-closed refusal text naming the legacy macOS home" },
  { file: "apps/shortlinks/src/client-store.ts", reason: "fail-closed comment naming the legacy macOS home" },
  { file: "apps/shortlinks/src/cli/fail-closed.test.ts", reason: "asserts the fail-closed refusal text naming the legacy macOS home" },
  { file: "apps/telephony/src/cli/fail-closed.test.ts", reason: "asserts the fail-closed refusal text naming the legacy macOS home" },
  { file: "apps/calendar/src/cli/api-mode-storage.test.ts", reason: "asserts the local store is never opened; cites the legacy macOS home" },
  { file: "apps/projects/src/lib/project-layout-migration.ts", reason: "legacy layout documentation comments (~/.hasna/projects convention, #1590 domain)" },
  { file: "apps/mementos/src/db/database.ts", reason: "fail-closed comment naming the legacy macOS home" },
  { file: "apps/mementos/src/db/api-mode.ts", reason: "fail-closed refusal text naming the legacy macOS home" },
  { file: "apps/mementos/src/cli/fail-closed-no-env.test.ts", reason: "asserts the fail-closed refusal text naming the legacy macOS home" },
  { file: "apps/economy/src/lib/cloud-storage.ts", reason: "fail-closed comment naming the legacy macOS home" },
  { file: "apps/economy/src/cli/fail-closed.test.ts", reason: "asserts the fail-closed refusal text naming the pre-ruling legacy roots" },
  { file: "apps/domains/src/db/store.ts", reason: "fail-closed refusal text + comments naming the legacy macOS home" },
  { file: "apps/domains/src/cli/fail-closed.test.ts", reason: "asserts the fail-closed refusal text naming the legacy macOS home" },
  { file: "apps/emails/src/lib/webhook.test.ts", reason: "safety-comment citing the legacy macOS home" },
  { file: "apps/files/src/store/index.ts", reason: "fail-closed comment naming the legacy macOS home" },
  { file: "apps/files/src/lib/cloud-storage.ts", reason: "fail-closed comment naming the legacy macOS home" },
  { file: "apps/files/src/cli/fail-closed.test.ts", reason: "asserts the fail-closed refusal text naming the legacy macOS home" },
  { file: "apps/loops/src/lib/cloud/resolve.ts", reason: "fail-closed comment naming the legacy macOS home" },
  { file: "apps/loops/src/lib/bundle/artifact-storage.ts", reason: "S3-wave comment naming the on-box fallback home" },
  { file: "apps/loops/src/lib/bundle/local.ts", reason: "S3-wave layout documentation comment" },
  { file: "apps/todos/src/cli/fail-closed.test.ts", reason: "asserts the fail-closed refusal text naming the pre-ruling legacy roots" },
  { file: "apps/logs/src/store/index.test.ts", reason: "asserts the fail-closed refusal text naming the legacy macOS home" },
  { file: "apps/logs/src/store/index.ts", reason: "fail-closed refusal text + comments naming the legacy macOS home" },
  { file: "apps/logs/src/cli/fail-closed.test.ts", reason: "asserts the fail-closed refusal text naming the legacy macOS home" },
  { file: "apps/logs/src/cli/index.ts", reason: "fail-closed comment naming the legacy macOS home" },
  { file: "apps/logs/src/mcp/index.ts", reason: "fail-closed comment naming the legacy macOS home" },
];

function appSlugs(): string[] {
  return fs
    .readdirSync(APPS_DIR)
    .filter((d) => fs.statSync(path.join(APPS_DIR, d)).isDirectory())
    .filter((d) => d !== "contracts");
}

/** Walk apps/<name>/src + apps/<name>/scripts (TS only). */
function walkTsFiles(app: string): string[] {
  const root = path.join(APPS_DIR, app);
  const out: string[] = [];
  const queue = [root];
  const skipDirs = new Set(["node_modules", "dist", "generated", "__snapshots__", "fixtures", "__fixtures__", ".turbo"]);
  while (queue.length > 0) {
    const dir = queue.pop()!;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!skipDirs.has(entry.name)) queue.push(full);
      } else if (entry.isFile() && /\.(ts|mjs)$/.test(entry.name)) {
        out.push(full);
      }
    }
  }
  return out;
}

const apps = appSlugs().sort((a, b) => b.length - a.length);
const appAlt = apps.join("|");
const literalRe = new RegExp(`\\.hasna/(${appAlt})(?=/|$)`);
const appSupportRe = /Application Support/;

function rel(p: string): string {
  return path.relative(REPO_ROOT, p);
}

describe("paths conformance (single resolver in @hasna/contracts, ruling #1668)", () => {
  test("no embedded resolver copies or kind-env reads outside @hasna/contracts", () => {
    const hits: string[] = [];
    for (const app of apps) {
      for (const file of walkTsFiles(app)) {
        if (/\.test\.|test-harness|test-isolation|test-support|__tests__|fixtures|\.d\.ts$/.test(file)) continue;
        const text = fs.readFileSync(file, "utf8");
        if (RESOLVER_MARKERS.some((re) => re.test(text))) hits.push(rel(file));
      }
    }
    expect(hits, "resolver copies / kind-env reads outside the contracts seam").toEqual([]);
  }, 300_000);

  test("no .hasna/<app> or Application Support literals in apps/<app>/src outside the resolver (acceptance grep)", () => {
    const hits: string[] = [];
    for (const app of apps) {
      const srcDir = path.join(APPS_DIR, app, "src");
      if (!fs.existsSync(srcDir)) continue;
      const queue = [srcDir];
      const skipDirs = new Set(["node_modules", "dist", "generated", "__snapshots__", "fixtures", "__fixtures__", ".turbo"]);
      while (queue.length > 0) {
        const dir = queue.pop()!;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (entry.name.startsWith(".")) continue;
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            if (!skipDirs.has(entry.name)) queue.push(full);
          } else if (entry.isFile() && /\.(ts|mjs)$/.test(entry.name)) {
            const r = rel(full);
            if (r === RESOLVER_IMPL) continue;
            const text = fs.readFileSync(full, "utf8");
            const lit = literalRe.exec(text);
            const sup = appSupportRe.test(text);
            const excepted = LITERAL_EXCEPTIONS.some((e) => e.file === r);
            if ((lit || sup) && !excepted) hits.push(`${r}${lit ? ` (.hasna/${lit[1]})` : ""}${sup ? " (Application Support)" : ""}`);
          }
        }
      }
    }
    expect(hits, "hard-coded placement literals outside the resolver (allowlisted project-relative paths are documented in the check header)").toEqual([]);
  }, 300_000);

  test("self-test: the resolver markers and literal patterns can fire", () => {
    expect(PATHS_RESOLVER_PROBE.test("\nconst PATHS_RESOLVER_KIND_ENV = {};\n")).toBe(true);
    expect(LOCAL_RESOLVER_PROBE.test("\n// --- Local path resolver ---\n")).toBe(true);
    expect(KIND_ENV_PROBE.test("\nprocess.env.HASNA_DATA_HOME\n")).toBe(true);
    expect(literalRe.test("\n~/.hasna/todos/config.json\n")).toBe(true);
    expect(appSupportRe.test("\n~/Library/Application Support/Hasna\n")).toBe(true);
  });

  test("the recorded literal exceptions still exist (two-sided contract)", () => {
    for (const e of LITERAL_EXCEPTIONS) {
      const p = path.join(REPO_ROOT, e.file);
      expect(fs.existsSync(p), `stale exception entry: ${e.file}`).toBe(true);
      const text = fs.readFileSync(p, "utf8");
      const fired = /\.hasna/.test(text) || appSupportRe.test(text);
      expect(fired, `exception entry no longer fires: ${e.file} (${e.reason})`).toBe(true);
    }
  });
});

const PATHS_RESOLVER_PROBE = /PATHS_RESOLVER_/;
const LOCAL_RESOLVER_PROBE = /Local path resolver/;
const KIND_ENV_PROBE = /HASNA_(CONFIG|DATA|STATE|CACHE)_HOME/;