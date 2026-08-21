#!/usr/bin/env bun
// Fail-closed wrapper over `secrets scan workspace <root> --json` for packed
// artifact content.
//
// `secrets scan workspace` exits 0 EVEN WHEN IT FINDS CREDENTIALS (measured
// 2026-08-21 on station01: a planted Anthropic key literal in a .ts file
// returned rc=0 with a populated findings array), so the subprocess status
// alone cannot be the gate. The JSON payload must be parsed and validated,
// and any finding, any scan error, or any unparseable output must fail
// closed.
import { spawnSync } from "node:child_process";

export function parseExposureScanOutput(stdout) {
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (err) {
    throw new Error(
      `packed content secrets scan emitted invalid JSON: ${err.message}`,
    );
  }
  const findings = Array.isArray(parsed?.findings) ? parsed.findings : null;
  const findingCount = parsed?.findingCount;
  const countIsUsable =
    typeof findingCount === "number" &&
    Number.isInteger(findingCount) &&
    findingCount >= 0;
  if (findings === null && !countIsUsable) {
    throw new Error(
      "packed content secrets scan emitted a payload with no finding signal; failing closed",
    );
  }
  const count = countIsUsable ? findingCount : (findings?.length ?? 0);
  if (count !== 0 || (findings?.length ?? 0) > 0) {
    throw new Error(
      `packed content secrets scan found ${findings?.length ?? count} credential finding(s); failing closed`,
    );
  }
  const errors = parsed?.stats?.errors;
  if (Array.isArray(errors) && errors.length > 0) {
    throw new Error(
      `packed content secrets scan could not scan every file; failing closed: ${JSON.stringify(errors)}`,
    );
  }
  return parsed;
}

export function scanPackedContent(root) {
  const result = spawnSync(
    "secrets",
    ["scan", "workspace", root, "--json"],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(
      `packed content secrets scan failed (rc=${result.status})\n` +
        [result.stdout, result.stderr].filter(Boolean).join("\n"),
    );
  }
  return parseExposureScanOutput(result.stdout);
}
