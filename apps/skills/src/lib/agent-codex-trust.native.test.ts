import { useDefaultTestTimeout } from "../test-preload.js";
useDefaultTestTimeout();
import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { applyAgentIntegration, planAgentIntegration } from "./agent-integration.js";
import { enrollCodexNativeHooks } from "./agent-codex-trust.js";
import { connectCodexHookRpc } from "./codex-hook-rpc.js";

// Explicit opt-in uses an installed, reviewed native binary. The test creates
// only synthetic homes and an unauthenticated provider that cannot serve turns.
const binary = process.env.SKILLS_TEST_CODEX_COMMAND;
for (const initial of ["trusted", "modified", "untrusted", "stale", "tampered"] as const) test.skipIf(!binary)(`native Codex ${["stale", "tampered"].includes(initial) ? "refuses " + initial + " enrollment" : "enrolls " + initial + " exact hooks and reloads its existing thread"}`, async () => {
  const home = mkdtempSync(join(tmpdir(), "skills-native-enroll-")), priorPath = process.env.PATH;
  const codexHome = join(home, ".codex"), dataDir = join(home, ".hasna/skills"), pkg = join(home, "package");
  const command = join(home, "bin/skills"), cli = join(pkg, "bin/index.js"), configPath = join(codexHome, "config.toml"), events = join(home, "events");
  let rpc: Awaited<ReturnType<typeof connectCodexHookRpc>> | undefined;
  const record = (result: Record<string, unknown>) => {
    const target = process.env.SKILLS_NATIVE_TEST_RECEIPT_DIR;
    if (target) writeFileSync(join(target, `${rpc!.version.replaceAll(" ", "-")}-${initial}.json`), JSON.stringify({ case: initial, passed: true, binary, nativeVersion: rpc!.version, ownedNativeProcessId: rpc!.processId, syntheticHome: home, liveConfigWrites: 0, existingProcessRestarts: 0, ...result }, null, 2) + "\n", { mode: 0o600 });
  };
  try {
    for (const path of [codexHome, join(pkg, "bin"), join(home, "bin")]) mkdirSync(path, { recursive: true, mode: 0o700 });
    writeFileSync(cli, `#!/usr/bin/env bun\nimport { appendFileSync } from 'node:fs';\nconst event = process.argv.at(-1);\nappendFileSync(${JSON.stringify(events)}, event + '\\n');\nif (event === 'UserPromptSubmit') { console.error('Synthetic hook blocks model requests.'); process.exit(2); }\nconsole.log('{}');\n`, { mode: 0o700 });
    writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "@hasna/skills", version: "0.8.9", bin: { skills: "bin/index.js" } }), { mode: 0o600 });
    symlinkSync(cli, command); process.env.PATH = join(home, "bin") + ":" + priorPath;
    writeFileSync(configPath, '# preserve native fixture comment\nmodel = "synthetic"\nmodel_provider = "fixture"\n[model_providers.fixture]\nname = "Synthetic unauthenticated provider"\nbase_url = "https://native-enrollment.invalid/v1"\nwire_api = "responses"\nrequires_openai_auth = false\n', { mode: 0o600 });
    applyAgentIntegration(planAgentIntegration({ home, dataDir, agents: ["codex"], command, profileId: "synthetic" }));
    const hooksPath = join(codexHome, "hooks.json"), hooks = JSON.parse(readFileSync(hooksPath, "utf8"));
    hooks.hooks.Stop = [{ hooks: [{ type: "command", command: "true", timeout: 5 }] }];
    writeFileSync(hooksPath, JSON.stringify(hooks));
    const reviewedSkillsCli = { path: command, version: "0.8.9", sha256: createHash("sha256").update(readFileSync(cli)).digest("hex") };
    rpc = await connectCodexHookRpc({ command: binary!, home, codexHome });
    const listed = (await rpc.request("hooks/list", { cwds: [home] })).data[0].hooks;
    expect(listed).toHaveLength(4); await rpc.close(); rpc = undefined;
    const base = readFileSync(configPath, "utf8");
    writeFileSync(configPath, base + '\n[hooks.state."synthetic-unrelated"]\nenabled = false # preserve unrelated disabled trust\ntrusted_hash = "sha256:unrelated"\n' + (initial === "untrusted" ? "" : listed.map((h: any) => `\n[hooks.state.${JSON.stringify(h.key)}]\nenabled = false # preserve managed comment\ntrusted_hash = ${JSON.stringify(initial === "modified" || h.eventName === "stop" ? `sha256:${"0".repeat(64)}` : h.currentHash)}\n`).join("")));
    chmodSync(configPath, 0o600);
    rpc = await connectCodexHookRpc({ command: binary!, home, codexHome });
    const shared = async () => ({ version: rpc!.version, processId: rpc!.processId, request(method: string, params: any) {
      return rpc!.request(method, initial === "stale" && method === "config/batchWrite" ? { ...params, expectedVersion: `sha256:${"0".repeat(64)}` } : params);
    }, async close() {} });
    const plan = await enrollCodexNativeHooks({ home, dataDir, reviewedSkillsCli }, shared);
    expect(plan.planned).toHaveLength(3); expect(plan.planned.every(h => h.trustStatus === (["stale", "tampered"].includes(initial) ? "trusted" : initial))).toBe(true);
    const before = readFileSync(configPath, "utf8");
    if (initial === "stale" || initial === "tampered") {
      if (initial === "tampered") {
        hooks.hooks.UserPromptSubmit[0].hooks[0].command += " --unreviewed";
        writeFileSync(hooksPath, JSON.stringify(hooks));
      }
      await expect(enrollCodexNativeHooks({ home, dataDir, reviewedSkillsCli, apply: true, reviewedPlanDigest: plan.planDigest }, shared)).rejects.toThrow(initial === "stale" ? "NATIVE_WRITE_FAILED" : "CODEX_HOOK_TRUST");
      expect(readFileSync(configPath, "utf8")).toBe(before); expect(existsSync(events)).toBe(false);
      record({ refused: true, configUnchanged: true, nativeHookExecuted: false });
      return;
    }
    // An already-created thread is refreshed only in this same app-server.
    const thread = await rpc.request("thread/start", { cwd: home, ephemeral: true, approvalPolicy: "never", sandbox: "read-only" });
    expect(existsSync(events)).toBe(false);
    const receipt = await enrollCodexNativeHooks({ home, dataDir, reviewedSkillsCli, apply: true, reviewedPlanDigest: plan.planDigest }, shared);
    expect(receipt.applied).toBe(true); expect(receipt.existingSessionsReloaded).toBe(false);
    expect(readFileSync(configPath, "utf8")).not.toBe(before);
    expect(readFileSync(configPath, "utf8")).toContain('# preserve native fixture comment');
    expect(readFileSync(configPath, "utf8")).toContain('enabled = false # preserve unrelated disabled trust');
    expect((await enrollCodexNativeHooks({ home, dataDir, reviewedSkillsCli }, shared)).planned).toHaveLength(0);
    await rpc.request("turn/start", { threadId: thread.thread.id, input: [{ type: "text", text: "Synthetic hook execution proof." }] });
    for (let i = 0; i < 60 && (!existsSync(events) || !readFileSync(events, "utf8").includes("UserPromptSubmit")); i++) await Bun.sleep(50);
    expect(readFileSync(events, "utf8")).toContain("UserPromptSubmit");
    record({ receipt, existingThreadNativeHookExecuted: true, unrelatedStateAndCommentsPreserved: true, secondPlanEmpty: true });
  } finally { await rpc?.close(); process.env.PATH = priorPath; if (process.env.SKILLS_KEEP_NATIVE_FIXTURE) console.error("Synthetic fixture:", home); else rmSync(home, { recursive: true, force: true }); }
}, 30000);
