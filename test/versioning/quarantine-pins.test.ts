import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { REPOSITORY_ROOT } from "./helpers";

/**
 * Third-party quarantine pin regression (finding dep-hono-1).
 *
 * The machine supply-chain quarantine (`minimumReleaseAge = 604800` in
 * `~/.bunfig.toml`, 7 days) refuses to resolve a dependency version published
 * inside the window unless the exact package name is in
 * `minimumReleaseAgeExcludes`. hono has NO excludes entry, and on 2026-08-26
 * twelve apps declared open caret ranges that admit quarantine-window
 * hono releases:
 *
 *   hono@4.13.5 2026-08-26T02:00:22.990Z  (inside window, the finding)
 *   hono@4.13.4 2026-08-24T08:48:08.642Z  (inside window)
 *   hono@4.13.3 2026-08-18T10:56:09.752Z  (outside window — the pin)
 *
 * A caret range (`^4.6.0`..`^4.12.7`) admits both window releases, so a fresh
 * resolution drifts onto the violation; the exact pin format (`4.13.3`) is
 * what keeps the declared range stable on the quarantine boundary. The fix
 * pins every `hono` declaration to `4.13.3` — and the scan is RECURSIVE:
 * a nested package (apps/notes/server) and a connector definition
 * (apps/connectors/connectors/clickbank) are resolution surfaces of their own
 * and were missed by the flat one-deep scan of apps/<dir>/package.json
 * (review finding on dep-hono-1).
 *
 * The forbidden list is hardcoded (published versions + timestamps above) —
 * this suite is deliberately offline/hermetic and cannot probe the registry.
 * The matcher arms below ensure the call fails on a caret range and stays
 * silent on the exact pin, so the check discriminates.
 */

// Minimal range matcher — exact, caret, tilde. Unknown shapes fail open
// (false), exactly as the frozen-lock gate treats unprovable shapes.
function parseVersion(v: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/.exec(v.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function versionCmp(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

function satisfiesRange(range: string, version: string): boolean {
  const v = parseVersion(version);
  if (!v) return false;
  const spec = range.trim();
  const exact = /^(\d+)\.(\d+)\.(\d+)$/.exec(spec);
  if (exact) return versionCmp(v, [Number(exact[1]), Number(exact[2]), Number(exact[3])]) === 0;
  const caret = /^\^(\d+)\.(\d+)\.(\d+)$/.exec(spec);
  if (caret) {
    const maj = Number(caret[1]);
    const floor: [number, number, number] = [maj, Number(caret[2]), Number(caret[3])];
    // Caret ceiling: ^1.x.y < 2.0.0; ^0.x.y < 0.(x+1).0 (the 0.x branch keeps
    // the matcher non-vacuous beyond this finding's shape).
    const ceil: [number, number, number] = maj > 0 ? [maj + 1, 0, 0] : [0, maj + 1, 0];
    return versionCmp(v, floor) >= 0 && versionCmp(v, ceil) < 0;
  }
  const tilde = /^~(\d+)\.(\d+)\.(\d+)$/.exec(spec);
  if (tilde) {
    const t = [Number(tilde[1]), Number(tilde[2]), Number(tilde[3])] as [number, number, number];
    const ceil: [number, number, number] = [t[0], t[1] + 1, 0];
    return versionCmp(v, t) >= 0 && versionCmp(v, ceil) < 0;
  }
  return false;
}

const FORBIDDEN = ["4.13.4", "4.13.5"];

// Every package.json under apps/, recursively. A flat apps/<dir> scan
// silently excludes nested resolution surfaces; the shallow one was the
// review finding on this lane (notes/server and clickbank both sit deeper).
const SKIP_DIRS = new Set(["node_modules", ".test-home", ".git", "dist"]);

function collectPackageManifests(root: string): string[] {
  const found: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) visit(path);
      } else if (entry.isFile() && entry.name === "package.json") {
        found.push(path);
      }
    }
  };
  visit(root);
  return found.sort();
}

describe("third-party quarantine pins", () => {
  test("the range matcher discriminates (prove-it-can-fail arms)", () => {
    // Positive arms: the shapes that must fire on window releases.
    expect(satisfiesRange("^4.6.0", "4.13.5")).toBe(true);
    expect(satisfiesRange("^4.12.7", "4.13.4")).toBe(true);
    expect(satisfiesRange("^4.7.4", "4.13.5")).toBe(true);
    // Negative arms: the fixed shape must stay silent.
    expect(satisfiesRange("4.13.3", "4.13.5")).toBe(false);
    expect(satisfiesRange("4.13.3", "4.13.4")).toBe(false);
    // Boundary arms: caret stops at the next major, tilde stops at the next minor.
    expect(satisfiesRange("^1.0.0", "2.0.0")).toBe(false);
    expect(satisfiesRange("~4.12.7", "4.13.0")).toBe(false);
  });

  test("no app hono range admits quarantine-window releases (dep-hono-1)", () => {
    const appsRoot = join(REPOSITORY_ROOT, "apps");
    const offenders: string[] = [];
    for (const manifestPath of collectPackageManifests(appsRoot)) {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
      for (const section of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"] as const) {
        const deps = manifest[section];
        if (!deps || typeof deps !== "object" || Array.isArray(deps)) continue;
        const range = (deps as Record<string, unknown>)["hono"];
        if (typeof range !== "string") continue;
        for (const version of FORBIDDEN) {
          if (satisfiesRange(range, version)) {
            offenders.push(`${relative(REPOSITORY_ROOT, manifestPath)} ${section}[hono] = "${range}" admits hono@${version} (quarantine window)`);
          }
        }
      }
    }
    if (offenders.length > 0) console.error(`[FAIL versioning] ${offenders.length} hono pin(s) admit quarantine-window releases:\n  - ${offenders.join("\n  - ")}`);
    expect(offenders).toEqual([]);
  });
});
