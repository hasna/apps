/**
 * fleet conventions — standard-adherence suite, repo-wide.
 *
 * Two owner decisions that no single package can enforce for itself, because
 * both were reintroduced by COPYING between packages:
 *
 *  1. hasna/apps#1590 — the singular `.hasna/project/` layout is retired. There
 *     is one convention: the `.hasna/projects/` store, with per-workspace files
 *     under `.hasna/projects/workspaces/<wks_id>/`. The singular form was baked
 *     into a global agent instruction, so every agent that read a station
 *     profile was told to create a directory the owner had retired. Item 4 of
 *     the issue asks for exactly this: a repo-conformance rule.
 *
 *  2. hasna/apps#1601 — a client must NEVER build a request URL from the base
 *     URL's origin plus `/v1`. The fleet gateway addresses each app as
 *     `https://api.example.test/<app>`, and the origin drops that prefix, so the
 *     request lands on a path the gateway cannot route and fails as a 404 that
 *     reads like an outage. `@hasna/contracts` owns the grammar (the URL
 *     validation and `/v1` composition in `src/client/transport.ts`); packages
 *     still on the published 0.x line reproduce it, and this check is what keeps
 *     either copy from regressing.
 *
 * Both checks are greps with self-tests, deliberately: the defect they catch is
 * textual, arrives by copy-paste, and has now been reintroduced across package
 * boundaries more than once.
 */
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { APPS_DIR } from "./census";

// The issue's own acceptance grep reads `*.ts`, `*.md` and `*.json`. Bundled
// `.js` output is excluded for the same reason `dist` is: it is a build of a
// published dependency, not a place a convention can be fixed.
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".md", ".json"]);
const SKIP_DIRECTORIES = new Set([
  "node_modules",
  "dist",
  "build",
  "bin",
  ".git",
  "coverage",
  ".turbo",
  "generated",
]);

/**
 * `CHANGELOG.md` is a historical record of what shipped versions DID, not a
 * statement about what the layout is. Rewriting a released entry would falsify
 * it, so changelogs are read-only for this check.
 */
function isExempt(relativePath: string): boolean {
  return path.basename(relativePath) === "CHANGELOG.md";
}

/**
 * A layout-migration module names the layout it migrates FROM by definition —
 * its purpose is to erase the retired directory, so its source and tests must
 * be allowed to spell it. `apps/projects`' one-time migration
 * (`src/lib/project-layout-migration.ts`) documents itself as the ONLY place
 * that still mentions the singular directory and never reads it for anything
 * but the migration. The origin-v1 check keeps no such carve-out: no code,
 * migration or not, may compose a request root from an origin.
 */
function isMigrationModule(relativePath: string): boolean {
  return relativePath.includes("project-layout-migration");
}

function walk(root: string, onFile: (absolute: string, relative: string) => void, base = root): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue;
      walk(absolute, onFile, base);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!SOURCE_EXTENSIONS.has(path.extname(entry.name))) continue;
    const relative = path.relative(base, absolute);
    if (isExempt(relative)) continue;
    onFile(absolute, relative);
  }
}

/**
 * The retired layout, in both spellings a repo actually uses:
 *
 *   - the literal path `.hasna/project` as a DIRECTORY — `.hasna/project/x`,
 *     `.hasna/project"`, or the bare directory at the end of a path;
 *   - the `join(..., ".hasna", "project", ...)` form, which the acceptance grep
 *     in the issue does not see at all and which is how the projects
 *     permission scanner kept the layout alive.
 *
 * `.hasna/projects` is the convention and never matches. The hyphenated
 * `.hasna/project-context-*` files USED to be exempt here — they create no
 * `project` directory — but item 2 of the issue folded them under
 * `.hasna/projects/` (see `PROJECT_CONTEXT_MANIFEST_PATH` and its siblings in
 * apps/instructions/src/lib/project-context.ts), so the singular spelling has no
 * remaining legitimate use and the exemption is gone: anything under `.hasna/`
 * that starts with `project` and does not continue with `s` is a violation.
 */
const RETIRED_LAYOUT_PATTERNS: RegExp[] = [
  /\.hasna\/project(?!s)/,
  /["']\.hasna["']\s*,\s*["']project(?!s)/,
];

interface ConventionScan {
  retiredLayout: string[];
  originV1: string[];
}

