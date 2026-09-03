import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPOSITORY_ROOT } from "./helpers";

/**
 * Lockfile-drift regression for no-own-lockfile members (finding dep-ai-sdk-1).
 *
 * The finding claimed the ROOT bun.lock "resolves versions outside declared
 * ranges for the 8 apps with no own lockfile", citing:
 *   apps/statusline "@modelcontextprotocol/sdk": "1.12.1"  vs "@modelcontextprotocol/sdk@1.30.0"
 *   apps/testers    "pg": "8.21.0"                          vs "pg@8.23.0"
 *   apps/agency     "commander": "^12"                      vs "commander@13.1.0"
 *
 * The cited "resolutions" are the lockfile's HOISTED top-level entries. In a
 * bun.lock v1 workspace layout, a hoisted entry is the resolution ONLY for a
 * member whose declared range admits it — a member whose resolution differs
 * carries its own qualified ("<member-name>/<dep-spec>") entry, which is the
 * per-member resolution bun installs. Measured on the cited members:
 *
 *   `bun install --lockfile-only` (bun 1.3.14 = packageManager): zero diff.
 *   `bun install --frozen-lockfile` at the root: rc=0 (2478 packages).
 *   apps/statusline/node_modules/@modelcontextprotocol/sdk/package.json: 1.12.1
 *   apps/testers/node_modules/pg/package.json:                          8.21.0
 *   apps/agency/node_modules/commander/package.json:                   12.1.0
 *   `bun tooling/ci/check-frozen-locks.ts`: green.
 *
 * So the finding was a detector artifact (hoisted-vs-declared comparison);
 * the per-member resolutions in the install tree satisfy every declared range.
 * The regression below encodes the TRUE invariant — every member without its
 * own lockfile resolves each declared dep inside its declared range — which
 * fails the moment a real manifest/lockfile drift lands for these members, and
 * its resolver deliberately reads the qualified per-member entry before the
 * hoisted one, so the hoisted multi-version artifact cannot re-flag a member
 * whose own resolution is correct (the exact shape of the false positive above).
 */

const DEPENDENCY_SECTIONS = ["dependencies", "devDependencies", "optionalDependencies"] as const;

/** Parse a bun.lock v1 document (JSON with trailing commas tolerated). */
function parseLockfile(filePath: string): any {
  const source = readFileSync(filePath, "utf8");
  return JSON.parse(source.replace(/,(\s*[}\]])/g, "$1"));
}

function parseVersion(version: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/.exec(version.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compare(left: [number, number, number], right: [number, number, number]): number {
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i] < right[i] ? -1 : 1;
  }
  return 0;
}

type RangeShape = { re: RegExp; test: (v: [number, number, number], m: RegExpExecArray) => boolean };

const EXACT: RangeShape = {
  re: /^(\d+)\.(\d+)\.(\d+)$/,
  test: (v, m) => compare(v, [Number(m[1]), Number(m[2]), Number(m[3])]) === 0,
};

const CARET: RangeShape = {
  re: /^\^(\d+)(?:\.(\d+))?(?:\.(\d+))?$/,
  test: (v, m) => {
    const maj = Number(m[1]);
    const min = m[2] === undefined ? null : Number(m[2]);
    const pat = m[3] === undefined ? null : Number(m[3]);
    const floor: [number, number, number] = [maj, min ?? 0, pat ?? 0];
    const ceil: [number, number, number] =
      maj > 0 ? [maj + 1, 0, 0] : (min ?? 0) > 0 ? [maj, min + 1, 0] : [maj, 0, (pat ?? 0) + 1];
    return compare(v, floor) >= 0 && compare(v, ceil) < 0;
  },
};

const TILDE: RangeShape = {
  re: /^~(\d+)(?:\.(\d+))?(?:\.(\d+))?$/,
  test: (v, m) => {
    const maj = Number(m[1]);
    const min = m[2] === undefined ? null : Number(m[2]);
    const pat = m[3] === undefined ? null : Number(m[3]);
    const floor: [number, number, number] = [maj, min ?? 0, pat ?? 0];
    const ceil: [number, number, number] = min === null ? [maj + 1, 0, 0] : pat === null ? [maj, min + 1, 0] : [maj, min, pat + 1];
    return compare(v, floor) >= 0 && compare(v, ceil) < 0;
  },
};

const PARTIAL: RangeShape = {
  re: /^(\d+)(?:\.(\d+))?$/,
  test: (v, m) => {
    const maj = Number(m[1]);
    const min = m[2] === undefined ? null : Number(m[2]);
    const floor: [number, number, number] = [maj, min ?? 0, 0];
    const ceil: [number, number, number] = min === null ? [maj + 1, 0, 0] : [maj, min + 1, 0];
    return compare(v, floor) >= 0 && compare(v, ceil) < 0;
  },
};

const BOUNDED: RangeShape = {
  re: /^>=(\d+\.\d+\.\d+)\s+<(\d+\.\d+\.\d+)$/,
  test: (v, m) => compare(v, parseVersion(m[1])!) >= 0 && compare(v, parseVersion(m[2])!) < 0,
};

