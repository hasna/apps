#!/usr/bin/env bun
// Two-sided regression for the packed-content credential gate.
//
// `secrets scan workspace <root> --json` exits 0 EVEN WHEN IT FINDS
// CREDENTIALS (measured 2026-08-21 on station01: rc=0 with a planted key), so
// the gate parses the JSON payload and fails closed (see
// packed-content-scan.mjs). These tests assert the gate FIRES on a planted
// credential and STAYS SILENT on a clean tree, plus the parse-level
// fail-closed branches (invalid output, nonzero findingCount, nonempty
// findings, unmeasured payload shape).
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseExposureScanOutput, scanPackedContent } from "./packed-content-scan.mjs";

// Assembled at runtime so the credential literal never exists in this source
// file and cannot trip the staged secrets scan; the file written to the
// fixture directory carries the joined value, which the scanner detects.
const FIXTURE_CREDENTIAL = ["sk", "-ant-", "abcdefghijklmnop1234567890"].join("");

test("scanPackedContent fails closed on a planted credential (positive control)", () => {
  const dir = mkdtempSync(join(tmpdir(), "packed-scan-pos-"));
  try {
    writeFileSync(join(dir, "leak.ts"), `export const key = "${FIXTURE_CREDENTIAL}";\n`);
    expect(() => scanPackedContent(dir)).toThrow(/finding/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("scanPackedContent passes a clean tree (negative control)", () => {
  const dir = mkdtempSync(join(tmpdir(), "packed-scan-neg-"));
  try {
    writeFileSync(join(dir, "ok.ts"), 'export const msg = "benign";\n');
    const result = scanPackedContent(dir);
    expect(result.findingCount).toBe(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("parse rejects unparseable output", () => {
  expect(() => parseExposureScanOutput("not json")).toThrow(/invalid JSON/);
});

test("parse rejects a nonzero findingCount", () => {
  expect(() =>
    parseExposureScanOutput(JSON.stringify({ findingCount: 5, findings: [{}, {}] })),
  ).toThrow(/finding/);
});

test("parse rejects nonempty findings even when findingCount says zero", () => {
  expect(() =>
    parseExposureScanOutput(JSON.stringify({ findingCount: 0, findings: [{}] })),
  ).toThrow(/finding/);
});

test("parse rejects a payload with no finding signal at all", () => {
  expect(() => parseExposureScanOutput(JSON.stringify({}))).toThrow(
    /no finding signal/,
  );
});

test("parse accepts a clean scan envelope", () => {
  const out = parseExposureScanOutput(
    JSON.stringify({ findingCount: 0, findings: [] }),
  );
  expect(out.findingCount).toBe(0);
});
