import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Regression guard for the dashboard setup instructions.
 *
 * `dashboard/` carries its own `package.json` and is NOT declared as a workspace
 * of the repository root, so a root-only `bun install` never installs React,
 * Vite, or ESLint. Documentation that tells a reader to install from the root
 * and then drive the dashboard is therefore false on a clean clone:
 * `bun run dev` dies with `vite: command not found` (exit 127) and
 * `bun run build` — which the root build shells into — dies with
 * `Cannot find module 'vite'` (exit 1).
 *
 * The guard is conditional on the manifest rather than hardcoding the extra
 * step: if the root ever declares `dashboard` as a workspace, the root install
 * genuinely does cover it and the separate instruction stops being required.
 */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Docs whose primary path is "set the repo up, then run or build the dashboard". */
const DASHBOARD_SETUP_DOCS = ["dashboard/README.md", "CLAUDE.md", "CONTRIBUTING.md"];

/**
 * A dashboard-local install, in any of the shapes these docs use:
 * `cd dashboard && bun install`, `(cd dashboard && bun install)`, or `cd
 * dashboard` on its own line followed by `bun install`.
 */
const DASHBOARD_INSTALL = /cd\s+dashboard\b[^\n]*\n?[^\n]*\bbun install\b/;

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), "utf8");
}

function rootManifest(): Record<string, unknown> {
  return JSON.parse(read("package.json")) as Record<string, unknown>;
}

/** True only when a root `bun install` really does install `dashboard/`'s dependencies. */
function rootWorkspacesCoverDashboard(): boolean {
  const workspaces = rootManifest().workspaces;
  const patterns = Array.isArray(workspaces)
    ? workspaces
    : typeof workspaces === "object" && workspaces !== null && Array.isArray((workspaces as { packages?: unknown }).packages)
      ? ((workspaces as { packages: unknown[] }).packages as unknown[])
      : [];
  return patterns.some((pattern) => typeof pattern === "string" && /^\.?\/?(dashboard|\*|packages\/\*)\/?$/.test(pattern));
}

describe("dashboard install documentation", () => {
  test("every setup doc that drives the dashboard documents its separate install", () => {
    if (rootWorkspacesCoverDashboard()) return; // Root install reaches dashboard/; the extra step is redundant.

    const offenders = DASHBOARD_SETUP_DOCS.filter((doc) => !DASHBOARD_INSTALL.test(read(doc)));

    expect(offenders).toEqual([]);
  });

  /**
   * The reason the guard above exists, pinned so that a change in the dependency
   * layout surfaces here instead of silently making the docs redundant: the
   * dashboard's `dev` and `build` scripts run `vite`, and `vite` is declared only
   * in `dashboard/package.json`, never in the root manifest.
   */
  test("the dashboard's build tooling is declared only in its own manifest", () => {
    const dashboard = JSON.parse(read("dashboard/package.json")) as {
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const root = rootManifest() as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    expect(dashboard.scripts?.dev).toContain("vite");
    expect(dashboard.scripts?.build).toContain("vite build");
    expect({ ...dashboard.dependencies, ...dashboard.devDependencies }).toHaveProperty("vite");
    expect({ ...root.dependencies, ...root.devDependencies }).not.toHaveProperty("vite");
  });
});
