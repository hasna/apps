import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

// Regression for I38-00554: the deps half of the build stage runs
// `bun install`, and the root package's lifecycle scripts include `prepare`
// ("bun run build"). At that point only package.json + bun.lock have been
// copied into the stage, so the prepare build fails on the missing src/.
// The install line must therefore skip lifecycle scripts; the build itself
// runs explicitly later in the same stage, where src/ exists.
//
// The structural assertions below are the fast, always-on guard. The real
// proof is the docker build itself: run the suite with RUN_DOCKER_TESTS=1
// (or `bun run docker:check`) to execute it.

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

function buildStageInstallLine(stages: Map<string, string[]>): string {
  const buildStage = stages.get("build");
  expect(buildStage, "Dockerfile must declare a `build` stage (FROM ... AS build)").toBeDefined();
  const installLine = buildStage!.find((l) => l.includes("bun install"));
  expect(installLine, "build stage must install dependencies with `bun install`").toBeDefined();
  return installLine!;
}

test("deps-stage install does not run the prepare build before src/ exists (I38-00554)", () => {
  const installLine = buildStageInstallLine(readDockerfileStages());
  // `prepare` ("bun run build") must not fire during the deps-stage install,
  // because src/ is only copied into the stage afterwards.
  expect(installLine).toContain("--ignore-scripts");
});

test("deps-stage install keeps the frozen lockfile discipline", () => {
  const installLine = buildStageInstallLine(readDockerfileStages());
  expect(installLine).toContain("--frozen-lockfile");
});

test("build stage still runs the build explicitly after install", () => {
  const buildStage = readDockerfileStages().get("build")!;
  const buildLine = buildStage.find((l) => l.includes("bun run build"));
  expect(buildLine, "build stage must invoke `bun run build` after src/ is copied").toBeDefined();
  // The skip is the fix, never a removal of the build itself.
  expect(buildLine).not.toContain("--ignore-scripts");
});

const runDocker = process.env.RUN_DOCKER_TESTS === "1";

test.skipIf(!runDocker)("full docker image build succeeds (--target runtime)", () => {
  const res = spawnSync(
    "docker",
    ["build", "--platform=linux/arm64", "--target", "runtime", "-t", "hasna/machines:i38-dockerfile-check", "."],
    { cwd: new URL("..", import.meta.url), encoding: "utf8", timeout: 900_000 },
  );
  expect(res.status, res.stdout?.slice(-2000)).toBe(0);
});
