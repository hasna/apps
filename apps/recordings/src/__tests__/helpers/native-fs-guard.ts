import { chmodSync, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

let compiledAddon: string | undefined;

// The production prebuild is produced only by prepack, and prepublishOnly
// (typecheck && test) runs before prepack — so at test time it is absent on
// every host. Compile the fixture addon in place at its load path so the
// darwin loader's pinned prebuild resolution works without any env override.
function compileAddon(output: string, repositoryRoot: string): string {
  mkdirSync(dirname(output), { recursive: true, mode: 0o700 });
  const temporary = `${output}.tmp.${process.pid}`;
  try {
    const flags =
      process.platform === "darwin"
        ? ["-bundle", "-undefined", "dynamic_lookup"]
        : ["-shared", "-fPIC"];
    const result = Bun.spawnSync([
      "/usr/bin/cc",
      ...flags,
      "-std=c11",
      "-Wall",
      "-Wextra",
      "-Werror",
      "-DNAPI_VERSION=9",
      "-DNODE_GYP_MODULE_NAME=recordings_fs_guard",
      "-I",
      join(repositoryRoot, "node_modules", "node-api-headers", "include"),
      join(repositoryRoot, "scripts", "native", "recordings_fs_guard.c"),
      "-o",
      temporary,
    ]);
    if (result.exitCode !== 0) {
      throw new Error(`could not compile native filesystem guard fixture: ${result.stderr}`);
    }
    chmodSync(temporary, 0o755);
    renameSync(temporary, output);
  } finally {
    rmSync(temporary, { force: true });
  }
  return output;
}

export function ensureNativeFsGuardAddon(repositoryRoot = resolve(import.meta.dir, "../../..")): string {
  if (compiledAddon) return compiledAddon;
  const output = join(
    repositoryRoot,
    process.platform === "darwin"
      ? join("scripts", "native", "prebuilds", "darwin-universal")
      : join("node_modules", ".cache", "recordings-native-fs-guard"),
    "recordings_fs_guard.node",
  );
  if (!existsSync(output)) {
    compileAddon(output, repositoryRoot);
  }
  compiledAddon = output;
  return output;
}
