// Consumer-conformance sdk-local hermeticity — regression for the wave #673
// publish-guard failure.
//
// The machines consumer bundle externalizes @hasna/contracts (so the
// install-time workspace build never reads a mid-build contracts dist), which
// makes dist/consumer.js import '@hasna/contracts/client' at runtime. The
// conformance script's sdk-local case builds a hermetic temp app holding ONLY
// @hasna/machines (dependencies excluded), so on a machine with no ambient
// parent-dir node_modules the import cannot resolve and the case fails with:
//
//   error: Cannot find module '@hasna/contracts/client' from
//   '.../node_modules/@hasna/machines/dist/consumer.js'
//
// That failure reproduced 3 of 3 on clean GitHub runners while every local
// run passed, because this box's /tmp/node_modules carries an unrelated
// @hasna/contracts that parent-dir resolution walked up to — the exact
// ambient-pollution hazard the conformance script's own hermeticity comment
// names. A real downstream app always installs @hasna/contracts (it is a hard
// dependency of @hasna/machines), so the sdk-local fixture must provide it.
//
// The sandbox below lives OUTSIDE os.tmpdir() so the test fails on a polluted
// box exactly as a clean runner does, and passes once the fixture ships the
// declared dependency.
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const pkgDir = resolve(import.meta.dir, "..");
const conformanceScript = join(pkgDir, "scripts", "consumer-conformance.mjs");

describe("consumer-conformance sdk-local hermeticity", () => {
  test("sdk-local resolves the consumer bundle's declared @hasna/contracts dependency without ambient node_modules", () => {
    expect(existsSync(join(pkgDir, "dist", "consumer.js"))).toBe(true);
    // Node module resolution walks UP from the temp app, so a sandbox under
    // os.tmpdir() can still be satisfied by a polluted parent (the exact
    // reason this defect was invisible locally). Use a fresh directory under
    // the home dir; the test removes it on the way out.
    const sandbox = mkdtempSync(join(homedir(), ".machines-conformance-sandbox-"));
    try {
      const result = spawnSync("bun", [conformanceScript, "--json"], {
        cwd: pkgDir,
        encoding: "utf8",
        env: { ...process.env, TMPDIR: sandbox },
        timeout: 120_000,
      });
      expect(result.status).toBe(0);
      expect(result.stderr).not.toMatch(/Cannot find module ['"]@hasna\/contracts/);
      const summary = JSON.parse(result.stdout) as {
        cases: Array<{ name: string; ok: boolean }>;
      };
      const sdkLocal = summary.cases.find((entry) => entry.name === "sdk-local");
      expect(sdkLocal).toBeDefined();
      expect(sdkLocal?.ok).toBe(true);
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });
});
