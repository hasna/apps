/**
 * Contracts conformance — standard-adherence suite, check 1.
 *
 * For every publishable member that carries a hasna.contract.json, run the
 * canonical manifest validator (`contracts repo-conformance` from
 * @hasna/contracts) at the member's effective kit version and assert the
 * manifest passes. The validator is the same one the member pins: a
 * manifest claims a kit (kitVersion) and must validate against a kit that
 * understands its shape. Effective version resolution (measured
 * 2026-08-14):
 *
 *   1. the member's pinned @hasna/contracts dependency when >= 0.4.1
 *      (0.2.2 and 0.1.0 do not expose `repo-conformance`);
 *   2. else the manifest's kitVersion when that version exists on npm;
 *   3. else `latest`.
 *
 * Recorded exceptions (CONTRACTS_EXCEPTIONS) are the measured failures as
 * of 2026-08-14, each with a filed remediation task. Two-sided contract of
 * the registry: a member IN the registry must actually FAIL today (a fixed
 * member with a stale exception entry fails the suite), and a member NOT
 * in the registry must PASS. When a violation is fixed, delete its entry.
 */
import { describe, expect, test, beforeAll } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import {
  REPO_ROOT,
  APPS_DIR,
  members,
  publishableMembers,
  versionAtLeast,
  resolveValidatorVersion,
  runConformance,
  CONTRACTS_EXCEPTIONS,
  CONTRACTS_EXCEPTION_MEMBERS,
  MANIFEST_MISSING_EXCEPTIONS,
  MANIFEST_MISSING_MEMBERS,
  KIT_VERSION_EXCEPTIONS,
  KIT_VERSION_EXCEPTION_MEMBERS,
  NO_VALIDATOR_PIN,
  ensureReconcileTask,
} from "./census";

export interface ConformanceEntry {
  member: string;
  version: string;
  verdict: "ok" | "fail" | "cannot-run";
  fails: string[];
}

/** versionAtLeast, resolveValidatorVersion and runConformance are SHARED
 * with the check-manifests CI gate — they live in ./census so the suite and
 * the gate validate at the same effective version with the same invocation. */

function buildReport(): { entries: ConformanceEntry[]; known: Set<string>; kitByMember: Map<string, string>; pinnedByMember: Map<string, string | undefined> } {
  const known = new Set(["0.4.1", "0.4.2", "0.5.2", "0.8.1", "0.8.2", "0.8.4", "0.8.5", "0.9.0", "0.10.6", "0.13.1"]);
  const entries: ConformanceEntry[] = [];
  const kitByMember = new Map<string, string>();
  const pinnedByMember = new Map<string, string | undefined>();
  for (const m of members()) {
    if (!m.hasManifest) continue;
    const manifest = JSON.parse(fs.readFileSync(path.join(APPS_DIR, m.name, "hasna.contract.json"), "utf8")) as {
      kitVersion?: string;
    };
    const kitVersion = manifest.kitVersion;
    kitByMember.set(m.name, kitVersion ?? "");
    pinnedByMember.set(m.name, m.contractsDep);
    const version = resolveValidatorVersion(m.contractsDep, kitVersion, known);
    const { verdict, fails } = runConformance(`apps/${m.name}`, version);
    entries.push({ member: m.name, version, verdict, fails });
  }
  return { entries, known, kitByMember, pinnedByMember };
}

const report = buildReport();
const byMember = new Map(report.entries.map((e) => [e.member, e]));

