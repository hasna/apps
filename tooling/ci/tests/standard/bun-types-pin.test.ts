/**
 * @types/bun exact-pin gate — tree-wide standard-adherence check.
 *
 * Finding dep-connectors-1 (7-day quarantine admission family, severity P1,
 * 2026-08-26): `@types/bun` is declared with a FLOAT spec ("latest", "^1.x.y",
 * "~1.x.y") across the member manifests — apps/connectors/connectors/3scribe
 * and its ~1154 connector siblings, 33 hooks, 63 skills, apps/mementos/sdk and
 * every top-level member. A float spec resolves to the newest published
 * version: @types/bun@1.4.0 was published 2026-08-20T19:46:32.487Z (6.9 days
 * before the finding — INSIDE the fleet's 7-day minimumReleaseAge window,
 * bunfig.toml minimumReleaseAge = 604800), so a fresh manifest resolution —
 * the per-app Docker deps shape, an author's `bun install` in a pulled
 * connector, the pack-audit resolution — selects the quarantine-blocked max
 * and fails the 604800s guard. The exact-name excludes are not the answer:
 * repo manifests must not depend on per-machine minimumReleaseAgeExcludes
 * entries (the quarantine-pins doctrine), and @types/bun is NOT in
 * ~/.bunfig.toml excludes.
 *
 * The sanctioned remedy (finding fix hint): an exact version pin to the
 * monorepo override — root package.json `overrides["@types/bun"]` is 1.3.14,
 * published 2026-05-13, 105 days old at the finding, quarantine-safe at any
 * later date (older is monotonic). This gate asserts that shape: every
 * declaration of @types/bun in any dependency section of any manifest under
 * apps/ — and in the member-scaffold generator template, which would
 * otherwise reintroduce the float for every newly scaffolded member — is an
 * EXACT version pin. A float readmits the finding class at any future date
 * regardless of the registry's current publish times.
 *
 * SCOPE: tree-wide, deliberately. The quarantine-admission check (network,
 * publish-time based) asserts publishable members; this gate is offline and
 * deterministic, and covers the nested connector/hook/skill manifests that
 * are not publishable members. The two check different surfaces of the same
 * class.
 *
 * The walk skips node_modules/.git/dist/.turbo/bin (generated state) and
 * `.test-home` fixture dirs (the connectors package excludes those exact
 * paths from its published files, and they are test reproductions, not
 * installed manifests).
 */
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { APPS_DIR } from "./census";

const REPO_ROOT = path.resolve(path.dirname(import.meta.url), "..", "..", "..", "..");
const SCAFFOLD_TEMPLATE = path.join(REPO_ROOT, "tooling", "member-scaffold", "template", "package.json");

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".turbo", "bin", ".test-home"]);
const DEP_SECTIONS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"] as const;

export interface BunTypesDeclaration {
  file: string;
  section: string;
  spec: string;
}

/** Collect every @types/bun declaration from the manifests in `roots`. */
export function collectBunTypesDeclarations(roots: string[]): BunTypesDeclaration[] {
  const decls: BunTypesDeclaration[] = [];
  for (const root of roots) {
    if (root === SCAFFOLD_TEMPLATE) {
      addManifestDecls(root, decls);
      continue;
    }
    const stack = [root];
    while (stack.length > 0) {
      const dir = stack.pop()!;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entries) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (!SKIP_DIRS.has(e.name)) stack.push(p);
        } else if (e.name === "package.json") {
          addManifestDecls(p, decls);
        }
      }
    }
  }
  return decls;
}

function addManifestDecls(file: string, decls: BunTypesDeclaration[]): void {
  if (!fs.existsSync(file)) return;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    return;
  }
  for (const section of DEP_SECTIONS) {
    const deps = parsed[section];
    if (!deps || typeof deps !== "object" || Array.isArray(deps)) continue;
    const spec = (deps as Record<string, unknown>)["@types/bun"];
    if (typeof spec === "string" && spec.length > 0) {
      decls.push({ file: path.relative(REPO_ROOT, file), section, spec });
    }
  }
}

/** Fires on float specs; stays silent on exact version pins. */
export function isExactPin(spec: string): boolean {
  return /^\d+\.\d+\.\d+$/.test(spec);
}

describe("standard-adherence: @types/bun declared specs are exact version pins (dep-connectors-1)", () => {
  test("self-test: the exact-pin test discriminates (prove-it-can-fail arms)", () => {
    // Positive arms: the float shapes that resolve to the window-fresh 1.4.0.
    expect(isExactPin("latest")).toBe(false);
    expect(isExactPin("^1.3.8")).toBe(false);
    expect(isExactPin("^1.3.14")).toBe(false); // caret admits 1.4.0 — same class
    expect(isExactPin("~1.2.4")).toBe(false);
    expect(isExactPin(">=1.3.14 <2.0.0")).toBe(false);
    expect(isExactPin("*")).toBe(false);
    // Negative arms: the sanctioned exact pins stay silent.
    expect(isExactPin("1.3.14")).toBe(true);
    expect(isExactPin("1.2.4")).toBe(true);
  });

  test("no manifest under apps/ nor the scaffold template declares a non-exact @types/bun spec (HARD)", () => {
    const decls = collectBunTypesDeclarations([APPS_DIR, SCAFFOLD_TEMPLATE]);
    const violations = decls.filter((d) => !isExactPin(d.spec));
    console.info(
      `[standard] @types/bun declarations scanned: ${decls.length} (fresh-resolve quarantine class; ${violations.length} float)`,
    );
    const lines = violations.map(
      (v) =>
        `  ${v.file} declares ${v.section}["@types/bun"] = "${v.spec}" — a float spec resolves to the newest published version (window-fresh 1.4.0, 2026-08-20); pin the exact monorepo-override version 1.3.14`,
    );
    expect(violations, `@types/bun float specs admitting quarantine-window resolutions:\n${lines.join("\n")}`).toEqual([]);
  });
});
