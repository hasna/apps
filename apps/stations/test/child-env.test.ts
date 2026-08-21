import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSecretsExecShell } from "../src/child-env.js";
import { EXACT_BUN_REGISTRY_SECRET_REFS } from "../src/manifests.js";

const roots: string[] = [];
const fixtureValues = ["outer-fixture-value", "inner-fixture-value"] as const;
let positiveControl = "";
const missingReferenceExitCodes: number[] = [];
const missingExportExitCodes: number[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fakeSecretsPath(): { root: string; bin: string } {
  const root = mkdtempSync(join(tmpdir(), "stations-child-env-"));
  roots.push(root);
  const bin = join(root, "bin");
  mkdirSync(bin, { recursive: true });
  const executable = join(bin, "secrets");
  writeFileSync(executable, `#!/bin/sh
set -eu
[ "\${1:-}" = "exec" ] || exit 64
secret_key="\${2:-}"
shift 2
[ "\${1:-}" = "--as" ] || exit 65
env_name="\${2:-}"
shift 2
[ "\${1:-}" = "--" ] || exit 66
shift
[ "\${FAKE_SECRETS_MISSING_REF:-}" != "$secret_key" ] || exit 41
case "$secret_key" in
  hasna/npm/live/publish-token) value="${fixtureValues[0]}" ;;
  hasnaxyz/npm/live/publish-token) value="${fixtureValues[1]}" ;;
  *) exit 41 ;;
esac
if [ "\${FAKE_SECRETS_OMIT_REF:-}" != "$secret_key" ]; then
  export "$env_name=$value"
fi
exec "$@"
`);
  chmodSync(executable, 0o755);
  return { root, bin };
}

function nestedCommand(marker: string): string {
  const leaf = `[ -n "\${HASNA_NPM_PUBLISH_TOKEN:-}" ] && [ -n "\${HASNAXYZ_NPM_PUBLISH_TOKEN:-}" ] || { printf child_environment_contract_missing >&2; exit 42; }; printf 'CHILD_ENV_CONTROL outer=set inner=set\\n'; printf ran > '${marker}'`;
  const inner = buildSecretsExecShell(EXACT_BUN_REGISTRY_SECRET_REFS[1], "HASNAXYZ_NPM_PUBLISH_TOKEN", leaf);
  return buildSecretsExecShell(EXACT_BUN_REGISTRY_SECRET_REFS[0], "HASNA_NPM_PUBLISH_TOKEN", inner);
}

function occurrenceCount(value: string, needle: string): number {
  return value.split(needle).length - 1;
}

describe("child environment delivery", () => {
  test("nested station-local Secrets exec delivers both references without serializing values", () => {
    const fixture = fakeSecretsPath();
    const marker = join(fixture.root, "consumer-ran");
    const command = nestedCommand(marker);
    const result = spawnSync("sh", ["-c", command], {
      encoding: "utf8",
      env: { PATH: `${fixture.bin}:${process.env.PATH ?? ""}` },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("CHILD_ENV_CONTROL outer=set inner=set\n");
    positiveControl = result.stdout.trim();
    expect(result.stderr).toBe("");
    expect(occurrenceCount(command, EXACT_BUN_REGISTRY_SECRET_REFS[0])).toBe(1);
    expect(occurrenceCount(command, EXACT_BUN_REGISTRY_SECRET_REFS[1])).toBe(1);
    expect(existsSync(marker)).toBe(true);
    for (const value of fixtureValues) expect(`${result.stdout}${result.stderr}`).not.toContain(value);
  });

  for (const missingRef of EXACT_BUN_REGISTRY_SECRET_REFS) {
    test(`missing reference ${missingRef} stops before child execution`, () => {
      const fixture = fakeSecretsPath();
      const marker = join(fixture.root, "consumer-ran");
      const result = spawnSync("sh", ["-c", nestedCommand(marker)], {
        encoding: "utf8",
        env: {
          PATH: `${fixture.bin}:${process.env.PATH ?? ""}`,
          FAKE_SECRETS_MISSING_REF: missingRef,
        },
      });

      expect(result.status).toBe(41);
      missingReferenceExitCodes.push(result.status!);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("");
      expect(existsSync(marker)).toBe(false);
      expect(`${result.stdout}${result.stderr}`).not.toContain(missingRef);
      for (const value of fixtureValues) expect(`${result.stdout}${result.stderr}`).not.toContain(value);
    });
  }

  for (const omittedRef of EXACT_BUN_REGISTRY_SECRET_REFS) {
    test(`missing child export for ${omittedRef} fails the contract`, () => {
      const fixture = fakeSecretsPath();
      const marker = join(fixture.root, "consumer-ran");
      const result = spawnSync("sh", ["-c", nestedCommand(marker)], {
        encoding: "utf8",
        env: {
          PATH: `${fixture.bin}:${process.env.PATH ?? ""}`,
          FAKE_SECRETS_OMIT_REF: omittedRef,
        },
      });

      expect(result.status).toBe(42);
      missingExportExitCodes.push(result.status!);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("child_environment_contract_missing");
      expect(existsSync(marker)).toBe(false);
      for (const value of fixtureValues) expect(`${result.stdout}${result.stderr}`).not.toContain(value);
    });
  }

  test("blank secret references fail before shell construction", () => {
    expect(() => buildSecretsExecShell("", "VALID_NAME", "true")).toThrow("secret_reference_missing");
    expect(new Set(missingReferenceExitCodes)).toEqual(new Set([41]));
    expect(new Set(missingExportExitCodes)).toEqual(new Set([42]));
    console.info(`${positiveControl} missing_reference_exit=${missingReferenceExitCodes[0]} missing_export_exit=${missingExportExitCodes[0]}`);
  });
});
