import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Check declarations through a real installed archive, outside the workspace.
// No source paths, ambient dependencies, or skipLibCheck can hide invalid ESM
// declaration imports. Install failures are failures, without an extraction fallback.
const root = join(import.meta.dir, "..");
const temporary = mkdtempSync(join(tmpdir(), "contracts-root-types-"));
const home = join(temporary, "home");
const consumer = join(temporary, "consumer");
mkdirSync(home);
mkdirSync(consumer);
const env = {
  PATH: process.env.PATH ?? "",
  HOME: home,
  TMPDIR: temporary,
  BUN_INSTALL_CACHE_DIR: join(temporary, "cache"),
};
function run(args: string[], cwd: string, label: string): void {
  const result = Bun.spawnSync([process.execPath, "--no-env-file", ...args], { cwd, env, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) {
    throw new Error(`${label} failed\n${new TextDecoder().decode(result.stdout)}\n${new TextDecoder().decode(result.stderr)}`);
  }
}
try {
  run(["pm", "pack", "--ignore-scripts", "--destination", temporary], root, "archive creation");
  const archive = readdirSync(temporary).filter((name) => name.endsWith(".tgz"));
  if (archive.length !== 1) throw new Error("expected exactly one packed archive");
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  writeFileSync(join(consumer, "package.json"), JSON.stringify({
    name: "contracts-root-types-consumer",
    private: true,
    type: "module",
    dependencies: { "@hasna/contracts": `file:${join(temporary, archive[0]!)}` },
    devDependencies: {
      typescript: manifest.devDependencies.typescript,
      "@types/bun": manifest.devDependencies["@types/bun"],
      // Mirror this package's own toolchain: with skipLibCheck=false a floating
      // @types/node makes bun-types itself fail (measured: 26.x vs bun-types
      // 1.3.14), which would hide whether OUR declarations are clean.
      "@types/node": manifest.devDependencies["@types/node"],
    },
  }));
  run(["install", "--ignore-scripts"], consumer, "isolated archive install");
  if (lstatSync(join(consumer, "node_modules/@hasna/contracts")).isSymbolicLink()) {
    throw new Error("consumer resolved a workspace symlink instead of the archive");
  }
  writeFileSync(join(consumer, "tsconfig.json"), JSON.stringify({
    compilerOptions: {
      strict: true, module: "NodeNext", moduleResolution: "NodeNext",
      target: "ES2022", skipLibCheck: false, noEmit: true, types: ["bun"],
    },
    include: ["consumer.ts"],
  }));
  writeFileSync(join(consumer, "consumer.ts"), `
import { clientTransportEnvKeys, parseContract, SCHEMA_IDS, type ClientTransportEnvKeys, type ProjectPanel } from "@hasna/contracts";
import type { ProjectPanel as SchemaPanel } from "@hasna/contracts/schemas";
import type { ClientTransportEnvKeys as ClientKeys } from "@hasna/contracts/client";
import { ClientResolutionError, resolveAppHome, selectsLocalStore, type AppHome } from "@hasna/contracts/client";
import { localOptInEnvKey } from "@hasna/contracts/client/local-opt-in";
const keys: ClientTransportEnvKeys = clientTransportEnvKeys("fixture");
// 1.1.0 client surface must type-check from the installed archive too.
const local: boolean = selectsLocalStore("fixture", {});
const home: AppHome | null = resolveAppHome("fixture", { HOME: "/fixture-home" }, { scope: "internal" });
const failure = new ClientResolutionError("CREDENTIAL_ABSENT", "fixture", "fixture message");
const exitCode: number = failure.exitCode;
const door: string = localOptInEnvKey("fixture");
// @ts-expect-error Codes are a closed union.
const badCode: typeof failure.code = "NOT_A_CODE";
void local; void home; void exitCode; void door; void badCode;
const sameKeys: ClientKeys = keys;
const panel: ProjectPanel = parseContract(SCHEMA_IDS.projectPanel, {});
const samePanel: SchemaPanel = panel;
const title: string = samePanel.title;
// @ts-expect-error Public declarations must preserve the project panel title type.
const invalidTitle: number = panel.title;
// @ts-expect-error Resolver metadata is a list of strings, not a credential.
const invalidKeys: string = keys.apiKeyKeys;
void sameKeys; void title; void invalidTitle; void invalidKeys;
`);
  run([join(consumer, "node_modules/typescript/bin/tsc"), "--project", "tsconfig.json"], consumer, "strict installed NodeNext declarations");
  console.log("isolated root declarations: archive install and strict NodeNext types passed (skipLibCheck=false)");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
