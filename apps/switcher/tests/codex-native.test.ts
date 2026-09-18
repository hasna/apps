import { afterEach, expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { codexConfigGuard, codexInstallationAccountHome, inspectCodexNative, verifyCodexInstallation } from "../src/codex-native";
import { launch } from "../src/launcher";
import * as processes from "../src/harness-process";
import * as discovery from "../src/codex-session-discovery";
import * as harnesses from "../src/harnesses";
import { assertHarnessArguments } from "../src/harness-arguments";
import { mockCodexNative } from "./fixtures/codex-native";
import type { SwitcherClient } from "../src/sdk";

const cleanup: Array<() => Promise<unknown> | void> = [];
afterEach(async () => { for (const operation of cleanup.splice(0).reverse()) await operation(); });
const digest = (bytes: string) => createHash("sha256").update(bytes).digest("hex");
async function directory() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "switcher-native-binding-")));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("native release file verification refuses wrong bytes, links, modes and later replacement", async () => {
  const root = await directory(), binary = "#!/bin/sh\nexit 0\n", manifest = "fixture manifest\n", evidence = "fixture evidence\n";
  const bin = join(root, "codex-subscriptions-candidate");
  await writeFile(bin, binary, { mode: 0o700 });
  await writeFile(join(root, "patch-manifest.json"), manifest, { mode: 0o600 });
  await writeFile(join(root, "release-evidence.json"), evidence, { mode: 0o600 });
  const pin = { target: "fixture", binarySha256: digest(binary), binaryBytes: Buffer.byteLength(binary), patchManifestSha256: digest(manifest), evidenceSha256: digest(evidence) };
  await expect(verifyCodexInstallation(root, {...pin, evidenceSha256: "0".repeat(64)})).rejects.toMatchObject({ code: "codex_native_unverified" });
  const accepted = await verifyCodexInstallation(root, pin);
  expect(accepted.executable).toBe(bin);
  await accepted.guard();
  await rename(bin, bin + ".old"); await writeFile(bin, binary, { mode: 0o700 });
  await expect(accepted.guard()).rejects.toMatchObject({ code: "codex_native_unverified" });
  await rm(bin); await symlink(bin + ".old", bin);
  await expect(verifyCodexInstallation(root, pin)).rejects.toMatchObject({ code: "codex_native_unverified" });
  await rm(bin); await rename(bin + ".old", bin); await chmod(bin, 0o722);
  await expect(verifyCodexInstallation(root, pin)).rejects.toMatchObject({ code: "codex_native_unverified" });
  await chmod(bin, 0o700); await chmod(root, 0o755);
  await expect(verifyCodexInstallation(root, pin)).rejects.toMatchObject({ code: "codex_native_unverified" });
});

test.skipIf(!["darwin", "linux"].includes(process.platform))("installation authority ignores HOME and rejects caller-selected binaries", async () => {
  const baseline = await codexInstallationAccountHome(), prior = process.env.HOME;
  try {
    process.env.HOME = await directory();
    expect(await codexInstallationAccountHome()).toBe(baseline);
    await expect(inspectCodexNative(join(process.env.HOME, "unreviewed-codex"))).rejects.toMatchObject({ code: "codex_native_unverified" });
  } finally { if (prior === undefined) delete process.env.HOME; else process.env.HOME = prior; }
});

test("canonical config presence and content remain bound across preparation", async () => {
  const root = await directory(), path = join(root, "config.toml");
  const absent = await codexConfigGuard(root);
  await writeFile(path, 'notify=["retained"]\n', { mode: 0o600 });
  await expect(absent()).rejects.toMatchObject({ code: "codex_native_unverified" });
  const existing = await codexConfigGuard(root);
  await writeFile(path, 'notify=["changed"]\n');
  await expect(existing()).rejects.toMatchObject({ code: "codex_native_unverified" });
});

