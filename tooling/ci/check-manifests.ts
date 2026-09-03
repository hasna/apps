/**
 * Contract-manifest gate — real validator.
 *
 * Runs the canonical manifest validator (`contracts repo-conformance` from
 * @hasna/contracts) against every publishable member, at the member's
 * effective kit version, using the SAME resolution and invocation as the
 * standard-adherence suite (tooling/ci/tests/standard/contracts.test.ts via
 * ./tests/standard/census). A member is validated by exactly one code path
 * wherever the gate runs.
 *
 * The gate's acceptance is EXACTLY the standard-adherence suite's, so the
 * gates job and test-suites always agree. It refuses (exit 1) when any
 * member is in a state the suite hard-fails on:
 *
 *   - a publishable member with NO hasna.contract.json and no recorded
 *     manifest-missing exception (MANIFEST_MISSING_MEMBERS);
 *   - a manifest-bearing member whose validator could not run
 *     ("cannot-run" — a gate that could not run has cleared nothing);
 *   - a stale recorded exception: a member recorded in
 *     CONTRACTS_EXCEPTION_MEMBERS whose manifest now PASSES (the two-sided
 *     registry contract — an exception entry whose member no longer fails
 *     must be deleted).
 *
 * Unrecorded conformance FAILURES are the suite's auto-filed REPORTING set
 * (the suite passes while filing one reconcile task per violation) — this
 * gate reports them on the same line shape but does not refuse them, so a
 * PR cannot be blocked twice by the same measured violation through two
 * jobs. Recorded exceptions are honored exactly as the suite honors them.
 *
 * The gate carries its own two-sided self-test (--self-test): a conforming
 * fixture must pass and a member without a manifest must be refused, per
 * the prove-it-can-fail discipline — a gate that cannot fire reports a
 * clean tree, and a clean tree is what success looks like.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  REPO_ROOT,
  APPS_DIR,
  membersIn,
  CONTRACTS_EXCEPTION_MEMBERS,
  MANIFEST_MISSING_MEMBERS,
  resolveValidatorVersion,
  runConformance,
} from "./tests/standard/census";

/** Known valid kit versions — identical to the standard suite's report set,
 * so both resolve the same effective validator version. */
const KNOWN_VALIDATOR_VERSIONS = new Set(["0.4.1", "0.4.2", "0.5.2", "0.8.1", "0.8.2", "0.8.4", "0.8.5", "0.9.0", "0.10.6", "0.13.1"]);

export interface ManifestGateEntry {
  member: string;
  version: string;
  status: "ok" | "missing" | "fail" | "cannot-run";
  detail: string[];
}

export function buildGateEntries(appsDir: string = APPS_DIR): ManifestGateEntry[] {
  const entries: ManifestGateEntry[] = [];
  for (const m of membersIn(appsDir)) {
    if (!m.publishable) continue;
    if (!m.hasManifest) {
      entries.push({ member: m.name, version: "", status: "missing", detail: ["no hasna.contract.json"] });
      continue;
    }
    const manifest = JSON.parse(fs.readFileSync(path.join(appsDir, m.name, "hasna.contract.json"), "utf8")) as {
      kitVersion?: string;
    };
    const version = resolveValidatorVersion(m.contractsDep, manifest.kitVersion, KNOWN_VALIDATOR_VERSIONS);
    const { verdict, fails } = runConformance(path.relative(REPO_ROOT, path.join(appsDir, m.name)), version);
    entries.push({
      member: m.name,
      version,
      status: verdict === "ok" ? "ok" : verdict === "cannot-run" ? "cannot-run" : "fail",
      detail: fails,
    });
  }
  return entries;
}

/** Pure classification — the refuse reasons for a set of entries. Kept
 * separate from I/O so the self-test can prove both directions cheaply. */
export function refuseReasons(entries: ManifestGateEntry[]): string[] {
  const reasons: string[] = [];
  for (const e of entries) {
    if (e.status === "missing") {
      if (!MANIFEST_MISSING_MEMBERS.has(e.member)) {
        reasons.push(`${e.member}: no hasna.contract.json and no recorded manifest-missing exception`);
      }
    } else if (e.status === "cannot-run") {
      reasons.push(`${e.member}: validator could not run (${e.detail[0] ?? "no verdict"})`);
    } else if (e.status === "fail") {
      // unrecorded conformance failures are the suite's auto-filed REPORTING
      // set — reported, never refused here (see the header).
      void e;
    } else if (e.status === "ok" && CONTRACTS_EXCEPTION_MEMBERS.has(e.member)) {
      reasons.push(`${e.member}: recorded conformance exception is stale — the manifest now passes; delete the CONTRACTS_EXCEPTIONS entry`);
    }
  }
  return reasons;
}

