import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
};
const peerRange = packageJson.peerDependencies?.["@hasna/secrets"];
if (peerRange !== "^0.3.10 || ^0.4.0") {
  throw new Error(`@hasna/secrets peer range drifted: ${peerRange ?? "(missing)"}`);
}
if (packageJson.peerDependenciesMeta?.["@hasna/secrets"]?.optional !== true) {
  throw new Error("@hasna/secrets must be marked as an optional peer dependency");
}

// Keep this check under the station Workspace scratch policy while allowing CI
// and other stations to choose their own equivalent root explicitly.
const scratchRoot = process.env.CONTRACTS_OPTIONAL_PEER_CHECK_DIR
  ?? join(homedir(), "Workspace", "scratch", "universal-harness-switcher", "contracts-peer-check");
mkdirSync(scratchRoot, { recursive: true });
const runRoot = mkdtempSync(join(scratchRoot, "run-"));
const packRoot = join(runRoot, "pack");
const consumerRoot = join(runRoot, "consumer");
mkdirSync(packRoot);
mkdirSync(consumerRoot);

function text(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function run(command: string[], cwd: string): void {
  const result = Bun.spawnSync(command, { cwd, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) {
    throw new Error(`${command.join(" ")} exited ${result.exitCode}\n${text(result.stderr)}`);
  }
}

const runtimeCheck = `
import assert from "node:assert/strict";
import { completePointerCredential, resolveCredential } from "@hasna/contracts/client";

const env = { HOME: "/path-that-does-not-exist", HASNA_TODOS_API_KEY: "environment-key" };
const ordinary = resolveCredential("todos", env);
assert.equal(ordinary?.tier, "env");

const keychain = resolveCredential("todos", { HASNA_STATION: "fixture" }, {
  keychain: {
    platform: "darwin",
    hostname: () => "fixture",
    run: () => ({ status: 0, stdout: "keychain-key\\n", stderr: "" }),
  },
});
assert.equal(keychain?.tier, "keychain");

const pointerEnv = {
  ...env,
  HASNA_TODOS_API_KEY: "ambient-fallback-key",
  HASNA_TODOS_API_KEY_REF: "hasna/todos/live/api_key",
};
const pointer = resolveCredential("todos", pointerEnv);
assert.equal(pointer?.tier, "pointer");
await assert.rejects(
  () => completePointerCredential("todos", pointer, pointerEnv),
  (error) => {
    assert.equal(error?.name, "CredentialResolutionError");
    assert.match(error?.message, /@hasna\\/secrets.*not installed.*TERMINAL/i);
    assert.match(error?.message, /never falls through to a literal or disk credential|unset HASNA_TODOS_API_KEY_REF/i);
    assert.doesNotMatch(error?.message, /ambient-fallback-key/);
    return true;
  },
);
`;

try {
  const packed = Bun.spawnSync(
    ["bun", "pm", "pack", "--destination", packRoot, "--ignore-scripts", "--quiet"],
    { cwd: root, stdout: "pipe", stderr: "pipe" },
  );
  if (packed.exitCode !== 0) {
    throw new Error(`bun pm pack exited ${packed.exitCode}\n${text(packed.stderr)}`);
  }
  const archiveName = readdirSync(packRoot).find((entry) => entry.endsWith(".tgz"));
  if (!archiveName) throw new Error("bun pm pack produced no archive");
  const archivePath = join(packRoot, archiveName);
  writeFileSync(
    join(consumerRoot, "package.json"),
    JSON.stringify({
      name: "contracts-optional-peer-consumer",
      private: true,
      type: "module",
      dependencies: { "@hasna/contracts": `file:../pack/${archiveName}` },
    }, null, 2),
  );

  // This is intentionally an ordinary npm install: omit/legacy-peer flags
  // would hide the dependency contract this smoke is proving.
  run(["npm", "install"], consumerRoot);
  const consumerNodeModules = join(consumerRoot, "node_modules");
  if (existsSync(join(consumerNodeModules, "@hasna", "secrets"))) {
    throw new Error("npm installed @hasna/secrets even though the peer is optional");
  }
  if (existsSync(join(consumerNodeModules, "@hasna", "events"))) {
    throw new Error("consumer unexpectedly installed @hasna/events");
  }
  writeFileSync(join(consumerRoot, "check.mjs"), runtimeCheck);
  run(["node", "check.mjs"], consumerRoot);
  // Keep the archive path in the source so the pack operation cannot silently
  // resolve the workspace package through a symlink.
  if (!existsSync(archivePath)) throw new Error("packed archive disappeared before runtime check");
  console.log("optional peer packed-consumer smoke passed");
} finally {
  rmSync(runRoot, { recursive: true, force: true });
}