test("owned auth/config selectors are refused without misreading option values or literal prompts", () => {
  for (const args of [["--auth-home", "/other"], ["--auth-home=/other"], ["exec", "--daemon"], ["app"], ["app-server", "proxy"], ["app-server", "-c", "notify=[]", "proxy"], ["cloud"], ["agents"]])
    expect(() => assertHarnessArguments("codex", args)).toThrow("reserved");
  for (const key of ["auth_home", '"auth_home"', "cli_auth_credentials_store", "sqlite_home", "profile", "profiles.named", "include"])
    for (const args of [["exec", "-c", `${key}="other"`], ["--config=" + `${key}="other"`]])
      expect(() => assertHarnessArguments("codex", args)).toThrow("reserved");
  for (const args of [["--output-last-message", "--auth-home", "exec", "--", "--daemon"], ["exec", "--", "app", "--auth-home", "literal"], ["--color", "cloud", "exec", "prompt"]])
    expect(() => assertHarnessArguments("codex", args)).not.toThrow();
});

async function launchFixture() {
  const f = await mockCodexNative(); cleanup.push(f.cleanup);
  const executable = join(f.root, "fake-codex"), log = join(f.root, "runs.jsonl");
  await writeFile(executable, `#!${process.execPath}\nimport {appendFileSync,existsSync,readdirSync,readFileSync,writeFileSync} from "node:fs";import {join} from "node:path";
const args=process.argv.slice(2),home=process.env.CODEX_HOME,auth=args[args.indexOf("--auth-home")+1];
const history=join(home,"fixture-history");const prior=existsSync(history)?readFileSync(history,"utf8"):"";
appendFileSync(${JSON.stringify(log)},JSON.stringify({args,home,auth,authEntries:readdirSync(auth),prior,ambient:!!process.env.OPENAI_API_KEY})+"\\n");
writeFileSync(history,prior+"continuation\\n");\n`, { mode: 0o700 });
  const records: unknown[] = [];
  const client = { getProfile: async () => ({ harness: "codex", providerId: "fixture" }),
    launchPlan: async () => ({ profile: { harness: "codex", model: "fixture-model" }, provider: { baseUrl: "http://127.0.0.1:1", protocol: "openai-responses" }, catalog: { models: [{ id: "fixture-model", name: "Fixture" }] }, warnings: [] }),
    createRun: async () => ({ id: "fixture", version: 1 }), finishRun: async (_id: string, _version: number, value: unknown) => { records.push(value); },
  } as unknown as SwitcherClient;
  const options = { executable, cwd: f.root, stateDir: join(f.root, "state"), refresh: false, args: ["exec", "resume", "fixture-session", "--", "literal --auth-home"] };
  return { ...f, executable, log, client, options, records };
}

test("direct Codex launches share canonical history while each private auth-only root is distinct and cleaned", async () => {
  const f = await launchFixture();
  await writeFile(join(f.corpus, "config.toml"), 'notify=["keep-notify"]\n', { mode: 0o600 });
  await writeFile(join(f.corpus, "auth.json"), "canonical auth sentinel", { mode: 0o600 });
  for (let i = 0; i < 2; i++) expect(await launch(f.client, "fixture", f.options)).toBe(0);
  const [a, b] = (await readFile(f.log, "utf8")).trim().split("\n").map(line => JSON.parse(line));
  expect(a.home).toBe(f.corpus); expect(b.home).toBe(f.corpus); expect(a.auth).not.toBe(b.auth);
  expect(a.authEntries).toEqual([]); expect(b.authEntries).toEqual([]);
  expect(a.prior).toBe(""); expect(b.prior).toBe("continuation\n");
  expect(a.args.slice(0, 4)).toEqual(["--auth-home", a.auth, "-c", 'cli_auth_credentials_store="file"']);
  expect(b.args.slice(-f.options.args.length)).toEqual(f.options.args);
  expect(a.ambient).toBe(false);
  expect(await readFile(join(f.corpus, "config.toml"), "utf8")).toBe('notify=["keep-notify"]\n');
  expect(await readFile(join(f.corpus, "auth.json"), "utf8")).toBe("canonical auth sentinel");
  expect(await readdir(f.options.stateDir)).toEqual([]);
});

test("installation refusal occurs before provider credentials or launch state creation", async () => {
  const f = await launchFixture(); let credentials = 0;
  f.binding.mockImplementation(async () => { throw new Error("fixture installation refused"); });
  await expect(launch(f.client, "fixture", {...f.options, resolveCredential: async () => { credentials++; return "synthetic"; }})).rejects.toThrow("fixture installation refused");
  expect(credentials).toBe(0); expect(await Bun.file(f.log).exists()).toBe(false);
  expect(await readdir(f.options.stateDir).catch(() => [])).toEqual([]);
});

