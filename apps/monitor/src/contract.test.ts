/**
 * Tests for the repo's @hasna/contracts alignment — the manifest shape, the bin
 * allowlist, and the published-artifact gate wiring.
 *
 * These exist because nothing else in the suite reads hasna.contract.json, so a
 * manifest that only resembled a service contract, and a prepack that aborted
 * every `npm pack`, both shipped through a green board.
 */

import { describe, it, expect } from "bun:test";
import { spawnSync } from "child_process";
import { readFileSync } from "fs";
import { join } from "path";

import {
  baselineFailures,
  conformanceBaselineIssues,
  parseConformanceReport,
} from "../scripts/contract-baseline";
import {
  artifactGateIssues,
  binAllowlistIssues,
  contractsInvocations,
  contractsPinIssues,
  daemonSurfaceIssues,
  manifestShapeIssues,
  reachableScripts,
  readManifest,
  readPackageJson,
  REPO_ROOT,
  sdkSurfaceIssues,
  storageBackendIssues,
  undocumentedBinIssues,
} from "../scripts/contract-gate";

const manifest = readManifest();
const pkg = readPackageJson();

// ── Manifest shape ────────────────────────────────────────────────────────────

describe("hasna.contract.json", () => {
  it("declares the hasna.service_contract.v1 shape with no invented keys", () => {
    expect(manifestShapeIssues(manifest)).toEqual([]);
  });

  it("declares only bins the contract allowlists", () => {
    expect(binAllowlistIssues(manifest)).toEqual([]);
  });

  it("accounts for every bin package.json ships, declared or recorded as pending", () => {
    expect(undocumentedBinIssues(manifest, pkg)).toEqual([]);
  });

  it("names the app after the storage envPrefix it actually reads", () => {
    const storage = manifest["storage"] as Record<string, unknown>;
    expect(storage["envPrefix"]).toBe(`HASNA_${String(manifest["name"]).toUpperCase()}_`);
    expect(String(storage["sqlitePath"])).toEndWith(".db");
  });
});

// ── Release gate wiring ───────────────────────────────────────────────────────

describe("published-artifact gate", () => {
  it("declares a scan script that exists and is reachable from prepack", () => {
    expect(artifactGateIssues(manifest, pkg)).toEqual([]);
  });

  it("pins every @hasna/contracts invocation to the manifest kitVersion", () => {
    expect(contractsPinIssues(manifest, pkg)).toEqual([]);
  });

  it("invokes the contracts CLI at least once, so the pin check has something to check", () => {
    expect(contractsInvocations(pkg).length).toBeGreaterThan(0);
  });
});

describe("reachableScripts", () => {
  it("follows bun run chains and pre/post hooks", () => {
    const scripts = {
      prepack: "bun run scan:artifact",
      "scan:artifact": "bun scripts/scan-artifact.ts",
      prescan: "echo unrelated",
      preprepack: "echo hook",
    };
    const reached = reachableScripts(scripts, "prepack");
    expect([...reached].sort()).toEqual(["prepack", "preprepack", "scan:artifact"]);
  });

  it("does not reach a script nobody calls", () => {
    const reached = reachableScripts({ prepack: "echo hi", orphan: "echo no" }, "prepack");
    expect(reached.has("orphan")).toBe(false);
  });
});

// ── The authoritative conformance check has to stay pinned ────────────────────

/**
 * A trimmed `repo-conformance` report. The failing line is copied verbatim from
 * the live output, so the fixture and the manifest baseline cannot drift apart
 * without one of these tests failing.
 */
const CONFORMANCE_REPORT = [
  "fail hasna.service_contract.v1 monitor (cli-with-store) .",
  "  pass manifest_valid: hasna.contract.json valid for monitor (cli-with-store)",
  "  pass bins_allowlisted: bins allowlisted: monitor, monitor-mcp, monitor-daemon",
  "  fail bins_match_package: in package.json but undeclared: monitor-serve, monitor-server",
  "  pass surface_matrix: API, SDK, MCP, and CLI are declared or explicitly waived",
  "  pass surface_bindings: declared surface bins and SDK exports match package.json",
  "  pass storage_capabilities: sqlite declared; postgresql explicitly waived",
  "  skip health_shape: no serve bin declared",
  "",
].join("\n");

