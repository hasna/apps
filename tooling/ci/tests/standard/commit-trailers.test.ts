/**
 * commit-trailers — standard-adherence suite hook for the commit-trailer
 * gate (tooling/ci/check-commit-trailers.ts, repo law 6). The range check
 * itself runs in the ci.yml gates job (it needs the PR base); this test
 * pins the gate's two-sided self-test so the predicate cannot rot.
 */
import { describe, expect, test } from "bun:test";
import { REPO_ROOT } from "./census";

describe("standard-adherence: commit trailers (repo law 6)", () => {
  test("self-test: the commit-trailer gate can fire and stay silent", () => {
    const res = Bun.spawnSync([process.execPath, `${REPO_ROOT}/tooling/ci/check-commit-trailers.ts`, "--self-test"], { stdout: "pipe", stderr: "pipe" });
    const out = `${res.stdout.toString()}\n${res.stderr.toString()}`;
    expect(res.exitCode, out).toBe(0);
    expect(out).toContain("self-test: PASS");
  }, 60_000);
});
