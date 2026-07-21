#!/usr/bin/env bun
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

function run(command, args, cwd = repoRoot) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
    throw new Error(`${command} ${args.join(" ")} failed\n${output}`);
  }
  return result;
}

const tempRoot = mkdtempSync(join(tmpdir(), "loops-packed-boundary-"));
const extractRoot = join(tempRoot, "extract");

try {
  run("bun", [
    "pm",
    "pack",
    "--destination",
    tempRoot,
    "--ignore-scripts",
    "--quiet",
  ]);

  const archiveName = readdirSync(tempRoot).find((entry) => entry.endsWith(".tgz"));
  if (!archiveName) {
    throw new Error("bun pack did not create a package tarball");
  }

  mkdirSync(extractRoot);
  run("tar", ["-xzf", join(tempRoot, archiveName), "-C", extractRoot]);

  const packageRoot = join(extractRoot, "package");
  if (!existsSync(packageRoot)) {
    throw new Error("packed package did not contain the expected package root");
  }

  const packageJson = JSON.parse(
    readFileSync(join(packageRoot, "package.json"), "utf8"),
  );
  if (packageJson.bin?.["loops-api"] !== "dist/api/index.js") {
    throw new Error("packed package did not preserve loops-api -> dist/api/index.js");
  }
  if (
    packageJson.exports?.["./api"]?.import !== "./dist/api/index.js" ||
    packageJson.exports?.["./api"]?.types !== "./dist/api/index.d.ts"
  ) {
    throw new Error("packed package did not preserve the ./api export");
  }
  if (
    !existsSync(join(packageRoot, "dist", "api", "index.js")) ||
    !existsSync(join(packageRoot, "dist", "api", "index.d.ts"))
  ) {
    throw new Error("packed package omitted the loops-api runtime or types");
  }

  symlinkSync(join(repoRoot, "node_modules"), join(extractRoot, "node_modules"), "dir");
  const binSmoke = run(
    "bun",
    [join(packageRoot, "dist", "api", "index.js"), "--json", "status"],
    extractRoot,
  );
  const binStatus = JSON.parse(binSmoke.stdout);
  if (binStatus.service !== "loops-api" || binStatus.ok !== true) {
    throw new Error("packed loops-api binary status smoke returned an invalid envelope");
  }

  const exportSmoke = run(
    "bun",
    [
      "-e",
      [
      'import { apiStatus } from "@hasna/loops/api";',
      "process.stdout.write(JSON.stringify(apiStatus()));",
      ].join("\n"),
    ],
    packageRoot,
  );
  const exportStatus = JSON.parse(exportSmoke.stdout);
  if (exportStatus.service !== "loops-api" || exportStatus.ok !== true) {
    throw new Error("packed @hasna/loops/api export smoke returned an invalid envelope");
  }

  const scan = run("bun", [
    "run",
    "scripts/no-private-cloud-boundary.mjs",
    "--root",
    packageRoot,
  ]);
  process.stdout.write(scan.stdout);
  console.log("Loops packed artifact boundary and loops-api export/bin smokes passed");
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
