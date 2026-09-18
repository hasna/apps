import { createHash } from "node:crypto";
import { lstat, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Fault } from "./domain";
import { privateDirectory } from "./runtime";
import { codexDirectoryGuard, codexFileGuard, inspectCodexNative, type CodexNativeInstallation } from "./codex-native";
import { HarnessSettlementError } from "./harness-process";
import type { PreparedLaunch } from "./harness-types";
import type { ChatGPTInstallation } from "./desktop-apps";
import { desktopLease } from "./desktop-state";
import { nativeStateEnvironment, resolveNativeState, type NativeState } from "./native-state";
import { assertChatGPTLegacyEmpty, assertCodexDesktopSnapshot, snapshotCodexDesktopState, type CodexDesktopBinding, type CodexDesktopSnapshot } from "./codex-state-bridge";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const quote = (value: string) => `'${value.replaceAll("'", "'\"'\"'")}'`;
async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}
async function directoryIdentity(path: string): Promise<string> {
  const entry = await lstat(path, { bigint: true });
  return [entry.dev, entry.ino, entry.uid, entry.gid, entry.mode].join(":");
}
export type ChatGPTLaunchAdmission = {
  sessionDir: string; state: NativeState; native: CodexNativeInstallation;
  snapshot: CodexDesktopSnapshot; guard: () => Promise<void>;
};

/** No mutation, credential resolution or fallback to a new private corpus. */
export async function preflightChatGPTLaunch(sessionDir: string, state: NativeState, native: CodexNativeInstallation): Promise<ChatGPTLaunchAdmission> {
  if (state.tool !== "codex" || resolve(sessionDir) !== sessionDir) throw new Fault(422, "native_state_tool", "ChatGPT requires an absolute desktop profile and canonical Codex corpus.");
  const snapshot = await snapshotCodexDesktopState(state);
  const sessionGuard = await exists(sessionDir) ? await codexDirectoryGuard(sessionDir, true) : undefined;
  const settlementDirectory = join(sessionDir, "codex-bridges");
  const guard = async () => {
    await native.guard(); await sessionGuard?.(); await assertCodexDesktopSnapshot(snapshot);
    await assertChatGPTLegacyEmpty(sessionDir);
    if (await exists(settlementDirectory)) {
      await (await codexDirectoryGuard(settlementDirectory, true))();
      if ((await readdir(settlementDirectory)).length) throw new HarnessSettlementError();
    }
  };
  await guard();
  return { sessionDir, state, native, snapshot, guard };
}

/** Electron state is profile-private; native state is canonical and credentials
 * live only in a fresh typed auth home for this one desktop invocation. */
