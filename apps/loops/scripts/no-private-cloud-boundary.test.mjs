#!/usr/bin/env bun
// Two-sided regression for the packed-boundary scanner's internal-infra
// patterns (AWS ARN, 12-digit AWS account id). A scanner whose patterns cannot
// fire reports a clean tree; a fixture that fires on known-positive input and
// stays silent on known-negative input keeps the gate honest in both
// directions (fleet probe-guard discipline).
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const scanner = join(import.meta.dir, "no-private-cloud-boundary.mjs");

function runScanner(root) {
  return spawnSync("bun", ["run", scanner, "--root", root], {
    encoding: "utf8",
  });
}

test("aws-arn and aws-account-id patterns fire on known-positive fixtures", () => {
  const dir = mkdtempSync(join(tmpdir(), "boundary-pos-"));
  try {
    mkdirSync(join(dir, "nested"), { recursive: true });
    writeFileSync(
      join(dir, "nested", "deploy.md"),
      "role arn:aws:iam::123456789012:role/fleet-runner\n",
    );
    writeFileSync(
      join(dir, "account.json"),
      '{"accountId": "789877399345"}\n',
    );
    const result = runScanner(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("possible secret pattern aws-arn");
    expect(result.stderr).toContain("possible secret pattern aws-account-id");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("scanner stays silent on a known-negative fixture", () => {
  const dir = mkdtempSync(join(tmpdir(), "boundary-neg-"));
  try {
    writeFileSync(
      join(dir, "notes.txt"),
      "the backend is selected by the environment contract alone\n",
    );
    const result = runScanner(dir);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Loops private cloud boundary scan passed");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
