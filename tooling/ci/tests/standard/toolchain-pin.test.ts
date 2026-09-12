/**
 * toolchain-pin — standard-adherence suite.
 *
 * The repo pins bun (`package.json` `packageManager: bun@1.3.14`; ci.yml
 * `setup-bun` in every job; `tooling/ci/affected-shards.ts` TOOLCHAIN). CI
 * always runs the pin. Stations did not: homebrew bun 1.4.0 shadows the
 * pinned `~/.bun/bin/bun` on PATH, and the census's former
 * `bunx @hasna/contracts@<pin>` path shelled out to it, per member, with
 * `--force --no-cache` (measured 2026-09-11: load 47 on 24 cores, racy
 * "validator could not run" reds). Every spawn in this suite now uses
 * `process.execPath`, so the runner IS the toolchain — and the runner must
 * be the pinned one. A suite run under an unpinned bun measured nothing the
 * repo can act on; refuse it with the remedy instead of passing.
 */
import { describe, expect, test } from "bun:test";
import { TOOLCHAIN } from "../../affected-shards";

describe("standard-adherence: pinned toolchain", () => {
  test(`the suite runs under the pinned bun ${TOOLCHAIN.bun} (process.execPath is the validator's executable)`, () => {
    expect(
      Bun.version,
      `this suite is running under bun ${Bun.version} at ${process.execPath}; the repo pins ${TOOLCHAIN.bun}. Run it with the pinned binary (~/.bun/bin/bun on the stations: \`~/.bun/bin/bun run test:standard\`), never the homebrew one — every validator spawn uses process.execPath, so an unpinned runner validates with an unpinned toolchain.`,
    ).toBe(TOOLCHAIN.bun);
  });
});