function runSelfTest(): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "check-manifests-self-test-"));
  try {
    const apps = path.join(root, "apps");
    // Negative arm (must stay silent): a conforming member. apps/mementos is
    // the same known-good fixture the standard suite's own self-test uses —
    // validated at @hasna/contracts 0.11.1 (measured 2026-09-03; the former
    // fixture apps/access was deleted in the retire-access wave).
    fs.mkdirSync(path.join(apps, "good"), { recursive: true });
    fs.cpSync(path.join(APPS_DIR, "mementos"), path.join(apps, "good"), {
      recursive: true,
      filter: (src) =>
        !src.includes(`${path.sep}node_modules${path.sep}`) &&
        !src.includes(`${path.sep}dist${path.sep}`) &&
        !src.endsWith(`${path.sep}dist`),
    });
    // Positive arm (must fire): a publishable member with no manifest.
    fs.mkdirSync(path.join(apps, "bad"), { recursive: true });
    fs.writeFileSync(path.join(apps, "bad", "package.json"), JSON.stringify({ name: "@hasna/self-test-bad", version: "0.0.0" }, null, 2));

    const entries = buildGateEntries(apps);
    const good = entries.find((e) => e.member === "good");
    const bad = entries.find((e) => e.member === "bad");
    if (!good || good.status !== "ok") {
      throw new Error(`self-test negative arm failed: good fixture expected ok, got ${good?.status ?? "missing"} ${good?.detail.slice(0, 2).join(" | ") ?? ""}`);
    }
    if (!bad || refuseReasons([bad]).length === 0) {
      throw new Error("self-test positive arm failed: member without a manifest must be refused");
    }
    // Stale-exception arm: a RECORDED exception whose member now passes must
    // be refused (two-sided registry contract, same as the suite).
    const staleEntry: ManifestGateEntry = { member: [...CONTRACTS_EXCEPTION_MEMBERS][0] ?? "none", version: "0.11.1", status: "ok", detail: [] };
    if (CONTRACTS_EXCEPTION_MEMBERS.size > 0 && refuseReasons([staleEntry]).length === 0) {
      throw new Error("self-test stale-exception arm failed: a recorded exception whose member passes must be refused");
    }
    console.log("self-test ok: gate stays silent on a conforming member, refuses a member without a manifest, and refuses a stale recorded exception.");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function main(): void {
  if (process.argv.includes("--self-test")) {
    runSelfTest();
    process.exit(0);
  }
  const entries = buildGateEntries();
  let pass = 0;
  for (const e of entries) {
    if (e.status === "ok") {
      pass += 1;
      console.log(`ok @hasna/${e.member} (validator ${e.version})`);
    } else if (e.status === "missing") {
      const recorded = MANIFEST_MISSING_MEMBERS.has(e.member);
      console.log(`${recorded ? "ok (recorded exception)" : "FAIL"} @hasna/${e.member}: no hasna.contract.json${recorded ? "" : " — no recorded manifest-missing exception"}`);
    } else if (e.status === "cannot-run") {
      console.log(`FAIL @hasna/${e.member}: validator could not run at ${e.version} — ${e.detail[0] ?? "no verdict"}`);
    } else {
      const recorded = CONTRACTS_EXCEPTION_MEMBERS.has(e.member);
      // recorded exceptions are pass; unrecorded failures are the suite's
      // auto-filed reporting set — reported, not refused (acceptance parity
      // with test-suites).
      console.log(`${recorded ? "ok (recorded exception)" : "report (auto-filed by test:standard)"} @hasna/${e.member} (validator ${e.version}): ${e.detail.slice(0, 2).join(" | ") || "conformance fail"}`);
      if (recorded) pass += 1;
    }
  }
  const reasons = refuseReasons(entries);
  console.log(`[check-manifests] ${pass}/${entries.length} publishable members conform (${entries.length - pass} recorded exceptions); ${reasons.length} refusal(s)`);
  for (const r of reasons) console.log(`  REFUSE ${r}`);
  process.exit(reasons.length > 0 ? 1 : 0);
}

main();
