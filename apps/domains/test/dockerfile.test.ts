import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

// Regression for O15-04208: both builder-stage installs run `bun install
// --frozen-lockfile` (the second as `--production`), and the root package's
// lifecycle scripts include `postinstall` ("node postinstall.js"). At that
// point only package.json + bun.lock (and later tsconfig/src/scripts) have
// been copied into the layer — postinstall.js lives at the package root and is
// never copied — so the postinstall fails on the missing module
// ("error: Module not found '/app/postinstall.js'") and every domains image
// build dies at the install layer.
//
// The postinstall is a best-effort host-side convenience: it pre-creates the
// domains data home that the runtime's app-home resolution (src/lib/app-home.ts)
// creates on first use anyway. This image is Postgres-only, no local state
// (see the Dockerfile header), so the install lines must skip lifecycle
// scripts, matching the sibling convention in apps/conversations (O15-04175),
// apps/economy, apps/hooks, apps/mementos and apps/skills.
//
// The structural assertions below are the fast, always-on guard. The real
// proof is the docker build itself: run the suite with RUN_DOCKER_TESTS=1 to
// execute it.

const DOCKERFILE = new URL("../Dockerfile", import.meta.url);

function builderInstallLines(): string[] {
  const text = readFileSync(DOCKERFILE, "utf8");
  const lines: string[] = [];
  let inBuilder = false;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    const from = /^FROM\b.*\bAS\s+([A-Za-z0-9_-]+)\s*$/i.exec(trimmed);
    if (from) {
      inBuilder = from[1] === "builder";
      continue;
    }
    if (inBuilder && /^RUN\b/.test(trimmed) && trimmed.includes("bun install")) {
      lines.push(trimmed);
    }
  }
  return lines;
}

test("builder-stage installs do not run the postinstall before postinstall.js is copied (O15-04208)", () => {
  const installLines = builderInstallLines();
  expect(installLines.length, "builder stage must install dependencies with `bun install`").toBeGreaterThan(0);
  for (const installLine of installLines) {
    // `postinstall` ("node postinstall.js") must not fire during the install,
    // because postinstall.js is not copied into the layer at that point — the
    // module is not present, so the install exits 1 and the image build
    // fails. The postinstall only pre-creates the host data home, which this
    // container does not use.
    expect(installLine).toContain("--ignore-scripts");
  }
});

test("builder-stage installs keep the frozen lockfile discipline", () => {
  const installLines = builderInstallLines();
  for (const installLine of installLines) {
    expect(installLine).toContain("--frozen-lockfile");
  }
});

const runDocker = process.env.RUN_DOCKER_TESTS === "1";

test.skipIf(!runDocker)("full docker image build succeeds", () => {
  const res = spawnSync(
    "docker",
    ["build", "--platform=linux/arm64", "-t", "hasna/domains:o15-04208-dockerfile-check", "."],
    { cwd: new URL("..", import.meta.url), encoding: "utf8", timeout: 900_000 },
  );
  expect(res.status, res.stdout?.slice(-2000)).toBe(0);
});
