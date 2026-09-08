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
  const result = Bun.spawnSync([process.execPath, ...args], { cwd, env, stdout: "pipe", stderr: "pipe" });
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
const keys: ClientTransportEnvKeys = clientTransportEnvKeys("fixture");
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
