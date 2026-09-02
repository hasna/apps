#!/usr/bin/env bun
/**
 * Scan the PACKED release artifact for internal-infra strings.
 *
 * This is the `scan:artifact` release gate declared in hasna.contract.json
 * (metadata.release.artifactScan) and wired into prepack/prepublishOnly.
 * Run: bun run scan:artifact
 *
 * `contracts artifact-scan` takes a target and refuses to scan src/, so the
 * gate packs first — packing with --ignore-scripts, because the pack that
 * feeds the scan is itself triggered from prepack.
 *
 * The scanner version is pinned here and nowhere else, and stays in lockstep
 * with the manifest kitVersion. There is deliberately no environment
 * override: a gate whose command can be replaced at publish time is the
 * exact bypass the gate exists to close.
 */

import { lstatSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const CONTRACTS_KIT_VERSION = "0.14.2";

export function assertSupportedNpmVersion(version: string): void {
  // Fail closed on non-release or unparseable output; never echo that output.
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version);
  if (!match || !match.slice(1).every((part) => Number.isSafeInteger(Number(part)))) {
    throw new Error("artifact scan: npm --version returned an invalid version; npm >=11.0.0 is required");
  }
  if (Number(match[1]) < 11) {
    throw new Error(`artifact scan: npm ${version} is unsupported; npm >=11.0.0 is required to suppress prepare lifecycle scripts`);
  }
}

function requireSupportedNpm(cwd: string): void {
  let version: string;
  try {
    const result = Bun.spawnSync(["npm", "--version"], { cwd, stdout: "pipe", stderr: "pipe" });
    if (result.exitCode !== 0) throw new Error("npm version probe failed");
    version = new TextDecoder().decode(result.stdout).trim();
  } catch {
    // Version probes can contain arbitrary npm config/diagnostic output.
    throw new Error("artifact scan: could not determine npm version; npm >=11.0.0 is required");
  }
  assertSupportedNpmVersion(version);
}

function run(command: string[], cwd: string): string {
  const result = Bun.spawnSync(command, { cwd, stdout: "pipe", stderr: "pipe" });
  const stdout = new TextDecoder().decode(result.stdout).trim();
  if (result.exitCode !== 0) {
    const stderr = new TextDecoder().decode(result.stderr).trim();
    throw new Error(`${command.join(" ")} exited ${result.exitCode}\n${stdout}\n${stderr}`);
  }
  return stdout;
}

export function scannerCommand(archive: string): string[] {
  return ["bunx", `@hasna/contracts@${CONTRACTS_KIT_VERSION}`, "artifact-scan", archive];
}

export function packCommand(workspace: string): string[] {
  // An outer `npm pack --dry-run` exports npm_config_dry_run=true to prepack.
  // This inner pack must create a real archive even in that environment.
  return ["npm", "pack", ".", "--json", "--pack-destination", workspace, "--ignore-scripts", "--workspaces=false", "--dry-run=false"];
}

function packedArchive(packed: string, workspace: string): string {
  let entries: unknown;
  try {
    entries = JSON.parse(packed);
  } catch {
    throw new Error("artifact scan: npm pack did not return valid JSON");
  }
  if (!Array.isArray(entries) || entries.length !== 1) {
    throw new Error("artifact scan: npm pack must return exactly one artifact");
  }
  const filename = entries[0]?.filename;
  // npm filenames are basenames, never paths or options. Validate before
  // joining so neither traversal nor a different package location can scan.
  if (typeof filename !== "string" || !/^[a-z0-9][a-z0-9._-]*\.tgz$/i.test(filename)) {
    throw new Error("artifact scan: npm pack returned an invalid archive filename");
  }
  const archive = join(workspace, filename);
  let regular = false;
  try {
    regular = lstatSync(archive).isFile();
  } catch {
    // A dry-run or missing pack result is not a scanable artifact.
  }
  if (!regular) throw new Error("artifact scan: npm pack did not create a local regular archive");
  return archive;
}

/** Pack the tarball npm would publish, then scan that tarball — never src/. */
export function scanPackedArtifact(): { command: string[]; output: string } {
  const repoRoot = join(import.meta.dir, "..");
  // npm 10's bundled pacote ignores --ignore-scripts for prepare. Refuse
  // that toolchain before packing can run any package lifecycle script.
  requireSupportedNpm(repoRoot);
  const workspace = mkdtempSync(join(tmpdir(), "paths-artifact-scan-"));

  try {
    const packed = run(packCommand(workspace), repoRoot);
    const archive = packedArchive(packed, workspace);
    const command = scannerCommand(archive);
    return { command, output: run(command, repoRoot) };
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  // Echo the resolved command so a scan that ran nothing is visible in publish logs.
  const { command, output } = scanPackedArtifact();
  console.log(`$ ${command.join(" ")}`);
  if (output) console.log(output);
}