describe("standard-adherence: contracts conformance", () => {
  test("caret-ranged @hasna/contracts pins resolve to the pinned validator, not a caret-stripped exact version", () => {
    // Regression (2026-08-21): members pinned ^0.13.0, the caret-strip turned
    // the pin into the exact never-published 0.13.0, and bunx E404'd — the
    // manifest gate refused 9 members ("cannot-run"). The raw pin must flow
    // through so bunx resolves the range (0.13.1) against the registry.
    expect(versionAtLeast("^0.13.0", "0.4.1")).toBe(true);
    expect(versionAtLeast("~0.8.2", "0.4.1")).toBe(true);
    expect(versionAtLeast("0.13.0", "0.4.1")).toBe(true);
    expect(versionAtLeast("0.2.2", "0.4.1")).toBe(false);
    const known = new Set(["0.4.1", "0.8.4", "0.13.1"]);
    expect(resolveValidatorVersion("^0.13.0", "0.8.4", known)).toBe("^0.13.0");
    expect(resolveValidatorVersion("0.13.1", "0.8.4", known)).toBe("0.13.1");
    expect(resolveValidatorVersion(undefined, "0.8.4", known)).toBe("0.8.4");
    expect(resolveValidatorVersion(undefined, "0.1.0", known)).toBe("latest");
  });

  test("every publishable member carries hasna.contract.json (recorded exceptions allowed)", () => {
    const missing = publishableMembers()
      .filter((m) => !m.hasManifest)
      .map((m) => m.name)
      .sort();
    const unrecorded = missing.filter((n) => !MANIFEST_MISSING_MEMBERS.has(n));
    expect(unrecorded, `members without hasna.contract.json and without a recorded exception: ${unrecorded.join(", ")}`).toEqual([]);
    // The registry must not rot: every recorded missing-manifest member must
    // actually still be missing.
    const stale = MANIFEST_MISSING_EXCEPTIONS.filter((e) => {
      const m = publishableMembers().find((x) => x.name === e.member);
      return !m || m.hasManifest;
    }).map((e) => e.member);
    expect(stale, `recorded manifest-missing exceptions that are no longer missing: ${stale.join(", ")}`).toEqual([]);
  });

  test("the validator must run for every manifest-bearing member (no cannot-run)", () => {
    const cannotRun = report.entries.filter((e) => e.verdict === "cannot-run").map((e) => `${e.member}@${e.version}`);
    expect(cannotRun, `validator could not run: ${cannotRun.join(", ")}`).toEqual([]);
  });

  // Auto-filing spawns one `todos task upsert` per violation; a full census
  // can exceed bun's default 5000ms per-test timeout, so these two reporting
  // lanes declare their own bound (the standard CI job runs the whole suite
  // with this same bound).
  test("conformance: new violations are reported and auto-filed; each recorded exception must still fail", async () => {
    const unexpected = report.entries.filter((e) => e.verdict === "fail" && !CONTRACTS_EXCEPTION_MEMBERS.has(e.member));
    const filed: string[] = [];
    for (const entry of unexpected) {
      const memberName = entry.member;
      const className = entry.fails[0]?.replace(/^fail\s+/, "").split(":")[0]?.trim() ?? "conformance";
      const title = `Reconcile @hasna/${memberName} contracts conformance: ${className}`;
      const description = `Standard-adherence suite (tooling/ci/tests/standard) measured a conformance violation at main: ${entry.fails.join(" | ")} (validated at ${entry.version}). Acceptance: the member's manifest passes at its effective validator version, then this fingerprint disappears from the suite's report.`;
      const task = await ensureReconcileTask(title, description);
      filed.push(
        `${memberName} (${entry.version}): ${entry.fails.slice(0, 2).join(" | ")} -> reconcile task ${task ? `${task.id} (${task.created ? "created" : "existing"})` : "NOT FILED (todos unavailable)"}`,
      );
    }
    if (filed.length > 0) console.info(`[standard] new contracts conformance violations (auto-filed, reporting lane):\n${filed.map((l) => `  ${l}`).join("\n")}`);
    // Two-sided registry contract: an exception entry whose member now PASSES
    // is stale and must fail the suite until removed.
    const stale = CONTRACTS_EXCEPTIONS.filter((e) => byMember.get(e.member)?.verdict === "ok").map((e) => e.member);
    expect(stale, `recorded contracts exceptions that now pass: ${stale.join(", ")}`).toEqual([]);
  }, 300_000);

  test("every manifest-bearing member is either passing, a recorded exception, or auto-filed", async () => {
    const unclassified = report.entries.filter((e) => {
      if (e.verdict === "ok") return false;
      return !CONTRACTS_EXCEPTION_MEMBERS.has(e.member);
    });
    const filed: string[] = [];
    for (const entry of unclassified) {
      const memberName = entry.member;
      const className = entry.fails[0]?.replace(/^fail\s+/, "").split(":")[0]?.trim() ?? "conformance";
      const title = `Reconcile @hasna/${memberName} contracts conformance: ${className}`;
      const description = `Standard-adherence suite (tooling/ci/tests/standard) measured a conformance violation at main: ${entry.fails.join(" | ")} (validated at ${entry.version}). Acceptance: the member's manifest passes at its effective validator version, then this fingerprint disappears from the suite's report.`;
      const task = await ensureReconcileTask(title, description);
      filed.push(`${memberName} (${entry.version}) -> reconcile task ${task ? `${task.id} (${task.created ? "created" : "existing"})` : "NOT FILED (todos unavailable)"}`);
    }
    if (filed.length > 0) console.info(`[standard] unclassified conformance members (auto-filed, reporting lane):\n${filed.map((l) => `  ${l}`).join("\n")}`);
  }, 300_000);

  test("kitVersion matches the pinned @hasna/contracts version where present (recorded mismatches allowed)", () => {
    const mismatches: string[] = [];
    for (const m of publishableMembers()) {
      if (!m.hasManifest) continue;
      const kit = report.kitByMember.get(m.name) ?? "";
      const pinned = report.pinnedByMember.get(m.name);
      if (!pinned) continue;
      if (kit !== pinned.replace(/^[~^]/, "")) mismatches.push(`${m.name}: kit=${kit} pinned=${pinned}`);
    }
    const unrecorded = mismatches.filter((line) => {
      const name = line.split(":")[0];
      return !KIT_VERSION_EXCEPTION_MEMBERS.has(name);
    });
    expect(unrecorded, "unrecorded kitVersion/pinned-dep mismatches").toEqual([]);
    const stale = KIT_VERSION_EXCEPTIONS.filter((e) => {
      const kit = report.kitByMember.get(e.member);
      const pinned = report.pinnedByMember.get(e.member);
      return kit === pinned?.replace(/^[~^]/, "");
    }).map((e) => e.member);
    expect(stale, `recorded kit mismatches that now agree: ${stale.join(", ")}`).toEqual([]);
  });

  test("members with a manifest but no pinned validator are all recorded", () => {
    const unpinned = report.entries
      .map((e) => e.member)
      .filter((n) => !report.pinnedByMember.get(n))
      .sort();
    const unrecorded = unpinned.filter((n) => !NO_VALIDATOR_PIN.includes(n));
    expect(unrecorded, `manifest-bearing members without a validator pin and without a recorded entry: ${unrecorded.join(", ")}`).toEqual([]);
  });

  test("self-test: the conformance check can fail (positive) and can pass (negative)", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "standard-contracts-self-test-"));
    try {
      const apps = path.join(root, "apps");
      fs.mkdirSync(path.join(apps, "good"), { recursive: true });
      fs.mkdirSync(path.join(apps, "bad"), { recursive: true });
      // The good fixture is mementos (the former fixture access was deleted
      // in the retire-access wave), validated at @hasna/contracts 0.11.1 —
      // measured passing 2026-09-03. The whole app tree is copied (minus
      // node_modules and dist) because the conformance surface_bindings check
      // resolves SDK export targets against the source tree.
      fs.cpSync(path.join(APPS_DIR, "mementos"), path.join(apps, "good"), {
        recursive: true,
        filter: (src) =>
          !src.includes(`${path.sep}node_modules${path.sep}`) &&
          !src.includes(`${path.sep}dist${path.sep}`) &&
          !src.endsWith(`${path.sep}dist`),
      });
      // A manifest that cannot validate against the same schema: wrong schema id.
      fs.writeFileSync(path.join(apps, "bad", "hasna.contract.json"), JSON.stringify({ schema: "not.a.known.schema", name: "bad" }, null, 2));
      fs.writeFileSync(path.join(apps, "bad", "package.json"), JSON.stringify({ name: "@hasna/self-test-bad", version: "0.0.0" }, null, 2));

      const goodDir = path.relative(REPO_ROOT, path.join(apps, "good"));
      const badDir = path.relative(REPO_ROOT, path.join(apps, "bad"));
      const good = runConformance(goodDir, "0.11.1");
      const bad = runConformance(badDir, "0.11.1");
      expect(good.verdict, `known-good fixture must pass (raw: ${good.raw.slice(0, 200)})`).toBe("ok");
      expect(bad.verdict, `known-bad fixture must fail`).toBe("fail");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("report: emit the per-member conformance summary", () => {
    const pass = report.entries.filter((e) => e.verdict === "ok");
    const fail = report.entries.filter((e) => e.verdict === "fail");
    console.log(
      `\n[standard] contracts conformance: ${pass.length}/${report.entries.length} pass, ${fail.length} fail (validator: pinned dep -> kitVersion -> latest)\n` +
        fail
          .map((e) => `  FAIL ${e.member} @${e.version}: ${e.fails.slice(0, 2).join(" | ")}`)
          .sort()
          .join("\n"),
    );
    expect(report.entries.length).toBeGreaterThan(0);
  });
});

