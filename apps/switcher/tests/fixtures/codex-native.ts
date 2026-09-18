import { spyOn } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as native from "../../src/codex-native";

/** Explicit protocol fixture only: replaces installed release selection, never
 * establishes native artifact acceptance. Root/config admission remains real. */
export async function mockCodexNative() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "switcher-codex-fixture-")));
  const corpus = join(root, "corpus");
  await mkdir(corpus, { mode: 0o700 });
  const keys = ["HASNA_CODEX_STATE_HOME", "SUBSCRIPTIONS_SHARED_HOME_CODEX", "CODEX_HOME"];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  for (const key of keys) process.env[key] = corpus;
  const binding = spyOn(native, "inspectCodexNative").mockImplementation(async executable => {
    if (!executable) throw new Error("Protocol fixture requires an explicit executable");
    return { executable, guard: await native.codexFileGuard(executable, 1024 * 1024, undefined, true) };
  });
  return { root, corpus, binding, async cleanup() {
    binding.mockRestore();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await rm(root, { recursive: true, force: true });
  } };
}

/** Explicit preload for individual CLI subprocess fixtures. This preserves the
 * real CLI/PTY path but does not prove an installed native release. */
export async function createCodexCliPreload(root: string, executable: string): Promise<string> {
  const corpus = join(await realpath(root), "fixture-canonical-codex");
  await mkdir(corpus, { mode: 0o700 });
  const path = join(root, "codex-fixture-preload.ts");
  const modulePath = fileURLToPath(new URL("../../src/codex-native.ts", import.meta.url));
  await writeFile(path, `import { spyOn } from "bun:test";
import * as native from ${JSON.stringify(modulePath)};
for (const key of ["HASNA_CODEX_STATE_HOME", "SUBSCRIPTIONS_SHARED_HOME_CODEX", "CODEX_HOME"]) process.env[key] = ${JSON.stringify(corpus)};
spyOn(native, "inspectCodexNative").mockImplementation(async executable => {
  if (executable !== ${JSON.stringify(executable)}) throw new Error("Unexpected protocol fixture executable");
  return { executable, guard: await native.codexFileGuard(executable, 1024 * 1024, undefined, true) };
});
`, { mode: 0o600, flag: "wx" });
  return path;
}
