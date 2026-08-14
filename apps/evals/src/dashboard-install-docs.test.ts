import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Regression guard for the dashboard setup instructions (monorepo absorption).
 *
 * In the monorepo, `dashboard/` keeps its own `package.json` but is NOT a
 * workspace member; the parent manifest (`package.json` of this package)
 * declares the dashboard's build tooling (Vite, React, ESLint types) in its
 * own devDependencies, so a root `bun install` installs everything the
 * dashboard build needs (hoisted to the workspace root). This inverts the
 * pre-import layout, where `dashboard/` was a second install root and a
 * root-only `bun install` never reached React, Vite, or ESLint.
 *
 * The guards are conditional on the manifests rather than hardcoding: if the
 * layout ever changes again, the assertions surface the change instead of
 * silently letting the docs rot.
 */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Docs whose primary path is "set the repo up, then run or build the dashboard". */
const DASHBOARD_SETUP_DOCS = ["dashboard/README.md", "CLAUDE.md", "CONTRIBUTING.md"];

/**
 * A dashboard-local install instruction, in any of the shapes these docs
 * might use: `cd dashboard && bun install`, `(cd dashboard && bun install)`,
 * or `cd dashboard` on its own line followed by `bun install`.
 */
const DASHBOARD_INSTALL = /cd\s+dashboard\b[^\n]*\n?[^\n]*\bbun install\b/;

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), "utf8");
}

function rootManifest(): Record<string, unknown> {
  return JSON.parse(read("package.json")) as Record<string, unknown>;
}

/** True when this package's manifest declares the dashboard's build tooling. */
function parentManifestCoversDashboard(): boolean {
  const manifest = rootManifest() as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const all = { ...manifest.dependencies, ...manifest.devDependencies };
  return typeof all["vite"] === "string" && typeof all["react"] === "string";
}

describe("dashboard install documentation", () => {
  test("every setup doc that drives the dashboard documents the root install", () => {
    const offenders = DASHBOARD_SETUP_DOCS.filter((doc) => DASHBOARD_INSTALL.test(read(doc)));

    expect(offenders).toEqual([]);
  });

  /**
   * The monorepo contract pinned, so that a change in the dependency layout
   * surfaces here instead of silently making the docs redundant: the
   * dashboard's `dev` and `build` scripts run `vite`, and the parent manifest
   * declares the dashboard's tooling so the root `bun install` covers it.
   */
  test("the dashboard's build tooling is declared in the parent manifest", () => {
    const dashboard = JSON.parse(read("dashboard/package.json")) as {
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    expect(dashboard.scripts?.dev).toContain("vite");
    expect(dashboard.scripts?.build).toContain("vite build");
    expect({ ...dashboard.dependencies, ...dashboard.devDependencies }).toHaveProperty("vite");
    expect(parentManifestCoversDashboard()).toBe(true);
  });
});