const GT: RangeShape = {
  re: /^>\s?(\d+\.\d+\.\d+)$/,
  test: (v, m) => compare(v, parseVersion(m[1])!) > 0,
};

const SHAPES: RangeShape[] = [PARTIAL, EXACT, CARET, TILDE, BOUNDED, GT];

/**
 * Does `range` admit `version`? Supports the range shapes recorded for these
 * members' deps: exact ("1.21.0"), caret ("^12", "^1.12.1", "^0.1.7"), tilde
 * ("~1.2.3"), partial ("1.2", "1", "3"), star ("*" | "x" | "X"), "latest",
 * explicit bounds (">=0.1.7 <0.2.0") and OR-combos ("^4.6.0 || ^5.0.0").
 * Unparseable shapes return null — the check fails OPEN on shapes it cannot
 * prove, so the suite can only flag skew it can demonstrate.
 */
function satisfiesRange(range: string, version: string): boolean | null {
  const v = parseVersion(version);
  if (!v) return null;
  const spec = range.trim();
  if (spec === "" || spec === "*" || spec === "x" || spec === "X" || spec === "latest") return true;
  let provable = false;
  for (const part of spec.split("||").map((s) => s.trim())) {
    if (!part) continue;
    let matchedShape = false;
    for (const shape of SHAPES) {
      const m = shape.re.exec(part);
      if (!m) continue;
      matchedShape = true;
      provable = true;
      if (shape.test(v, m)) return true;
    }
    if (!matchedShape) return null; // shape we cannot prove — fail open
  }
  return provable ? false : null;
}

/**
 * Resolved version of `dep` FOR MEMBER `memberName` in a bun.lock v1 document.
 * The per-member resolution is the QUALIFIED entry `"<memberName>/<dep>"` when
 * present (bun records it when the member's resolution differs from the
 * hoisted one); otherwise the member's resolution IS the hoisted entry. This
 * order is the false-positive guard that makes the check fire only on genuine
 * per-member drift — a hoisted entry at a different version (the multi-version
 * artifact) never re-flags a member whose own qualified entry is correct.
 */
function resolvedSpecFor(
  entries: Record<string, unknown>,
  memberName: string,
  dep: string,
): { spec: string; via: "edge" | "hoisted" } | null {
  const edge = entries[`${memberName}/${dep}`];
  if (Array.isArray(edge) && typeof edge[0] === "string") return { spec: edge[0], via: "edge" };
  const hoisted = entries[dep];
  if (Array.isArray(hoisted) && typeof hoisted[0] === "string") return { spec: hoisted[0], via: "hoisted" };
  return null;
}

function versionOf(spec: string): string | null {
  const match = /@(\d+\.\d+\.\d+)(?:[-+][0-9A-Za-z.-]+)?$/.exec(spec);
  return match ? match[1] : null;
}

