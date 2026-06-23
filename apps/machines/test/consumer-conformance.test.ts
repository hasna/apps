import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "..");
const sourceRoot = join(repoRoot, "src");
const scriptPath = join(repoRoot, "scripts", "consumer-conformance.mjs");

describe("consumer conformance fixture", () => {
  test("simulates SDK, future contract, CLI-only, and unavailable downstream shapes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-consumer-conformance-"));
    try {
      const packageDir = join(dir, "package");
      mkdirSync(join(packageDir, "dist"), { recursive: true });
      const build = await Bun.build({
        entrypoints: [join(sourceRoot, "consumer.ts")],
        outdir: join(packageDir, "dist"),
        target: "bun",
        format: "esm",
      });
      expect(build.success).toBe(true);
      writeFileSync(join(packageDir, "package.json"), JSON.stringify({
        name: "@hasna/machines",
        version: "0.0.0-conformance-test",
        type: "module",
        exports: {
          "./consumer": {
            import: "./dist/consumer.js",
          },
        },
      }, null, 2));

      const binDir = join(dir, "bin");
      mkdirSync(binDir, { recursive: true });
      const fakeCli = join(binDir, "machines-fixture");
      writeFileSync(fakeCli, `#!/bin/sh
if [ "$1" = "topology" ]; then
  printf '%s\n' '{"schema_version":1,"pagination":{"limit":10,"offset":0,"total":1,"count":1,"hasMore":false,"nextOffset":null,"has_more":false,"next_offset":null,"order":"updated_at_desc"},"machines":[{"machine_id":"consumer-conformance-local","friendly_name":null,"display_name":"consumer-conformance-local","updated_at":null}],"warnings":[]}'
  exit 0
fi
if [ "$1" = "route" ]; then
  printf '%s\n' '{"schema_version":1,"ok":true,"route":"local","target":"localhost","warnings":[]}'
  exit 0
fi
echo "unexpected machines fixture command: $*" >&2
exit 1
`);
      chmodSync(fakeCli, 0o755);

      expect(existsSync(scriptPath)).toBe(true);
      const result = spawnSync(process.execPath, [
        scriptPath,
        "--json",
        "--package-dir",
        packageDir,
        "--cli-command",
        fakeCli,
      ], {
        cwd: repoRoot,
        env: process.env,
        encoding: "utf8",
      });

      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      const output = JSON.parse(result.stdout) as {
        ok: boolean;
        supported_contract_version: number;
        cases: Array<{ name: string; ok: boolean; output: Record<string, any> }>;
      };
      expect(output.ok).toBe(true);
      expect(output.supported_contract_version).toBe(1);
      expect(output.cases.map((entry) => entry.name)).toEqual([
        "sdk-local",
        "future-contract-sdk",
        "global-cli-only",
        "no-sdk-no-cli",
      ]);
      const future = output.cases.find((entry) => entry.name === "future-contract-sdk")?.output;
      expect(future).toMatchObject({
        supported: false,
        contract_version: 2,
        error: "unsupported_contract_version:2",
        trusted_envelopes: [],
      });
      const unavailable = output.cases.find((entry) => entry.name === "no-sdk-no-cli")?.output;
      expect(unavailable).toMatchObject({
        sdk_available: false,
        cli_available: false,
        error: "machines_unavailable",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