describe("parseConformanceReport", () => {
  it("reads the status, check, and detail of every verdict line", () => {
    expect(parseConformanceReport(CONFORMANCE_REPORT)).toEqual([
      {
        status: "pass",
        check: "manifest_valid",
        detail: "hasna.contract.json valid for monitor (cli-with-store)",
      },
      {
        status: "pass",
        check: "bins_allowlisted",
        detail: "bins allowlisted: monitor, monitor-mcp, monitor-daemon",
      },
      {
        status: "fail",
        check: "bins_match_package",
        detail: "in package.json but undeclared: monitor-serve, monitor-server",
      },
      {
        status: "pass",
        check: "surface_matrix",
        detail: "API, SDK, MCP, and CLI are declared or explicitly waived",
      },
      {
        status: "pass",
        check: "surface_bindings",
        detail: "declared surface bins and SDK exports match package.json",
      },
      {
        status: "pass",
        check: "storage_capabilities",
        detail: "sqlite declared; postgresql explicitly waived",
      },
      { status: "skip", check: "health_shape", detail: "no serve bin declared" },
    ]);
  });

  it("ignores the unindented summary line and surrounding noise", () => {
    const checks = parseConformanceReport("$ bunx @hasna/contracts repo-conformance .\nfail whatever monitor .\n");
    expect(checks).toEqual([]);
  });
});

describe("conformanceBaselineIssues", () => {
  it("accepts a report whose only failure is the one the manifest baselines", () => {
    expect(conformanceBaselineIssues(manifest, CONFORMANCE_REPORT)).toEqual([]);
  });

  it("records the accepted failure in the manifest, so the deferral is not implicit", () => {
    expect(baselineFailures(manifest)).toEqual([
      { check: "bins_match_package", detail: "in package.json but undeclared: monitor-serve, monitor-server" },
    ]);
  });

  it("rejects a failing check the baseline does not accept", () => {
    const report = `${CONFORMANCE_REPORT}  fail storage_capabilities: postgres undeclared\n`;
    expect(conformanceBaselineIssues(manifest, report)).toEqual([
      'conformance check "storage_capabilities" fails and no baseline accepts it: postgres undeclared',
    ]);
  });

  it("rejects a baselined failure whose detail drifted", () => {
    const report = CONFORMANCE_REPORT.replace("undeclared: monitor-serve, monitor-server", "undeclared: monitor-serve, monitor-server, monitor-new");
    expect(conformanceBaselineIssues(manifest, report)).toEqual([
      'conformance check "bins_match_package" now reports "in package.json but undeclared: monitor-serve, monitor-server, monitor-new", but the baseline pins "in package.json but undeclared: monitor-serve, monitor-server"',
    ]);
  });

  it("rejects a baseline entry whose check has started passing", () => {
    const report = CONFORMANCE_REPORT.replace("  fail bins_match_package:", "  pass bins_match_package:");
    expect(conformanceBaselineIssues(manifest, report)).toEqual([
      'baseline accepts "bins_match_package" as failing, but it now passes; drop the baseline entry',
    ]);
  });

  it("rejects output with no verdict lines instead of passing vacuously", () => {
    expect(conformanceBaselineIssues(manifest, "error: could not resolve @hasna/contracts")).toEqual([
      "no conformance check lines found in the repo-conformance output; the gate cannot verify anything",
    ]);
  });
});

// ── CI has to actually run the gates ──────────────────────────────────────────

