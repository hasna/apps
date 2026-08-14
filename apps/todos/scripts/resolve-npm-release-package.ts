#!/usr/bin/env bun
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  resolveNpmReleasePackageByPath,
  resolveNpmReleasePackageByTag,
  validateNpmReleasePackageBinding,
} from "../src/lib/npm-release-package";

type ReleasePackage = {
  name?: string;
  version?: string;
  publishConfig?: { registry?: string };
};

const root = resolve(import.meta.dir, "..");
const options = parseOptions(process.argv.slice(2));
if (!/^[0-9a-f]{40}$/.test(options.releaseCommit)) fail("--release-commit must be an exact 40-hex Git commit");
if (!options.output) fail("--output is required");

const selected = options.refType === "tag"
  ? resolveTag(options.refName)
  : { ...resolveNpmReleasePackageByPath("."), version: "" };
const packageJson = JSON.parse(runGit(["show", `${options.releaseCommit}:${selected.manifestPath}`])) as ReleasePackage;
if (!packageJson.version) fail(`${selected.manifestPath} must declare a version`);

const tag = options.refType === "tag" ? options.refName : `${selected.tagPrefix}${packageJson.version}`;
const bindingFailures = validateNpmReleasePackageBinding({
  packagePath: selected.packagePath,
  packageName: packageJson.name ?? "",
  packageVersion: packageJson.version,
  tag,
});
if (bindingFailures.length > 0) fail(bindingFailures.map((failure) => failure.message).join("; "));
if (packageJson.publishConfig?.registry !== "https://registry.npmjs.org") {
  fail(`${selected.manifestPath} must target the public npm registry`);
}

appendFileSync(options.output, [
  `path=${selected.packagePath}`,
  `manifest=${selected.manifestPath}`,
  `name=${packageJson.name}`,
  `version=${packageJson.version}`,
  `tag_prefix=${selected.tagPrefix}`,
].join("\n") + "\n");
console.log(options.refType === "tag"
  ? `tag ${options.refName} selects ${selected.packagePath} and agrees with ${packageJson.name}@${packageJson.version}`
  : `manual run selects ${selected.packagePath} and ${packageJson.name}@${packageJson.version}`);

function resolveTag(tag: string) {
  try {
    return resolveNpmReleasePackageByTag(tag);
  } catch (error) {
    fail(error instanceof Error ? error.message : "unrecognised npm release tag");
  }
}

function parseOptions(args: string[]): {
  releaseCommit: string;
  refType: string;
  refName: string;
  output?: string;
} {
  const options = { releaseCommit: "", refType: "", refName: "", output: undefined as string | undefined };
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!flag?.startsWith("--") || value === undefined) fail(`missing value for ${flag ?? "argument"}`);
    switch (flag) {
      case "--release-commit": options.releaseCommit = value; break;
      case "--ref-type": options.refType = value; break;
      case "--ref-name": options.refName = value; break;
      case "--output": options.output = value; break;
      default: fail(`unknown option ${flag}`);
    }
  }
  return options;
}

function runGit(args: string[]): string {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) fail(result.stderr.trim() || `git ${args[0]} failed`);
  return result.stdout;
}

function fail(message: string): never {
  console.error(`::error::Could not resolve npm release package: ${message}`);
  process.exit(1);
}
