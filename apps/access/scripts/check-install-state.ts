#!/usr/bin/env bun
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

// Run after the scoped build. Packing intentionally skips the known blocked
// conformance prepack; this is install-state evidence, NOT publication approval.
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = mkdtempSync(join(tmpdir(), "access-install-state-"));
const home = join(root, "home");
const project = join(root, "consumer");
const pack = join(root, "pack");
for (const path of [home, project, pack]) mkdirSync(path);
const stateRoots = {
  XDG_CONFIG_HOME: join(root, "xdg-config"), XDG_DATA_HOME: join(root, "xdg-data"),
  XDG_CACHE_HOME: join(root, "xdg-cache"), XDG_STATE_HOME: join(root, "xdg-state"),
};
const userNpmrc = join(root, "user.npmrc");
const globalNpmrc = join(root, "global.npmrc");
writeFileSync(userNpmrc, "");
writeFileSync(globalNpmrc, "");
writeFileSync(join(project, "package.json"), JSON.stringify({ name: "access-install-fixture", private: true, type: "module" }));
const env = {
  PATH: `${dirname(process.execPath)}:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin`,
  HOME: home, TMPDIR: root, ...stateRoots,
  // Bun's own transpiler cache is runtime state, not Access installation data.
  // Give it an explicit test-owned destination outside the inspected HOME/XDG.
  BUN_RUNTIME_TRANSPILER_CACHE_PATH: join(root, "bun-runtime-cache"),
  // Even an accidental legacy callback must remain within this test's root.
  HASNA_ACCESS_DB_PATH: join(root, "legacy-guard", "access.db"),
  NPM_CONFIG_CACHE: join(root, "npm-cache"), NPM_CONFIG_USERCONFIG: userNpmrc,
  NPM_CONFIG_GLOBALCONFIG: globalNpmrc, NPM_CONFIG_UPDATE_NOTIFIER: "false",
};

function run(label: string, command: string, args: string[], cwd: string, expectedStatus = 0): string {
  const result = spawnSync(command, args, { cwd, env, encoding: "utf8", timeout: 120_000 });
  writeFileSync(join(root, `${label}.log`), `${result.stdout ?? ""}\n${result.stderr ?? ""}`);
  if (result.error || result.status !== expectedStatus) throw new Error(`${label} failed; inspect isolated evidence at ${root}.`);
  return result.stdout ?? "";
}

function assertNoState(): void {
  if (readdirSync(home).length || Object.values(stateRoots).some(path => existsSync(path)) || existsSync(join(root, "legacy-guard"))) {
    throw new Error(`Install or entrypoint created implicit home/XDG/database state; inspect ${root}.`);
  }
}

const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
for (const hook of ["preinstall", "install", "postinstall"]) {
  if (Object.hasOwn(manifest.scripts ?? {}, hook)) throw new Error(`Unexpected Access ${hook} hook.`);
}
const packed = JSON.parse(run("pack", "npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", pack], packageRoot))[0];
const tarball = join(pack, packed.filename);
// Scripts really are enabled for the consumer installation, with empty npmrcs.
run("install", "npm", ["install", "--ignore-scripts=false", "--foreground-scripts", "--no-audit", "--no-fund", "--package-lock=false", tarball], project);
assertNoState();
const installed = join(project, "node_modules", "@hasna", "access");
for (const path of [
  "dist/cli/index.js", "dist/mcp/index.js", "dist/server/index.js", "dist/index.js", "dist/index.d.ts",
  "dist/client/index.js", "dist/client/index.d.ts",
]) {
  if (!existsSync(join(installed, path))) throw new Error(`Missing installed artifact: ${path}`);
}
for (const bin of ["access", "access-mcp", "access-serve"]) {
  const entrypoint = join(project, "node_modules", ".bin", bin);
  for (const option of ["--help", "--version"]) run(`${bin}-${option.slice(2)}`, process.execPath, [entrypoint, option], project);
}
run("sdk-import", process.execPath, ["-e", "const sdk = await import('@hasna/access/sdk'); if (typeof sdk.AccessClient !== 'function' || Object.keys(sdk.CORE_ROUTES).length !== 43) process.exit(1);"], project);
// No URL/key plus an explicit test DB selector must fail closed, not open stdio
// against the legacy store or create any of its directories.
run("stdio-fail-closed", process.execPath, [join(installed, "dist/mcp/index.js"), "--stdio"], project, 1);
assertNoState();
console.log(JSON.stringify({
  ok: true, package: `${manifest.name}@${manifest.version}`, tarball,
  integrity: packed.integrity, shasum: packed.shasum, packedFiles: packed.entryCount,
  lifecycleScriptsEnabled: true, homeEntries: 0, xdgStateCreated: false,
  legacyDatabaseCreated: false, runtimeCacheRedirected: true,
  binsChecked: 3, sdkOperations: 43, evidence: root,
}, null, 2));
