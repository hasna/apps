import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { useDefaultTestTimeout } from "../test-preload.js";
useDefaultTestTimeout();

test("externally bundled runtime supervisor imports without application dependencies", async () => {
  const dir = mkdtempSync(join(tmpdir(), "skills-runtime-startup-"));
  try {
    const build = Bun.spawn([
      process.execPath, "build", join(import.meta.dir, "runtime-worker.ts"),
      "--target", "bun", "--packages", "external", "--outdir", dir,
    ], { stdout: "pipe", stderr: "pipe" });
    const [built, buildError] = await Promise.all([
      build.exited, new Response(build.stderr).text(),
    ]);
    expect(built, buildError).toBe(0);
    const child = Bun.spawn([
      process.execPath,
      "--no-install",
      "-e",
      `const runtime = await import(${JSON.stringify(join(dir, "runtime-worker.js"))}); if (typeof runtime.executeRuntimeWork !== "function" || typeof runtime.runRuntimeWorker !== "function") process.exit(1);`,
    ], {
      cwd: dir,
      env: { PATH: process.env.PATH!, HOME: dir, TMPDIR: dir },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, stderr] = await Promise.all([
      child.exited,
      new Response(child.stderr).text(),
    ]);
    expect(exitCode, stderr).toBe(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