test("native guard drift after asynchronous run registration prevents child launch", async () => {
  const f = await launchFixture();
  f.client.createRun = async () => { await writeFile(f.executable, "changed fixture bytes\n"); return { id: "fixture", version: 1 } as any; };
  await expect(launch(f.client, "fixture", f.options)).rejects.toMatchObject({ code: "codex_native_unverified" });
  expect(await Bun.file(f.log).exists()).toBe(false);
  expect(await readdir(f.options.stateDir)).toEqual([]);
});

test.each(["thread_history_1.sqlite", "session_index.jsonl", "sessions"])("old private %s refuses fresh-auth bypass without touching files", async name => {
  const f = await launchFixture(), previous = join(f.root, "old-account");
  await mkdir(previous, { mode: 0o700 });
  if (name === "sessions") await mkdir(join(previous, name), { mode: 0o700 });
  else await writeFile(join(previous, name), "retained", { mode: 0o600 });
  process.env.CODEX_HOME = previous;
  await expect(launch(f.client, "fixture", f.options)).rejects.toMatchObject({ code: "native_state_migration_required" });
  expect(await readdir(previous)).toEqual([name]); expect(f.binding).not.toHaveBeenCalled();
  expect(await Bun.file(f.log).exists()).toBe(false);
});

test.each(["harness", "discovery"])("uncertain %s settlement closes the gateway but retains the private launch files", async phase => {
  const f = await launchFixture();
  const prepare = harnesses.prepareHarnessLaunch;
  let closed = 0; let gateway = ""; let catalog = "";
  const prepared = spyOn(harnesses, "prepareHarnessLaunch").mockImplementation(async input => {
    const result = await prepare(input);
    const base = result.args.find(arg => arg.startsWith("model_providers.switcher="));
    gateway = (Bun.TOML.parse(base!) as any).model_providers.switcher.base_url;
    catalog = result.configPaths.find(path => path.includes("switcher-model-policy-"))!;
    expect((await fetch(gateway)).status).toBeGreaterThanOrEqual(400);
    return {...result, closeTransport: async () => { closed++; await result.closeTransport?.(); }};
  });
  cleanup.push(() => prepared.mockRestore());
  if (phase === "discovery") f.options.args = ["resume", "--last"];
  const runner = phase === "discovery"
    ? spyOn(discovery, "listCodexSessions").mockRejectedValue(new processes.HarnessSettlementError())
    : spyOn(processes, "runHarnessProcess").mockRejectedValue(new processes.HarnessSettlementError());
  cleanup.push(() => runner.mockRestore());
  await expect(launch(f.client, "fixture", f.options)).rejects.toBeInstanceOf(processes.HarnessSettlementError);
  const entries = await readdir(f.options.stateDir);
  expect(entries).toHaveLength(1);
  expect(closed).toBe(1);
  await expect(fetch(gateway)).rejects.toThrow();
  expect(await Bun.file(catalog).exists()).toBe(true);
  expect(await readdir(join(f.options.stateDir, entries[0], "auth"))).toEqual([]);
  expect(await Bun.file(f.log).exists()).toBe(false);
});

test("a signal during awaited native admission prevents any child spawn", async () => {
  const root = await directory();
  await expect(processes.runHarnessProcess({ executable: join(root, "must-not-start"), args: [], cwd: root, env: {},
    beforeSpawn: async () => { process.emit("SIGTERM"); await Promise.resolve(); },
  })).rejects.toMatchObject({ code: "interrupted", exitCode: 143 });
});

test("group settlement waits after KILL and refuses uncertainty instead of treating signalling as exit", async () => {
  const signals: string[] = []; let alive = true;
  await processes.settleHarnessGroup({ exists: () => alive, signal: signal => { signals.push(signal); if (signal === "SIGKILL") setTimeout(() => { alive = false; }, 1); } }, 5);
  expect(signals).toEqual(["SIGTERM", "SIGKILL"]); expect(alive).toBe(false);
  await expect(processes.settleHarnessGroup({ exists: () => true, signal() {} }, 1)).rejects.toBeInstanceOf(processes.HarnessSettlementError);
});