/** One pass over the tree; the apps tree is large enough that two are slow. */
function scanTree(appsDir: string): ConventionScan {
  const retiredLayout: string[] = [];
  const originV1: string[] = [];
  walk(appsDir, (absolute, relative) => {
    const text = fs.readFileSync(absolute, "utf8");
    const inSrc = `${path.sep}${relative}`.includes(`${path.sep}src${path.sep}`);
    const isCode = /\.(ts|tsx)$/.test(relative);
    const lines = text.split("\n");
    const retirementExempt = isExempt(relative) || isMigrationModule(relative);
    lines.forEach((line, index) => {
      if (!retirementExempt && RETIRED_LAYOUT_PATTERNS.some((pattern) => pattern.test(line))) {
        retiredLayout.push(`${relative}:${index + 1}: ${line.trim()}`);
      }
      if (!inSrc || !isCode) return;
      // Comments explain the anti-pattern; only code composes a URL.
      const trimmed = line.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;
      if (ORIGIN_V1_PATTERNS.some((pattern) => pattern.test(line))) {
        originV1.push(`${relative}:${index + 1}: ${trimmed}`);
      }
    });
  });
  return { retiredLayout: retiredLayout.sort(), originV1: originV1.sort() };
}

let repoScan: ConventionScan | null = null;
function scanRepo(): ConventionScan {
  repoScan ??= scanTree(APPS_DIR);
  return repoScan;
}

export function retiredProjectLayoutViolations(appsDir?: string): string[] {
  return appsDir === undefined ? scanRepo().retiredLayout : scanTree(appsDir).retiredLayout;
}

/**
 * Composing a request root from an origin plus `/v1`.
 *
 * Matches the template form (`${x.origin}/v1`) and the concatenation form
 * (`x.origin + "/v1"`). A bare `${origin}/v1` over a local variable is NOT
 * matched: test fixtures legitimately build a base from a loopback server's
 * origin, where there is no gateway prefix to lose.
 */
const ORIGIN_V1_PATTERNS: RegExp[] = [
  /\.origin\s*\}\s*\/v1/,
  /\.origin\s*\+\s*["'`]\/v1/,
];

export function originV1Violations(appsDir?: string): string[] {
  return appsDir === undefined ? scanRepo().originV1 : scanTree(appsDir).originV1;
}

describe("standard-adherence: fleet conventions", () => {
  test("no source, doc, or fixture reintroduces the retired singular project layout (#1590)", () => {
    const violations = retiredProjectLayoutViolations();
    expect(
      violations,
      `retired .hasna singular project layout (use .hasna/projects/workspaces/<wks_id>/):\n${violations.join("\n")}`,
    ).toEqual([]);
  }, 120_000);

  test("no client composes a request root from an origin plus /v1 (#1601)", () => {
    const violations = originV1Violations();
    expect(
      violations,
      `origin-plus-/v1 composition drops the gateway app prefix; use the shared api-base helper:\n${violations.join("\n")}`,
    ).toEqual([]);
  }, 120_000);

  test("self-test: both checks fire on a planted violation and stay silent on the convention", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fleet-conventions-self-test-"));
    try {
      const src = path.join(root, "member", "src");
      fs.mkdirSync(src, { recursive: true });
      fs.writeFileSync(path.join(src, "bad.ts"), 'const base = `${url.origin}/v1`;\nconst dir = ".hasna/project/dashboard";\n');
      fs.writeFileSync(path.join(src, "bad-join.ts"), 'join(root, ".hasna", "project", "dashboard");\n');
      // The hyphenated siblings are no longer exempt (issue item 2 moved them).
      fs.writeFileSync(path.join(src, "bad-context.ts"), 'const m = ".hasna/project-context-manifest.json";\n');
      expect(retiredProjectLayoutViolations(root)).toHaveLength(3);
      expect(originV1Violations(root)).toHaveLength(1);

      fs.rmSync(path.join(src, "bad.ts"));
      fs.rmSync(path.join(src, "bad-join.ts"));
      fs.rmSync(path.join(src, "bad-context.ts"));
      // A migration module may name the layout it migrates from — it is the
      // sanctioned place that erases the retired directory. But it still may
      // NOT compose a request root from an origin.
      fs.writeFileSync(
        path.join(src, "project-layout-migration.ts"),
        'const segments = [".hasna", "project"] as const;\nconst base = `${url.origin}/v1`;\n',
      );
      fs.writeFileSync(
        path.join(src, "good.ts"),
        [
          'const base = `${url.origin}${prefix}/v1`;',
          'const dir = ".hasna/projects/workspaces/wks_1";',
          'const manifest = ".hasna/projects/project-context-manifest.json";',
          'const cache = join(root, ".hasna", "projects", "project-context-cache.json");',
          "const local = `${origin}/v1`;",
          "// the old code said `${url.origin}/v1`, which dropped the prefix",
        ].join("\n"),
      );
      expect(retiredProjectLayoutViolations(root)).toEqual([]);
      expect(originV1Violations(root)).toEqual(["member/src/project-layout-migration.ts:2: const base = `${url.origin}/v1`;"]);
      fs.rmSync(path.join(src, "project-layout-migration.ts"));

      // A CHANGELOG entry is history, not a live instruction.
      fs.writeFileSync(path.join(root, "member", "CHANGELOG.md"), "- rewrote `.hasna/project/dashboard/render.json`\n");
      expect(retiredProjectLayoutViolations(root)).toEqual([]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