/** Members with no own bun.lock, resolved from the tree (the finding's 8). */
function noOwnLockMembers(root: string = REPOSITORY_ROOT): string[] {
  const appsRoot = join(root, "apps");
  return readdirSync(appsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((member) => existsSync(join(appsRoot, member, "package.json")))
    .filter((member) => !existsSync(join(appsRoot, member, "bun.lock")))
    .sort();
}

interface DriftViolation {
  member: string;
  dep: string;
  field: string;
  declared: string;
  resolved: string;
  via: "edge" | "hoisted";
}

/** Per-member resolution-vs-declared check over a root lockfile + member manifests. */
function checkDrift(root: string, lockDoc: any): DriftViolation[] {
  const entries = lockDoc.packages ?? {};
  const violations: DriftViolation[] = [];
  for (const member of noOwnLockMembers(root)) {
    const manifest = JSON.parse(readFileSync(join(root, "apps", member, "package.json"), "utf8"));
    const name = manifest.name;
    if (typeof name !== "string") continue;
    for (const field of DEPENDENCY_SECTIONS) {
      const deps = manifest[field];
      if (typeof deps !== "object" || deps === null) continue;
      for (const [dep, range] of Object.entries(deps as Record<string, unknown>)) {
        const declared = String(range);
        const resolved = resolvedSpecFor(entries, name, dep);
        if (!resolved) {
          violations.push({ member, dep, field, declared, resolved: "(no resolution recorded)", via: "hoisted" });
          continue;
        }
        if (resolved.spec.includes("workspace:")) continue; // workspace linkage — the internal registry's axis, not a declaration drift
        const version = versionOf(resolved.spec);
        if (version === null) continue;
        if (satisfiesRange(declared, version) === false) {
          violations.push({ member, dep, field, declared, resolved: resolved.spec, via: resolved.via });
        }
      }
    }
  }
  return violations;
}

describe("lockfile drift — members without own lockfile resolve inside declared ranges (dep-ai-sdk-1)", () => {
  const root = REPOSITORY_ROOT;
  const lock = parseLockfile(join(root, "bun.lock"));

  test("the matcher discriminates (prove-it-can-fail arms)", () => {
    // Positive arms: declared-range violations the check must fire on.
    expect(satisfiesRange("1.12.1", "1.30.0")).toBe(false);
    expect(satisfiesRange("8.21.0", "8.23.0")).toBe(false);
    expect(satisfiesRange("^12", "13.1.0")).toBe(false);
    expect(satisfiesRange("^1.12.1", "1.6.1")).toBe(false);
    expect(satisfiesRange("^0.1.7", "0.2.0")).toBe(false);
    // Negative arms: in-range resolutions the check must stay silent on.
    expect(satisfiesRange("1.12.1", "1.12.1")).toBe(true);
    expect(satisfiesRange("8.21.0", "8.21.0")).toBe(true);
    expect(satisfiesRange("^12", "12.1.0")).toBe(true);
    expect(satisfiesRange("^1.12.1", "1.30.0")).toBe(true);
    expect(satisfiesRange("^5", "5.6.2")).toBe(true);
    expect(satisfiesRange("3", "3.25.76")).toBe(true);
    expect(satisfiesRange("latest", "1.3.14")).toBe(true);
  });

  test("the resolver reads the per-member edge before the hoisted entry (false-positive guard)", () => {
    // Fixture mirroring the measured shape: the hoisted entry resolves OUTSIDE
    // the member's declared range, but the qualified per-member edge resolves
    // INSIDE it — the exact shape of the finding's cited "drift".
    const hoistedOutside = {
      packages: {
        "@modelcontextprotocol/sdk": ["@modelcontextprotocol/sdk@1.30.0", ""],
        "@hasna/statusline": ["@hasna/statusline@workspace:apps/statusline"],
        "@hasna/statusline/@modelcontextprotocol/sdk": ["@modelcontextprotocol/sdk@1.12.1", ""],
      },
    };
    const scratch = join(process.env.TMPDIR ?? "/tmp", `lkf-drift-fixture-${process.pid}`);
    mkdirSync(join(scratch, "apps/statusline"), { recursive: true });
    writeFileSync(
      join(scratch, "apps/statusline/package.json"),
      JSON.stringify({ name: "@hasna/statusline", dependencies: { "@modelcontextprotocol/sdk": "1.12.1" } }),
    );
    try {
      // Edge in range + hoisted out of range: silent — the finding's exact shape.
      expect(checkDrift(scratch, hoistedOutside)).toEqual([]);
      // Same fixture, but the edge now resolves outside the declared range: fires.
      const edgeOutside = structuredClone(hoistedOutside);
      edgeOutside.packages["@hasna/statusline/@modelcontextprotocol/sdk"] = ["@modelcontextprotocol/sdk@1.30.0", ""];
      const edgeHits = checkDrift(scratch, edgeOutside);
      expect(edgeHits.some((v) => v.dep === "@modelcontextprotocol/sdk" && v.resolved === "@modelcontextprotocol/sdk@1.30.0")).toBe(true);
      // No edge at all: the hoisted resolution governs, and it is outside the range: fires.
      const onlyHoisted = { packages: { "@modelcontextprotocol/sdk": ["@modelcontextprotocol/sdk@1.30.0", ""] } };
      expect(checkDrift(scratch, onlyHoisted).some((v) => v.via === "hoisted")).toBe(true);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  test("the members without an own lockfile are the finding's 6", () => {
    // telephony gained a hermetic bun.lock in #1432 (O15-04773); agency was
    // deleted entirely (hasna/apps#1541) — the expected list tracks main's
    // committed lockfile state.
    expect(noOwnLockMembers(root)).toEqual([
      "connectors",
      "paths",
      "statusline",
      "testers",
    ]);
  });

  test("apps/statusline resolves @modelcontextprotocol/sdk@1.12.1 inside its declared range", () => {
    const entries = lock.packages ?? {};
    const resolved = resolvedSpecFor(entries, "@hasna/statusline", "@modelcontextprotocol/sdk");
    expect(resolved?.spec).toBe("@modelcontextprotocol/sdk@1.12.1");
    expect(satisfiesRange("1.12.1", versionOf(resolved!.spec)!)).toBe(true);
  });

  test("apps/testers resolves pg@8.21.0 inside its declared range", () => {
    const entries = lock.packages ?? {};
    const resolved = resolvedSpecFor(entries, "@hasna/testers", "pg");
    expect(resolved?.spec).toBe("pg@8.21.0");
    expect(satisfiesRange("8.21.0", versionOf(resolved!.spec)!)).toBe(true);
  });

  test("every member without an own lockfile resolves every declared dep inside its declared range", () => {
    const violations = checkDrift(root, lock);
    expect(
      violations.length === 0,
      violations
        .slice(0, 12)
        .map((v) => `apps/${v.member}: ${v.field}["${v.dep}"] declared "${v.declared}" resolves ${v.resolved} (${v.via})`)
        .join("\n  "),
    ).toBe(true);
  });
});