describe("ci workflow", () => {
  const workflow = readFileSync(join(REPO_ROOT, ".github/workflows/ci.yml"), "utf8");

  it("runs the conformance baseline, so the authority is exercised in CI", () => {
    expect(workflow).toContain("bun run contract-baseline");
  });

  it("runs every gate before the suite, so one red test cannot skip them all", () => {
    const testStep = workflow.indexOf("run: bun test");
    expect(testStep).toBeGreaterThan(0);
    for (const gate of ["bun run contract-gate", "bun run contract-baseline", "npm pack --dry-run"]) {
      const gateStep = workflow.indexOf(gate);
      expect(gateStep).toBeGreaterThan(0);
      expect(gateStep).toBeLessThan(testStep);
    }
  });
});

// ── MON-V2-14 contract conformance: kit pin, storage shape, daemon bin, ./sdk ──

describe("MON-V2-14 contracts conformance", () => {
  it("pins one selected published Contracts kit version (0.11.1) in manifest and scripts", () => {
    expect(manifest["kitVersion"]).toBe("0.11.1");
    for (const invocation of contractsInvocations(pkg)) {
      expect(invocation.version).toBe("0.11.1");
    }
  });

  it("declares the current storage shape: backend, engines, envPrefix, sqlitePath", () => {
    const storage = manifest["storage"] as Record<string, unknown>;
    expect(storage["backend"]).toBe("sqlite");
    expect(storage["mode"]).toBeUndefined();
    expect(storage["engines"]).toEqual(["sqlite"]);
    expect(storage["envPrefix"]).toBe("HASNA_MONITOR_");
    expect(storage["sqlitePath"]).toBe("~/.hasna/monitor/monitor.db");
  });

  it("waives the waivable postgresql engine, never the retired postgres value", () => {
    const metadata = manifest["metadata"] as Record<string, unknown>;
    const conformance = metadata["conformance"] as Record<string, unknown>;
    const waivers = conformance["waivedStorageEngines"] as { engine: string }[];
    expect(waivers.map((waiver) => waiver.engine)).toEqual(["postgresql"]);
  });

  it("declares the daemon bin end to end: manifest bin, supported surface, package bin, real entry", () => {
    expect((manifest["bins"] as string[]).includes("monitor-daemon")).toBe(true);
    const surfaces = manifest["serviceSurfaces"] as {
      bin?: string;
      kind: string;
      status: string;
    }[];
    expect(
      surfaces.some(
        (surface) => surface.bin === "monitor-daemon" && surface.kind === "cli" && surface.status === "supported",
      ),
    ).toBe(true);
    expect(Object.keys(pkg.bin ?? {})).toContain("monitor-daemon");
    expect(daemonSurfaceIssues(manifest, pkg)).toEqual([]);
  });

  it("supports the SDK through a real ./sdk export", () => {
    const surfaces = manifest["serviceSurfaces"] as {
      kind: string;
      status: string;
      exportSubpath?: string;
    }[];
    const sdk = surfaces.find((surface) => surface.kind === "sdk");
    expect(sdk?.status).toBe("supported");
    expect(sdk?.exportSubpath).toBe("./sdk");
    expect(sdkSurfaceIssues(manifest, pkg)).toEqual([]);
  });

  it("keeps the conformance baseline to exactly the pending undeclared bins", () => {
    expect(baselineFailures(manifest)).toEqual([
      { check: "bins_match_package", detail: "in package.json but undeclared: monitor-serve, monitor-server" },
    ]);
  });

  it("accepts the new storage shape in the offline gate", () => {
    expect(storageBackendIssues(manifest)).toEqual([]);
  });
});

// ── The gate has to leave the package packable ────────────────────────────────

describe("packing", () => {
  it("packs cleanly with prepack wired, so releases are not blocked", () => {
    const result = spawnSync("bun", ["pm", "pack", "--dry-run"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      timeout: 120_000,
    });
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    expect(output).not.toContain('script "prepack" exited with code');
    expect(result.status).toBe(0);
  }, 120_000);
});
