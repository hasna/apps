import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { codexFileGuard } from "../../src/codex-native";
import { preflightChatGPTLaunch } from "../../src/chatgpt-launch";
import type { NativeState } from "../../src/native-state";
import type { PreparedLaunch } from "../../src/harness-types";

/** Explicit source protocol fixture. This is not installed-native acceptance. */
export async function desktopAdmissionFixture(executable: string, sessionDir: string, state: NativeState) {
  return preflightChatGPTLaunch(sessionDir, state, { executable, guard: await codexFileGuard(executable, 1024 * 1024, undefined, true) });
}
export async function desktopInspectorPreload(root: string, executable: string) {
  const path = join(root, `desktop-inspector-${crypto.randomUUID()}.ts`);
  const sha = createHash("sha256").update(await readFile(executable)).digest("hex");
  await writeFile(path, `import{spyOn}from'bun:test';import * as native from ${JSON.stringify(join(import.meta.dir, "../../src/codex-native.ts"))};
spyOn(native,'inspectCodexNative').mockImplementation(async override=>{if(override!==undefined&&override!==${JSON.stringify(executable)})throw new Error('Unrecognized fixture native');return{executable:${JSON.stringify(executable)},guard:await native.codexFileGuard(${JSON.stringify(executable)},1024*1024,${JSON.stringify(sha)},true)}});`, { mode: 0o600, flag: "wx" });
  return path;
}
export async function desktopHelperFixture(prepared: PreparedLaunch, executable: string, args: string[]) {
  const root = dirname(prepared.env.CODEX_CLI_PATH), binding = join(root, "desktop-binding.json");
  const sha = createHash("sha256").update(await readFile(binding)).digest("hex");
  const preload = await desktopInspectorPreload(root, executable);
  return [process.execPath, "--preload", preload, join(import.meta.dir, "../../src/codex-state-bridge.ts"), "--desktop", binding, sha, "--", ...args];
}