export async function prepareChatGPTLaunch(native: PreparedLaunch, app: ChatGPTInstallation, stateDir: string, sessionDir: string,
  sharedState?: NativeState, admission?: ChatGPTLaunchAdmission): Promise<PreparedLaunch> {
  const state = sharedState ?? await resolveNativeState("codex", process.env, { create: false });
  const accepted = admission ?? await preflightChatGPTLaunch(sessionDir, state, await inspectCodexNative(native.executable));
  if (accepted.sessionDir !== sessionDir || accepted.state.home !== state.home || accepted.native.executable !== native.executable)
    throw new Fault(409, "desktop_binding_changed", "Desktop admission no longer matches its prepared native launch.");
  await accepted.guard();
  // All legacy/installation checks above are read-only and precede mutation.
  await privateDirectory(sessionDir);
  // A mutable provider profile is not an account identity. Never reuse login
  // cookies when its provider or credential changes; only the corpus is shared.
  const userData = join(stateDir, "electron"), settlementDirectory = join(sessionDir, "codex-bridges");
  await privateDirectory(userData); await privateDirectory(settlementDirectory);
  const guardSettlement = await codexDirectoryGuard(settlementDirectory, true);
  const release = await desktopLease(join(sessionDir, "launch.sqlite"));
  const authHome = join(stateDir, "auth"), authPath = join(authHome, "auth.json");
  let released = false, guardAuth: (() => Promise<void>) | undefined, guardAuthFile: (() => Promise<void>) | undefined;
  const assertSettled = async () => {
    try { await guardSettlement(); if ((await readdir(settlementDirectory)).length) throw new HarnessSettlementError(); }
    catch { throw new HarnessSettlementError(); }
  };
  let authRetained = false;
  const retainAuth = async (): Promise<never> => {
    try {
      if (!authRetained) {
        await guardSettlement();
        await writeFile(join(settlementDirectory, `${crypto.randomUUID()}.pending`), JSON.stringify({ schema: 1, reason: "auth-changed", authHome }) + "\n", { mode: 0o600, flag: "wx" });
        authRetained = true;
      }
    } finally { throw new HarnessSettlementError(); }
  };
  const assertAuthOwned = async () => {
    if (!guardAuth) return;
    try {
      await guardAuth();
      const names = await readdir(authHome);
      if (names.length > 1 || names.length === 1 && names[0] !== "auth.json") throw new HarnessSettlementError();
      if (names.length) await guardAuthFile?.();
    } catch { await retainAuth(); }
  };
  const cleanup = async () => {
    if (released) return;
    try { await assertSettled(); await assertAuthOwned(); }
    catch (error) { try { await native.closeTransport?.(); } finally { throw error; } }
    // A successful cleanup may remove only this invocation's unchanged auth.
    if (guardAuth) await rm(authPath, { force: true });
    released = true; release();
  };
  try {
    await assertSettled();
    const settings: string[] = [];
    for (let i = 0; i < native.args.length; i += 2) {
      if (native.args[i] !== "-c" || typeof native.args[i + 1] !== "string")
        throw new Fault(400, "desktop_arguments", "Desktop launches accept provider/model settings, not native CLI commands.");
      if (!native.args[i + 1].startsWith("sqlite_home=")) settings.push(native.args[i + 1]);
    }
    settings.push('cli_auth_credentials_store="file"', 'forced_login_method="api"', `sqlite_home=${JSON.stringify(state.sqliteHome)}`);
    if (!settings.some(setting => setting.startsWith("approval_policy="))) settings.push('approval_policy="on-request"');
    if (!settings.some(setting => setting.startsWith("sandbox_mode="))) settings.push('sandbox_mode="workspace-write"');
    const key = native.env.SWITCHER_HARNESS_API_KEY;
    if (!key) throw new Fault(500, "desktop_auth_missing", "Desktop preparation did not receive a scoped gateway credential.");
    await mkdir(authHome, { mode: 0o700 });
    guardAuth = await codexDirectoryGuard(authHome, true);
    const authText = JSON.stringify({ OPENAI_API_KEY: key }) + "\n";
    await writeFile(authPath, authText, { mode: 0o600, flag: "wx" });
    guardAuthFile = await codexFileGuard(authPath, 64 * 1024, digest(authText));
    const binding: CodexDesktopBinding = {
      schema: 1, nativeExecutable: accepted.native.executable, canonical: accepted.snapshot,
      authHome, authIdentity: await directoryIdentity(authHome), authSha256: digest(authText),
      sessionDir, settlementDirectory, args: settings.flatMap(setting => ["-c", setting]),
    };
    const bindingPath = join(stateDir, "desktop-binding.json"), bindingText = JSON.stringify(binding) + "\n";
    await writeFile(bindingPath, bindingText, { mode: 0o600, flag: "wx" });
    const guardBinding = await codexFileGuard(bindingPath, 1024 * 1024, digest(bindingText));
    const entry = fileURLToPath(new URL(import.meta.url.endsWith(".ts") ? "./codex-state-bridge.ts" : "../codex-state-bridge.js", import.meta.url));
    const wrapper = join(stateDir, "chatgpt-codex");
    await writeFile(wrapper, `#!/bin/sh\nset -eu\nexec ${[process.execPath, entry, "--desktop", bindingPath, digest(bindingText), "--"].map(quote).join(" ")} "$@"\n`, { mode: 0o700, flag: "wx" });
    const guardWrapper = await codexFileGuard(wrapper, 64 * 1024, undefined, true);
    return { ...native, executable: app.executable, args: [`--user-data-dir=${userData}`],
      env: { ...native.env, ...nativeStateEnvironment(state), CODEX_HOME: state.home, CODEX_ELECTRON_USER_DATA_PATH: userData,
        CODEX_CLI_PATH: wrapper, CODEX_APP_SERVER_FORCE_CLI: "1", CODEX_APP_SERVER_USE_LOCAL_DAEMON: "0" },
      configPaths: [...native.configPaths, bindingPath, wrapper],
      warnings: [...native.warnings, "ChatGPT uses shared native conversations and skills with this launch's private credential home. Local Codex conversations use the selected provider; cloud Chat/Work and account-only features are not redirected. Keep Switcher running until you quit this instance."],
      beforeLaunch: async () => { await native.beforeLaunch?.(); await accepted.guard(); await guardAuth!(); await guardAuthFile!(); await guardBinding(); await guardWrapper(); },
      cleanup: async () => {
        try { await assertSettled(); await assertAuthOwned(); }
        catch (error) { try { await native.closeTransport?.(); } finally { throw error; } }
        try { await native.cleanup?.(); } finally { await cleanup(); }
      },
    };
  } catch (error) {
    if (error instanceof HarnessSettlementError && !guardAuth) { released = true; release(); try { await native.closeTransport?.(); } finally { throw error; } }
    await cleanup(); throw error;
  }
}
