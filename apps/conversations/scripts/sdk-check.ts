#!/usr/bin/env bun
/**
 * Non-mutating generated-SDK drift gate.
 *
 * `sdk:generate` WRITES src/sdk/index.ts, so it cannot be the CI check: a run
 * that regenerates and then inspects its own output reports "in sync" for a
 * tree that was stale a moment earlier, and leaves the working tree dirty for
 * every later step. This regenerates into memory and compares — the tracked
 * file is never opened for writing.
 *
 * Exit 0 and `SDK_DRIFT: IN_SYNC` when the tracked file matches what the spec
 * would produce; exit 1 and `SDK_DRIFT: STALE` with both byte counts and both
 * digests when it does not. Bytes alone cannot distinguish two same-length
 * differing files, so the digest is what the gate actually turns on.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { generateSdkSource } from "./generate-sdk.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const trackedSdkPath = join(root, "src", "sdk", "index.ts");

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function checkSdkDrift(outputPath = trackedSdkPath): { inSync: boolean; report: string } {
  const expected = generateSdkSource().code;
  let actual: string;
  try {
    actual = readFileSync(outputPath, "utf8");
  } catch {
    return {
      inSync: false,
      report: `SDK_DRIFT: MISSING path=${relative(root, outputPath)}`,
    };
  }

  const expectedBytes = Buffer.byteLength(expected, "utf8");
  const actualBytes = Buffer.byteLength(actual, "utf8");
  if (expected === actual) {
    return {
      inSync: true,
      report: `SDK_DRIFT: IN_SYNC path=${relative(root, outputPath)} bytes=${actualBytes} sha256=${digest(actual)}`,
    };
  }
  return {
    inSync: false,
    report:
      `SDK_DRIFT: STALE path=${relative(root, outputPath)} `
      + `expected_bytes=${expectedBytes} actual_bytes=${actualBytes} `
      + `expected_sha256=${digest(expected)} actual_sha256=${digest(actual)}\n`
      + "Run `bun run sdk:generate` and commit the result.",
  };
}

if (import.meta.main) {
  const result = checkSdkDrift();
  console.log(result.report);
  process.exit(result.inSync ? 0 : 1);
}
