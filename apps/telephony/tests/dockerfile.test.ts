import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import packageJson from "../package.json";

const root = join(import.meta.dir, "..");

describe("server image build stage", () => {
  test("skips lifecycle scripts the install layer cannot run (O15-04633)", () => {
    const dockerfile = readFileSync(join(root, "Dockerfile"), "utf8");

    // The manifest declares a postinstall that only pre-creates the host data
    // home (best-effort; the runtime recreates the same directories on first
    // use). It exists for local installs, not for the container image.
    expect(packageJson.scripts?.postinstall).toBe("node postinstall.mjs");

    // The build stage installs deps from package.json + lockfile BEFORE the
    // rest of the tree is copied, so postinstall.mjs is not in /app when
    // `bun install` runs. A plain install therefore fails the build with
    // 'Module not found /app/postinstall.mjs' (measured on deploy pass 16,
    // 2026-08-28). The image is PURE REMOTE (no local state), so the install
    // must skip lifecycle scripts — same as the domains Dockerfile fix
    // (O15-04208, de1c531e0).
    const installRuns = dockerfile
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /^RUN\s+bun install(\s|$)/.test(line));
    expect(installRuns.length).toBeGreaterThan(0);
    for (const run of installRuns) {
      expect(run, `expected --ignore-scripts in: ${run}`).toContain("--ignore-scripts");
    }
  });
});
