/**
 * Quarantine admission of the bun dev-runtime type pins — standard-adherence suite.
 *
 * The 7-day minimum-release-age policy (`minimumReleaseAge = 604800` in the
 * machine bunconfig, `min-release-age=7` in npm config) refuses an install
 * whose resolved version was published inside the window. A member manifest
 * that declares `@types/bun` or `bun-types` with a floating or partial range
 * (`latest`, `^1.3.14`, `^1.2.4`, `~1.x.y`) ADMITS a freshly published minor
 * (e.g. @types/bun@1.4.0 + bun-types@1.4.0, published 2026-08-20) the moment
 * whatever relied on that range re-resolves — and the resolution then
 * silently depends on an OUT-OF-REPO quarantine setting to downgrade back to
 * an older version instead of admitting the fresh one. Measured on bun 1.3.14
 * in a scratch repo: `"@types/bun": "latest"` resolves to @types/bun@1.3.14
 * today precisely because 1.4.0 sits inside the window; without the setting
 * it resolves 1.4.0, the types for a runtime the tree's pinned toolchain
 * (packageManager bun@1.3.14) does not run.
 *
 * The tree's canonical pin for these two names is the ROOT package.json
 * `overrides` entry (initialized to "1.3.14" for both when the tree runs bun
 * 1.3.14). The invariant: a publishable member that declares either name
 * declares the EXACT pinned version the root override carries — the state a
 * quarantine-safe resolution produces — so no member declaration can admit a
 * fresher version nor drift from the canonical pin (the override, the
 * lockfile, and the member declarations move together in one coordinated
 * bump; this gate forces them to).
 *
 * CLass filed: dep-notes-1 (PIN VIOLATION, P1, 2026-08-25): 66 member
 * declarations of @types/bun as `latest`/`^` ranges and 5 `bun-types: latest`
 * admit the 1.4.0 releases; the audit pinned the declarations to exact 1.3.14.
 *
 * HARD: `bun run check` runs test:standard, a hard gate in .github/workflows/ci.yml.
 *
 * NETWORK: none — the invariant is internal to the tree (manifests vs the
 * root override), so the check is hermetic and cannot skip like the
 * registry-backed lanes.
 */
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { APPS_DIR, REPO_ROOT, publishableMembers } from "./census";

const DEP_SECTIONS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"] as const;
/** The two bun dev-runtime type packages the audit lane flags: a fresh minor
 * on either is admitted by `latest`/`^`/`~` declarations and the tree pins
 * them by exact override. Limited to these names because the quarantine
 * class is specific to dev-runtime types changing with the runtime. */
const DEV_TYPE_NAMES = ["@types/bun", "bun-types"] as const;

export interface DivergentDevTypePin {
  member: string;
  dependency: string;
  spec: string;
  canonical: string;
}

/** Read the canonical pinned version of one dev-type package from the ROOT
 * package.json overrides. The root override is the single source of truth
 * the resolution actually follows; undefined when the root manifest no
 * longer overrides the name. */
export function canonicalDevTypePin(rootManifest: Record<string, unknown>, dependency: string): string | undefined {
  const overrides = rootManifest.overrides;
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) return undefined;
  const value = (overrides as Record<string, unknown>)[dependency];
  return typeof value === "string" ? value : undefined;
}

/** Collect every member declaration of @types/bun / bun-types that does NOT
 * exactly equal the root override's canonical pin. A declaration is
 * collected when it uses a floating/partial range (which admits a fresh
 * publish inside the quarantine window) or pins a different exact version
 * (divergence from the canonical pin). A member that declares neither name
 * is silent. */
export function collectDivergentDevTypePins(
  members: Array<{ name: string }>,
  manifests: Map<string, Record<string, unknown>>,
  rootManifest: Record<string, unknown>,
): DivergentDevTypePin[] {
  const divergent: DivergentDevTypePin[] = [];
  for (const member of members) {
    const pkg = manifests.get(member.name);
    if (!pkg) continue;
    for (const section of DEP_SECTIONS) {
      const deps = pkg[section];
      if (!deps || typeof deps !== "object" || Array.isArray(deps)) continue;
      for (const dependency of DEV_TYPE_NAMES) {
        const spec = (deps as Record<string, unknown>)[dependency];
        if (typeof spec !== "string") continue;
        const canonical = canonicalDevTypePin(rootManifest, dependency);
        if (canonical === undefined || spec !== canonical) {
          divergent.push({ member: member.name, dependency, spec, canonical: canonical ?? "<no-root-override>" });
        }
      }
    }
  }
  return divergent.sort((a, b) => `${a.member}${a.dependency}`.localeCompare(`${b.member}${b.dependency}`));
}

