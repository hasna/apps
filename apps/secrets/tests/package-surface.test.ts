import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  SecretsClient,
  createSecretsClientFromEnv,
  type SecretInput,
} from "../src/sdk.js";

const rootDir = join(import.meta.dir, "..");

type PackageExport = { types: string; import: string };
type PackageManifest = {
  main: string;
  types: string;
  bin: Record<string, string>;
  exports: Record<string, PackageExport>;
};

function runCli(...args: string[]) {
  const result = Bun.spawnSync({
    cmd: ["bun", "src/index.ts", ...args],
    cwd: rootDir,
    env: { ...process.env, NO_COLOR: "1" },
  });
  return {
    exitCode: result.exitCode,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}

describe("published package surface", () => {
  it("maps the package root and compatibility subpath to the typed SDK", () => {
    const manifest = JSON.parse(
      readFileSync(join(rootDir, "package.json"), "utf8"),
    ) as PackageManifest;

    const sdkExport = {
      types: "./dist/sdk.d.ts",
      import: "./dist/sdk.js",
    };
    expect(manifest.main).toBe("./dist/sdk.js");
    expect(manifest.types).toBe("./dist/sdk.d.ts");
    expect(manifest.exports["."]).toEqual(sdkExport);
    expect(manifest.exports["./sdk"]).toEqual(sdkExport);
  });

  it("imports the SDK with its public types", () => {
    const input: SecretInput = {
      key: "example/service/dev/api_key",
      value: "fixture-value",
      type: "api_key",
    };
    const client = createSecretsClientFromEnv({
      SECRETS_API_URL: "https://example.invalid",
    });

    expect(input.key).toBe("example/service/dev/api_key");
    expect(client).toBeInstanceOf(SecretsClient);
  });

  it("wires both CLI and MCP entrypoints without starting the server", () => {
    const manifest = JSON.parse(
      readFileSync(join(rootDir, "package.json"), "utf8"),
    ) as PackageManifest;
    expect(manifest.bin).toMatchObject({
      secrets: "dist/index.js",
      "secrets-mcp": "dist/mcp-server.js",
    });

    for (const args of [["--help"], ["mcp", "--help"]]) {
      const result = runCli(...args);
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("secrets — local secrets vault");
      expect(result.stdout).toContain("mcp");
    }
  });
});
