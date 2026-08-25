import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

// Regression for O15-00677: the deps stage runs `bun install`, and the root
// package's lifecycle scripts include `prepare` ("bun run build:js"). At that
// point only package.json + bun.lock + bunfig.toml have been copied into the
// stage, so the prepare build fails on the missing src/ (FileNotFound opening
// root directory "./src/"), which blocks every skills docker deploy at the
// BUILD gate. The deps-stage install must therefore skip lifecycle scripts;
// the build itself runs explicitly later in the build stage, where src/ exists.
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

function depsStageInstallLine(stages: Map<string, string[]>): string {
  const depsStage = stages.get("deps");
  expect(depsStage, "Dockerfile must declare a `deps` stage (FROM ... AS deps)").toBeDefined();
  const installLine = depsStage!.find((l) => l.includes("bun install"));
  expect(installLine, "deps stage must install dependencies with `bun install`").toBeDefined();
  return installLine!;
}

test("deps-stage install does not run the prepare build before src/ exists (O15-00677)", () => {
  const installLine = depsStageInstallLine(readDockerfileStages());
  // `prepare` ("bun run build:js") must not fire during the deps-stage install,
  // because src/ is only copied into the stage afterwards.
  expect(installLine).toContain("--ignore-scripts");
});

test("deps-stage install keeps the frozen lockfile discipline", () => {
  const installLine = depsStageInstallLine(readDockerfileStages());
  expect(installLine).toContain("--frozen-lockfile");
});

test("build stage still runs the build explicitly after src/ is copied", () => {
  const buildStage = readDockerfileStages().get("build")!;
  expect(buildStage, "Dockerfile must declare a `build` stage (FROM ... AS build)").toBeDefined();
  const buildLine = buildStage.find((l) => l.includes("bun run build"));
  expect(buildLine, "build stage must invoke `bun run build` after src/ is copied").toBeDefined();
  // The skip is the fix, never a removal of the build itself.
  expect(buildLine).not.toContain("--ignore-scripts");
});

const runDocker = process.env.RUN_DOCKER_TESTS === "1";

test.skipIf(!runDocker)("full docker image build succeeds (--target runtime)", () => {
  const result = spawnSync(
    "docker",
    ["build", "--platform=linux/arm64", "--target", "runtime", "-t", "hasna/skills:docker-check", "."],
    { cwd: new URL("..", import.meta.url).pathname, stdio: "inherit", timeout: 600_000 },
  );
  expect(result.status).toBe(0);
});
