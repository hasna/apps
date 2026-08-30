// Regression suite for `testers repo prepare` exit-code contract (PLA16-00071).
//
// Defect (QA row 73766b01): `testers repo prepare` exited rc=0 while printing
// "Not ready. Run with flags:" — the command reported failure in prose but a
// success exit code, so callers (e.g. the qa-testers-socializer lane) that gate
// on $? believed the repo was prepared. The same silent-0 applied when a prep
// step ran but failed ("Some steps failed. Fix the issues above and retry.").
//
// Contract under test: any path that prints "Not ready" or "Some steps failed"
// MUST exit non-zero.

import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "bun";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = ["bun", "run", "src/cli/index.tsx", "--no-color"];

function makeRepo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "prep-rc-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    const mkdir = (p: string) => require("node:fs").mkdirSync(p, { recursive: true });
    const segments = rel.split("/");
    if (segments.length > 1) mkdir(join(dir, ...segments.slice(0, -1)));
    writeFileSync(full, content, "utf-8");
  }
  return dir;
}

function runPrepare(repo: string, args: string[] = []) {
  const testersDir = mkdtempSync(join(tmpdir(), "prep-rc-td-"));
  const home = mkdtempSync(join(tmpdir(), "prep-rc-home-"));
  try {
    return spawnSync({
      cmd: [...CLI, "repo", "prepare", repo, ...args],
      env: {
        ...process.env,
        HASNA_TESTERS_DIR: testersDir,
        HOME: home,
        delete: undefined,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
  } finally {
    rmSync(testersDir, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
}

describe("testers repo prepare exit codes", () => {
  afterEach(() => {
    // nothing global to clean; temp dirs are removed inside runPrepare
  });

  test("not-ready repo: prints 'Not ready' and exits non-zero", () => {
    const repo = makeRepo({ "package.json": JSON.stringify({ name: "fixture", version: "1.0.0" }) });
    try {
      const proc = runPrepare(repo);
      expect(proc.stdout.toString()).toContain("Not ready");
      expect(proc.exitCode).not.toBe(0);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test("failed prep step: prints 'Some steps failed' and exits non-zero", () => {
    // `seed` script exits 1; force bun as the package manager so the step
    // command is `bun run seed` (bun is guaranteed present — it runs this test).
    const repo = makeRepo({
      "package.json": JSON.stringify({
        name: "fixture",
        version: "1.0.0",
        scripts: { seed: "exit 1" },
      }),
      "bun.lock": "",
    });
    try {
      const proc = runPrepare(repo, ["--seed"]);
      expect(proc.stdout.toString()).toContain("Some steps failed");
      expect(proc.exitCode).not.toBe(0);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