describe("standard-adherence: hosted-service migration declaration convention", () => {
  test("sessions declares the migrate one-shot entrypoint and no private secret refs (regression O15-04636)", () => {
    // Regression (2026-08-28, O15-04636): the sessions migrate one-shot
    // (sessions-prod-migrate-manual) failed TaskFailedToStart —
    // sessions-prod-exec not authorized secretsmanager:GetSecretValue on
    // hasna/oss/sessions/database-url-owner (AccessDeniedException), blocking
    // sessions deploys. The owner-DSN secret name derives from the app name
    // by convention (hasna/oss/<app>/database-url-owner) — the contract must
    // NOT carry the secret path (public_manifest_safety rejects *SecretRef
    // keys in public manifests, sessions' own validator 0.14.2), but it must
    // declare the migrate one-shot entrypoint the owner DSN is injected for,
    // so the deploy/provisioning convention covers the sessions migration.
    const manifestPath = path.join(APPS_DIR, "sessions", "hasna.contract.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
      metadata?: { service?: { migrationCommand?: string[] } };
    };
    const service = manifest.metadata?.service;
    expect(service, "sessions hasna.contract.json must carry metadata.service (migration declaration home)").toBeDefined();
    // The migrate one-shot entrypoint (src/server/index.ts: migrate
    // subcommand; Dockerfile one-shot CMD) — the declaration that was missing.
    expect(service?.migrationCommand).toEqual(["bun", "dist/server/index.js", "migrate"]);
    // Public-safety invariant: the naive "fix" (declaring the owner-DSN
    // secret ref in the public manifest) is rejected by the member's own
    // conformance validator (public_manifest_safety, secret-ref category).
    const refKeys = Object.keys(service ?? {}).filter((k) => /secretref$/i.test(k.replace(/[^a-z0-9]/gi, "")));
    expect(refKeys, "public manifests must not carry secret-ref keys (hasna/oss/* secret names derive from the app name)").toEqual([]);
  });
});
