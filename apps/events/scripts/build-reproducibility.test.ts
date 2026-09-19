import { expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import {
  GENERATED_OUTPUTS,
  assertExactGeneratedOutputInventory,
  assertGeneratedEntrypointsCovered,
} from "./generated-output-manifest.js";

const ROOT = resolve(import.meta.dir, "../../..");

function run(cwd: string, command: string[]): void {
  const result = Bun.spawnSync(command, { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, CI: "1" } });
  if (result.exitCode !== 0) throw new Error(`${command.join(" ")} failed\n${result.stdout.toString()}\n${result.stderr.toString()}`);
}

function copyFixture(destination: string): void {
  for (const file of ["package.json", "bun.lock"]) cpSync(join(ROOT, file), join(destination, file));
  const appsOut = join(destination, "apps");
  mkdirSync(appsOut, { recursive: true });
  for (const entry of readdirSync(join(ROOT, "apps"), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const source = join(ROOT, "apps", entry.name);
    const target = join(appsOut, entry.name);
    mkdirSync(target, { recursive: true });
    const manifest = join(source, "package.json");
    if (existsSync(manifest)) cpSync(manifest, join(target, "package.json"));
  }
  for (const name of ["contracts", "events"]) {
    const source = join(ROOT, "apps", name);
    const target = join(appsOut, name);
    rmSync(target, { recursive: true, force: true });
    cpSync(source, target, { recursive: true, filter: (path) => !["node_modules", "dist", "types"].includes(basename(path)) });
  }
  const notesServer = join(ROOT, "apps", "notes", "server", "package.json");
  if (existsSync(notesServer)) {
    const target = join(appsOut, "notes", "server");
    mkdirSync(target, { recursive: true });
    cpSync(notesServer, join(target, "package.json"));
  }
}

function cleanInstallState(root: string): void {
  rmSync(join(root, "node_modules"), { recursive: true, force: true });
  for (const entry of readdirSync(join(root, "apps"), { withFileTypes: true })) {
    if (entry.isDirectory()) rmSync(join(root, "apps", entry.name, "node_modules"), { recursive: true, force: true });
  }
}

function buildAndRead(root: string): Map<string, Buffer> {
  run(root, ["bun", "run", "--filter", "@hasna/contracts", "build"]);
  run(root, ["bun", "run", "--filter", "@hasna/events", "build"]);
  const packageRoot = join(root, "apps", "events");
  assertExactGeneratedOutputInventory(packageRoot);
  assertGeneratedEntrypointsCovered(packageRoot);
  return new Map(GENERATED_OUTPUTS.map((file) => [file, readFileSync(join(packageRoot, file))]));
}

test("Events generated outputs are byte-identical after full and filtered Bun installs", () => {
  const fixture = mkdtempSync(join(tmpdir(), "events-install-shapes-"));
  try {
    copyFixture(fixture);
    run(fixture, ["bun", "install", "--frozen-lockfile", "--ignore-scripts"]);
    const full = buildAndRead(fixture);

    cleanInstallState(fixture);
    run(fixture, [
      "bun", "install", "--frozen-lockfile", "--ignore-scripts",
      "--filter", "@hasna/todos", "--filter", "@hasna/contracts", "--filter", "@hasna/events",
    ]);
    const filtered = buildAndRead(fixture);

    for (const file of GENERATED_OUTPUTS) {
      expect({ file, bytes: filtered.get(file) }).toEqual({ file, bytes: full.get(file) });
    }
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}, 120_000);