const REAL_MEMBERS = publishableMembers();
const REAL_MANIFESTS = new Map(
  REAL_MEMBERS.map((m) => [m.name, JSON.parse(fs.readFileSync(path.join(APPS_DIR, m.name, "package.json"), "utf8")) as Record<string, unknown>]),
);
const REAL_ROOT = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")) as Record<string, unknown>;

describe("standard-adherence: quarantine-safe dev-type pins", () => {
  test("self-test: ranges/latest and divergent exact pins are collected; canonical exact pins are silent", () => {
    const members = [
      { name: "alpha" },
      { name: "beta" },
      { name: "gamma" },
      { name: "delta" },
    ];
    const rootManifest = { overrides: { "@types/bun": "1.3.14", "bun-types": "1.3.14" } };
    const manifests = new Map<string, Record<string, unknown>>([
      ["alpha", { devDependencies: { "@types/bun": "latest", "bun-types": "^1.3.14" } }], // ranges/latest: collected
      ["beta", { devDependencies: { "@types/bun": "1.3.14", "bun-types": "1.3.14" } }], // canonical exact: silent
      ["gamma", { dependencies: { "bun-types": "1.3.9" } }], // divergent exact pin: collected
      ["delta", { devDependencies: { "typescript": "5.9.3" } }], // unrelated: silent
    ]);
    const divergent = collectDivergentDevTypePins(members, manifests, rootManifest);
    expect(divergent).toEqual([
      { member: "alpha", dependency: "@types/bun", spec: "latest", canonical: "1.3.14" },
      { member: "alpha", dependency: "bun-types", spec: "^1.3.14", canonical: "1.3.14" },
      { member: "gamma", dependency: "bun-types", spec: "1.3.9", canonical: "1.3.14" },
    ]);
  });

  test("self-test: a root manifest without an override for the name yields a collection, not a silent pass", () => {
    const members = [{ name: "alpha" }];
    const manifests = new Map<string, Record<string, unknown>>([["alpha", { devDependencies: { "@types/bun": "1.3.14" } }]]);
    const divergent = collectDivergentDevTypePins(members, manifests, { overrides: {} });
    expect(divergent).toEqual([{ member: "alpha", dependency: "@types/bun", spec: "1.3.14", canonical: "<no-root-override>" }]);
  });

  test("no publishable member admits a fresh dev-type release or diverges from the root canonical pin (HARD)", () => {
    const divergent = collectDivergentDevTypePins(REAL_MEMBERS, REAL_MANIFESTS, REAL_ROOT);
    if (divergent.length === 0) {
      console.info("[standard] quarantine admission: no divergent @types/bun / bun-types declarations");
      return;
    }
    const lines = divergent.map((d) => `  ${d.member} declares ${d.dependency} ${d.spec} (canonical: ${d.canonical}) — pin to ${d.canonical}`);
    console.info(`[standard] divergent dev-type pins (HARD):\n${lines.join("\n")}`);
    expect(divergent, `member declarations admitting a fresh dev-type release or diverging from the root pin:\n${lines.join("\n")}`).toEqual([]);
  });

  test("report: emit the dev-type pin census", () => {
    const byDep = new Map<string, string[]>();
    for (const member of REAL_MEMBERS) {
      const pkg = REAL_MANIFESTS.get(member.name);
      if (!pkg) continue;
      for (const section of DEP_SECTIONS) {
        const deps = pkg[section];
        if (!deps || typeof deps !== "object" || Array.isArray(deps)) continue;
        for (const dependency of DEV_TYPE_NAMES) {
          const spec = (deps as Record<string, unknown>)[dependency];
          if (typeof spec !== "string") continue;
          byDep.set(dependency, [...(byDep.get(dependency) ?? []), `${member.name}@${spec}`]);
        }
      }
    }
    console.log(
      `\n[standard] dev-type pins: ${[...byDep.values()].reduce((n, refs) => n + refs.length, 0)} declaration(s) across ${byDep.size} package(s)\n` +
        [...byDep.entries()]
          .map(([dep, refs]) => {
            const counts = new Map<string, number>();
            for (const ref of refs) counts.set(ref.split("@").slice(1).join("@"), (counts.get(ref.split("@").slice(1).join("@")) ?? 0) + 1);
            return `  ${dep}: ${[...counts.entries()].sort().map(([spec, n]) => `${spec} x${n}`).join(", ")}`;
          })
          .sort()
          .join("\n"),
    );
  });
});
