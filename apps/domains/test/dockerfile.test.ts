import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

// Regression for O15-04200: the builder stage runs `bun install
// --frozen-lockfile` (deps layer) and `bun install --frozen-lockfile
// --production` (prune), and the root package's lifecycle scripts include
// `postinstall` ("node postinstall.js"). At the deps layer only package.json
// + bun.lock have been copied in, so the postinstall fails on the missing
// module ("error: Module not found '/app/postinstall.js'", "postinstall
// script from \"@hasna/domains\" exited with 1") and every domains image
// build dies at the install step.
//
// The postinstall is a best-effort host-side convenience: it pre-creates the
// effective domains home directory (resolving the same override/paths logic
// as src/lib/app-home.ts) that the runtime creates on first use anyway. This
// image is PURE REMOTE — cloud Postgres only, no local state (see the
// Dockerfile header) — so both install steps must skip lifecycle scripts,
// matching the sibling convention in apps/conversations (O15-04175),
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

function builderInstallLines(stages: Map<string, string[]>): string[] {
  const builder = stages.get("builder");
  expect(builder, "Dockerfile must declare a `builder` stage (FROM ... AS builder)").toBeDefined();
  const installLines = builder!.filter((l) => l.includes("bun install"));
  expect(installLines.length, "builder stage must install dependencies with `bun install`").toBeGreaterThan(0);
  return installLines;
}

test("builder install steps do not run the postinstall before postinstall.js is copied (O15-04200)", () => {
  const installLines = builderInstallLines(readDockerfileStages());
  // `postinstall` ("node postinstall.js") must not fire during either
  // install, because postinstall.js is not copied into the builder layer
  // until after the first install (and the prune step re-installs from a
  // wiped node_modules). The postinstall only pre-creates the host data
  // home, which this PURE REMOTE container does not use.
  for (const installLine of installLines) {
    expect(installLine, `install line must skip lifecycle scripts: ${installLine}`).toContain("--ignore-scripts");
  }
});

test("builder install steps keep the frozen lockfile discipline", () => {
  const installLines = builderInstallLines(readDockerfileStages());
  for (const installLine of installLines) {
    expect(installLine, `install line must keep the frozen lockfile: ${installLine}`).toContain("--frozen-lockfile");
  }
});

const runDocker = process.env.RUN_DOCKER_TESTS === "1";

test.skipIf(!runDocker)("full docker image build succeeds", () => {
  const res = spawnSync(
    "docker",
    ["build", "--platform=linux/arm64", "-t", "hasna/domains:o15-04200-dockerfile-check", "."],
    { cwd: new URL("..", import.meta.url), encoding: "utf8", timeout: 900_000 },
  );
  expect(res.status, res.stdout?.slice(-2000)).toBe(0);
});
