import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

// Regression for O15-04175: the deps layer runs `bun install
// --frozen-lockfile --production`, and the root package's lifecycle scripts
// include `postinstall` ("node postinstall.js"). At that point only
// package.json + bun.lock have been copied into the layer, so the postinstall
// fails on the missing module ("error: Module not found '/app/postinstall.js'",
// "postinstall script from \"@hasna/conversations\" exited with 1") and every
// conversations image build dies at the install layer.
//
// The postinstall is a best-effort host-side convenience: it pre-creates the
// ~/.hasna/conversations data home (and its `training` subdir) that the
// runtime's getDataDir() creates on first use anyway. This image runs with no
// local state at all (Postgres only — see the Dockerfile header), so the
// install line must skip lifecycle scripts, matching the sibling convention in
// apps/economy, apps/hooks and apps/shortlinks.
//
// The structural assertions below are the fast, always-on guard. The real
// proof is the docker build itself: run the suite with RUN_DOCKER_TESTS=1 to
// execute it.

const DOCKERFILE = new URL("../Dockerfile", import.meta.url);

function readDockerfileStages(): Map<string, string[]> {
  const text = readFileSync(DOCKERFILE, "utf8");
  const stages = new Map<string, string[]>();
  let current = "";
  for (const line of text.split(/\r?\n/)) {
    const from = /^FROM\b.*\bAS\s+([A-Za-z0-9_-]+)\s*$/i.exec(line.trim());
    if (from) {
      current = from[1];
      stages.set(current, []);
      continue;
    }
    if (current && /^RUN\b/.test(line.trim())) {
      stages.get(current)!.push(line.trim());
    }
  }
  return stages;
}

function baseStageInstallLine(stages: Map<string, string[]>): string {
  const baseStage = stages.get("base");
  expect(baseStage, "Dockerfile must declare a `base` stage (FROM ... AS base)").toBeDefined();
  const installLine = baseStage!.find((l) => l.includes("bun install"));
  expect(installLine, "base stage must install dependencies with `bun install`").toBeDefined();
  return installLine!;
}

test("deps-layer install does not run the postinstall before postinstall.js is copied (O15-04175)", () => {
  const installLine = baseStageInstallLine(readDockerfileStages());
  // `postinstall` ("node postinstall.js") must not fire during the install,
  // because only package.json + bun.lock are copied into the layer at that
  // point — the module is not present, so the install exits 1 and the image
  // build fails. The postinstall only pre-creates the host data home, which
  // this container does not use.
  expect(installLine).toContain("--ignore-scripts");
});

test("deps-layer install keeps the frozen lockfile discipline", () => {
  const installLine = baseStageInstallLine(readDockerfileStages());
  expect(installLine).toContain("--frozen-lockfile");
});

const runDocker = process.env.RUN_DOCKER_TESTS === "1";

test.skipIf(!runDocker)("full docker image build succeeds", () => {
  const res = spawnSync(
    "docker",
    ["build", "--platform=linux/arm64", "-t", "hasna/conversations:o15-04175-dockerfile-check", "."],
    { cwd: new URL("..", import.meta.url), encoding: "utf8", timeout: 900_000 },
  );
  expect(res.status, res.stdout?.slice(-2000)).toBe(0);
});
