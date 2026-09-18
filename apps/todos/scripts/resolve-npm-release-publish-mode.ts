#!/usr/bin/env bun
import { appendFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { parseNpmReleaseLane, resolveNpmReleasePublishMode } from "../src/lib/npm-release-context";

try {
  const mode = resolveNpmReleasePublishMode(process.env.RELEASE_PUBLISH_MODE);
  if (!process.env.GITHUB_OUTPUT) throw new Error("GITHUB_OUTPUT is required");
  if (process.env.GITHUB_EVENT_NAME === "push") {
    const tag = process.env.GITHUB_REF_NAME ?? "";
    if (!/^npm\/todos\/v[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(tag)) throw new Error("an exact todos release tag is required");
    const result = spawnSync("git", ["for-each-ref", "--format=%(contents)", `refs/tags/${tag}`], { encoding: "utf8" });
    if (result.status !== 0 || parseNpmReleaseLane(result.stdout) !== mode) {
      throw new Error("the annotated tag delivery lane must match RELEASE_PUBLISH_MODE");
    }
  }
  appendFileSync(process.env.GITHUB_OUTPUT, `mode=${mode}\n`);
  console.log(`npm release delivery: ${mode}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "invalid release delivery mode");
  process.exitCode = 1;
}
