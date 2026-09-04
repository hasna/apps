/**
 * Wave-app Docker deps-stage frozen installs — regression suite for O15-00731.
 *
 * Every Docker deploy lane for these members installs the app's package.json
 * together with the app's OWN `bun.lock` (the lane copies both into the
 * image and runs `bun install --frozen-lockfile`), so a lockfile that does
 * not resolve the manifest's pins breaks the lane with `error: lockfile had
 * changes, but lockfile is frozen` at the deps stage.
 *
 * Measured defect (O15-00731, deploy pass 9, 2026-08-25): Version Packages
 * #1168 bumped these members' @hasna/contracts pins to 0.14.1 while their
 * per-app lockfiles still resolved 0.14.0; the wave never regenerated the
 * per-app lockfiles. The O15-00725 repin (b2e8c28ad) returned the manifests
 * to the published 0.14.0, but the lockfiles still carry resolution drift
 * the structural gate (check-frozen-locks.ts RULE 2 compares the lockfile's
 * root workspace `dependencies` only) does not see: apps/loops records
 * `@hasna/machines@0.2.35` in `optionalDependencies` while its manifest
 * pins 0.2.36, and bun's own frozen check DOES fire on that surface
 * (`error: lockfile had changes, but lockfile is frozen`, measured on bun
 * 1.3.14 in the exact Docker deps shape).
 *
 * This suite stages the EXACT Docker deps-stage shape per member — the
 * manifest + lockfile (+ any sub-workspace manifests the Dockerfile COPYs,
 * per member's own Dockerfile) — into a directory with no workspace parent
 * and runs the lane's frozen install as a dry-run, asserting rc=0. That is
 * the acceptance the deploy lane enforces, reproduced here so the class
 * cannot regress without a failing suite.
 *
 * The five members are the remaining pass-9 deploy block named by O15-00731
 * (sessions retired from the public tree with the removal wave; its deploy
 * lane moved to hasna-internal with the member).
 * Deliberately scoped: this suite asserts the deploy-lane contract for
 * exactly these members; a member added to the deploy set extends this
 * list in the change that adds it.
 */
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

const REPO_ROOT = path.resolve(import.meta.dir, "../../../..");

/** Members whose Docker deps stage runs `bun install --frozen-lockfile`. */
const WAVE_APPS = ["loops", "messages", "projects", "recordings", "todos"];

/** Sub-workspace manifests the member's own Dockerfile COPYs into the image. */
const SUB_WORKSPACES: Record<string, string[]> = {
  todos: ["dashboard", "ai"],
};

function stageMember(app: string, dest: string): void {
  const srcDir = path.join(REPO_ROOT, "apps", app);
  fs.mkdirSync(dest, { recursive: true });
  fs.copyFileSync(path.join(srcDir, "package.json"), path.join(dest, "package.json"));
  const lock = path.join(srcDir, "bun.lock");
  if (!fs.existsSync(lock)) {
    throw new Error(`${app}: Docker deps stage COPYs bun.lock but apps/${app}/bun.lock does not exist`);
  }
  fs.copyFileSync(lock, path.join(dest, "bun.lock"));
  for (const sub of SUB_WORKSPACES[app] ?? []) {
    const subPkg = path.join(srcDir, sub, "package.json");
    if (!fs.existsSync(subPkg)) {
      throw new Error(`${app}: manifest declares workspace "${sub}" but apps/${app}/${sub}/package.json does not exist`);
    }
    fs.mkdirSync(path.join(dest, sub), { recursive: true });
    fs.copyFileSync(subPkg, path.join(dest, sub, "package.json"));
  }
}

describe("wave-app Docker deps-stage frozen installs (O15-00731)", () => {
  for (const app of WAVE_APPS) {
    test(`${app}: bun install --frozen-lockfile passes in the Docker deps shape`, () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), `wave-frozen-${app}-`));
      try {
        stageMember(app, dir);
        const result = spawnSync("bun", ["install", "--frozen-lockfile", "--ignore-scripts", "--dry-run"], {
          cwd: dir,
          encoding: "utf8",
          timeout: 120_000,
        });
        const stderr = result.stderr ?? "";
        expect(result.status, `${app} frozen install stderr:\n${stderr}`).toBe(0);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  }
});
