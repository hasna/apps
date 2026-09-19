import { lstatSync, mkdirSync, readdirSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { isDeepStrictEqual } from "node:util";
import { getDataDirReadOnly } from "./config.js";
import { parseManagedSkillPolicy } from "./managed-policy.js";
import { assertManagedAgentBridge } from "./agent-integration.js";
import { renderAgentHookCommand } from "./agent-adapters.js";
import { connectCodexHookRpc, SUPPORTED_CODEX_HOOK_VERSIONS, type CodexHookRpc } from "./codex-hook-rpc.js";
import { codexTrustTextWitness } from "./codex-hook-trust-layout.js";
import { need, snapshot, unchanged, save } from "./codex-hook-trust-files.js";
import { bindSkillsCli, type ReviewedSkillsCli } from "./codex-hook-trust-identity.js";

export interface CodexNativeHookTrustOptions { home?: string; dataDir?: string; codexCommand?: string; apply?: boolean; reviewedPlanDigest?: string; reviewedSkillsCli?: ReviewedSkillsCli }
export interface CodexNativeHookReconcileOptions { home?: string; dataDir?: string; codexCommand?: string; journal: string; reviewedSkillsCli?: ReviewedSkillsCli }
type Connect = typeof connectCodexHookRpc;
const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n";
const structure = (text: string) => JSON.parse(JSON.stringify(Bun.TOML.parse(text)));
const eventNames = { UserPromptSubmit: ["userPromptSubmit", "user_prompt_submit"], SessionStart: ["sessionStart", "session_start"], SubagentStart: ["subagentStart", "subagent_start"] } as const;
const makePlanDigest = (value: unknown) => createHash("sha256").update(json(value)).digest("hex");
const safeNativeHook = (hook: any) => ({ key: hook.key, eventName: hook.eventName, handlerType: hook.handlerType, command: hook.command, matcher: hook.matcher, timeoutSec: hook.timeoutSec, async: hook.async, statusMessage: hook.statusMessage, additionalContextLimit: hook.additionalContextLimit, sourcePath: hook.sourcePath, source: hook.source, pluginId: hook.pluginId, isManaged: hook.isManaged, currentHash: hook.currentHash, enabled: hook.enabled, trustStatus: hook.trustStatus });

/** Resolve an interrupted native write only after the native consumer and every
 * captured pre-write input agree. This never writes Codex state; it records a
 * receipt for an already-effective operation so the ordinary apply guard can
 * stop refusing the same journal. */
export async function reconcileCodexNativeHooks(options: CodexNativeHookReconcileOptions, connect: Connect = connectCodexHookRpc) {
  let rpc: CodexHookRpc | undefined;
  try {
    const home = resolve(options.home ?? homedir()), dataDir = resolve(options.dataDir ?? getDataDirReadOnly());
    const parent = resolve(join(dataDir, "native-hook-trust")), journal = resolve(options.journal);
    need(journal.startsWith(parent + "/") && /^[a-f0-9-]{36}$/.test(journal.slice(parent.length + 1)), "RECONCILE_JOURNAL_PATH");
    const dir = lstatSync(journal, { throwIfNoEntry: false });
    need(!!dir && dir.isDirectory() && !dir.isSymbolicLink() && dir.uid === process.getuid!() && (dir.mode & 0o777) === 0o700, "UNSAFE_JOURNAL");
    need(!lstatSync(join(journal, "receipt.json"), { throwIfNoEntry: false }), "RECONCILE_ALREADY_COMPLETE");
    need(lstatSync(join(journal, "stopped.json"), { throwIfNoEntry: false })?.isFile(), "RECONCILE_JOURNAL_INCOMPLETE");
    const stoppedFile = snapshot(join(journal, "stopped.json"), true);
    const intentFile = snapshot(join(journal, "intent.json"), true), intent: any = JSON.parse(intentFile.text);
    need(intent.version === 1 && /^[a-f0-9]{64}$/.test(intent.planDigest) && typeof intent.home === "string" && intent.home === home && typeof intent.configPath === "string" && /^[a-f0-9]{64}$/.test(intent.configSha256) && typeof intent.configVersion === "string" && /^[a-f0-9]{64}$/.test(intent.policySha256) && /^[a-f0-9]{64}$/.test(intent.hooksSha256) && Array.isArray(intent.declarations) && Array.isArray(intent.admitted) && Array.isArray(intent.nativeHooks) && Array.isArray(intent.hooks) && intent.hooks.length > 0 && intent.hooks.length <= 100, "RECONCILE_INTENT_INVALID");
    const digestInput = { version: 1, home: intent.home, configPath: intent.configPath, configSha256: intent.configSha256, configVersion: intent.configVersion, policySha256: intent.policySha256, hooksSha256: intent.hooksSha256, skillsCli: intent.skillsCli, nativeVersion: intent.nativeVersion, declarations: intent.declarations, admitted: intent.admitted };
    need(makePlanDigest(digestInput) === intent.planDigest, "RECONCILE_PLAN_CHANGED");
    need(isDeepStrictEqual(intent.hooks, intent.admitted.filter((hook: any) => !hook.enabled || hook.trustStatus !== "trusted")), "RECONCILE_INTENT_HOOKS_CHANGED");
    const configBefore = snapshot(join(journal, "config.before.toml"), true), hooksBefore = snapshot(join(journal, "hooks.before.json"), true), policyBefore = snapshot(join(journal, "policy.before.json"), true);
    need(configBefore.sha256 === intent.beforeSha256 && hooksBefore.sha256 === intent.hooksSha256 && policyBefore.sha256 === intent.policySha256, "RECONCILE_JOURNAL_CHANGED");
    const currentConfig = snapshot(intent.configPath, true);
    need(codexTrustTextWitness(configBefore.text, intent.hooks.map((h: any) => h.key)) === codexTrustTextWitness(currentConfig.text, intent.hooks.map((h: any) => h.key)), "RECONCILE_UNRELATED_CONFIG_CHANGED");
    const before = structure(configBefore.text), current = structure(currentConfig.text), expectedConfig = structuredClone(before);
    expectedConfig.hooks ??= {}; expectedConfig.hooks.state ??= {};
    for (const hook of intent.hooks) expectedConfig.hooks.state[hook.key] = { ...expectedConfig.hooks.state[hook.key], enabled: true, trusted_hash: hook.currentHash };
    need(isDeepStrictEqual(expectedConfig, current), "RECONCILE_CONFIG_DRIFT");
    const policyCurrent = snapshot(join(dataDir, "agent-policy.json"), true);
    need(policyCurrent.sha256 === policyBefore.sha256, "RECONCILE_POLICY_CHANGED");
    const policy = parseManagedSkillPolicy(policyBefore.text), binding = policy.bridge;
    assertManagedAgentBridge("codex", { home, dataDir, projectDir: home });
    const skillsCli = bindSkillsCli(binding.commands.codex, options.reviewedSkillsCli);
    need(isDeepStrictEqual(skillsCli.receipt, intent.skillsCli), "RECONCILE_SKILLS_BINDING_CHANGED");
    const alias = binding.rootAliases?.find((item: any) => item.agent === "codex"), codexHome = alias?.target ?? join(home, ".codex"), hooksPath = join(codexHome, "hooks.json");
    need(resolve(intent.configPath) === resolve(join(codexHome, "config.toml")), "RECONCILE_CONFIG_PATH_CHANGED");
    const hooksCurrent = snapshot(hooksPath);
    need(hooksCurrent.sha256 === intent.hooksSha256 || hooksCurrent.sha256 === hooksBefore.sha256, "RECONCILE_HOOKS_CHANGED");
    rpc = await connect({ command: options.codexCommand ?? "codex", home, codexHome });
    need(rpc.version === intent.nativeVersion, "RECONCILE_NATIVE_VERSION_CHANGED");
    const discovered = await rpc.request("hooks/list", { cwds: [home] });
    need(Array.isArray(discovered?.data) && discovered.data.length === 1 && discovered.data[0].cwd === home && !discovered.data[0].errors?.length && !discovered.data[0].warnings?.length, "RECONCILE_NATIVE_DISCOVERY_REFUSED");
    const nativeHooks = discovered.data[0].hooks as any[];
    need(nativeHooks.length === intent.nativeHooks.length, "RECONCILE_NATIVE_HOOK_LIST_CHANGED");
    const plannedKeys = new Set(intent.hooks.map((hook: any) => hook.key));
    for (const expected of intent.nativeHooks) {
      const matches = nativeHooks.filter((hook: any) => hook.key === expected.key);
      need(matches.length === 1, "RECONCILE_NATIVE_HOOK_LIST_CHANGED");
      const actual = safeNativeHook(matches[0]);
      const stable = (hook: any) => { const { enabled, trustStatus, ...identity } = hook; return identity; };
      need(isDeepStrictEqual(stable(actual), stable(expected)), "RECONCILE_NATIVE_IDENTITY_CHANGED");
      if (!plannedKeys.has(expected.key)) need(isDeepStrictEqual(actual, expected), "RECONCILE_UNRELATED_HOOK_CHANGED");
    }
    for (const wanted of intent.hooks) {
      const matches = nativeHooks.filter((h: any) => h.key === wanted.key || h.key === wanted.key.replace(join(home, ".codex/hooks.json"), hooksPath));
      need(matches.length === 1, "RECONCILE_NATIVE_IDENTITY_CHANGED");
      const h = matches[0];
      need(h.enabled === true && h.trustStatus === "trusted" && h.currentHash === wanted.currentHash, "RECONCILE_NATIVE_STATE_INCOMPLETE");
    }
    const config = await rpc.request("config/read", { includeLayers: true, cwd: home });
    const layers = config?.layers?.filter((layer: any) => layer.name?.type === "user" && layer.name.file === intent.configPath && !layer.name.profile);
    need(layers?.length === 1 && !layers[0].disabledReason && isDeepStrictEqual(layers[0].config, current), "RECONCILE_NATIVE_CONFIG_MISMATCH");
    const finalDiscovery = await rpc.request("hooks/list", { cwds: [home] });
    need(Array.isArray(finalDiscovery?.data) && finalDiscovery.data.length === 1 && finalDiscovery.data[0].cwd === home && !finalDiscovery.data[0].errors?.length && !finalDiscovery.data[0].warnings?.length && isDeepStrictEqual((finalDiscovery.data[0].hooks as any[]).map(safeNativeHook), nativeHooks.map(safeNativeHook)), "RECONCILE_NATIVE_STATE_CHANGED");
    const finalConfig = await rpc.request("config/read", { includeLayers: true, cwd: home });
    const finalLayers = finalConfig?.layers?.filter((layer: any) => layer.name?.type === "user" && layer.name.file === intent.configPath && !layer.name.profile);
    need(finalLayers?.length === 1 && isDeepStrictEqual(finalLayers[0].config, current), "RECONCILE_NATIVE_CONFIG_CHANGED");
    unchanged(stoppedFile); unchanged(intentFile); unchanged(configBefore); unchanged(hooksBefore); unchanged(policyBefore); unchanged(policyCurrent); unchanged(hooksCurrent); unchanged(currentConfig); skillsCli.recheck(); assertManagedAgentBridge("codex", { home, dataDir, projectDir: home });
    const receipt = { version: 1, status: "reconciled", reconciled: true, automaticRollback: false, journal, planDigest: intent.planDigest, nativeVersion: rpc.version, nativeStateVerified: true, nativeExecutionVerified: false, configSha256: currentConfig.sha256, hooksSha256: hooksCurrent.sha256, policySha256: policyBefore.sha256, skillsCli: skillsCli.receipt, unrelatedSettingsAndCommentsPreserved: true };
    save(join(journal, "receipt.json"), json(receipt));
    return receipt;
  } catch (error) {
    const message = error instanceof Error && error.message.startsWith("CODEX_HOOK_TRUST_") ? error.message : "CODEX_HOOK_TRUST_RECONCILE_REFUSED";
    throw new Error(message);
  } finally { await rpc?.close(); }
}

/** Deliberately separate from filesystem hook installation: native trust is an
 * explicit authorization of exact owned commands, never a broad trust bypass. */
export async function enrollCodexNativeHooks(options: CodexNativeHookTrustOptions = {}, connect: Connect = connectCodexHookRpc) {
  let rpc: CodexHookRpc | undefined, journal: string | undefined;
  try {
    const home = resolve(options.home ?? homedir()), dataDir = resolve(options.dataDir ?? getDataDirReadOnly());
    assertManagedAgentBridge("codex", { home, dataDir, projectDir: home });
    const policyFile = snapshot(join(dataDir, "agent-policy.json"), true), policy = parseManagedSkillPolicy(policyFile.text);
    const binding = policy.bridge, alias = binding.rootAliases?.find((item: any) => item.agent === "codex");
    const skillsCli = bindSkillsCli(binding.commands.codex, options.reviewedSkillsCli);
    const codexHome = alias?.target ?? join(home, ".codex"), hooksPath = join(codexHome, "hooks.json"), configPath = join(codexHome, "config.toml");
    const hooksFile = snapshot(hooksPath), configFile = snapshot(configPath, true), original = structure(configFile.text);
    const declarations = JSON.parse(hooksFile.text).hooks, expected: Array<{ event: string; key: string; command: string }> = [];
    for (const [event, [nativeEvent, label]] of Object.entries(eventNames)) {
      const command = renderAgentHookCommand(binding.commands.codex, "codex", binding.profiles.codex, event);
      const groups = declarations[event]; need(Array.isArray(groups), "DECLARATION_CHANGED");
      const matches = groups.flatMap((group: any, gi: number) => (group.hooks ?? []).flatMap((entry: any, hi: number) => entry.command === command ? [{ group, entry, gi, hi }] : []));
      need(matches.length === 1 && isDeepStrictEqual(matches[0].group, { hooks: [{ type: "command", command, timeout: 15 }] }), "DECLARATION_CHANGED");
      expected.push({ event: nativeEvent, key: `${join(home, ".codex/hooks.json")}:${label}:${matches[0].gi}:${matches[0].hi}`, command });
    }
    codexTrustTextWitness(configFile.text, expected.map(h => h.key));
    rpc = await connect({ command: options.codexCommand ?? "codex", home, codexHome });
    need((SUPPORTED_CODEX_HOOK_VERSIONS as readonly string[]).includes(rpc.version), "NATIVE_UNSUPPORTED_VERSION");
    const list = async () => {
      const response = await rpc!.request("hooks/list", { cwds: [home] });
      need(Array.isArray(response?.data) && response.data.length === 1 && response.data[0].cwd === home && Array.isArray(response.data[0].hooks) && response.data[0].hooks.length <= 10000 && !response.data[0].errors?.length && !response.data[0].warnings?.length, "NATIVE_DISCOVERY_REFUSED");
      return response.data[0].hooks as any[];
    };
    const admit = (hooks: any[]) => expected.map(wanted => {
      // Native versions may use the canonical path or the admitted home alias.
      const canonicalKey = wanted.key.replace(join(home, ".codex/hooks.json"), hooksPath);
      const matches = hooks.filter(h => h.key === wanted.key || h.key === canonicalKey);
      need(matches.length === 1, "AMBIGUOUS_IDENTITY"); const h = matches[0];
      need(h.eventName === wanted.event && h.handlerType === "command" && h.command === wanted.command && h.matcher === null && h.timeoutSec === 15 && h.async === false && h.statusMessage === null && h.additionalContextLimit === null && [hooksPath, join(home, ".codex/hooks.json")].includes(h.sourcePath) && h.source === "user" && h.pluginId === null && h.isManaged === false && /^sha256:[a-f0-9]{64}$/.test(h.currentHash) && typeof h.enabled === "boolean", "NATIVE_IDENTITY_CHANGED");
      need(hooks.filter(other => other.command === wanted.command).length === 1, "AMBIGUOUS_IDENTITY");
      need(["trusted", "untrusted", "modified"].includes(h.trustStatus), "UNKNOWN_TRUST_STATUS");
      return { key: h.key, event: wanted.event, command: wanted.command, handlerType: h.handlerType, timeoutSec: h.timeoutSec, sourcePath: h.sourcePath, currentHash: h.currentHash, enabled: h.enabled, trustStatus: h.trustStatus };
    });
    const discovered = await list(), admitted = admit(discovered);
    const config = await rpc.request("config/read", { includeLayers: true, cwd: home });
    const layers = config?.layers?.filter((layer: any) => layer.name?.type === "user" && layer.name.file === configPath && !layer.name.profile);
    need(layers?.length === 1 && /^sha256:[a-f0-9]{64}$/.test(layers[0].version) && !layers[0].disabledReason && isDeepStrictEqual(layers[0].config, original), "NATIVE_CONFIG_MISMATCH");
    need(config.config && config.config.features?.hooks !== false, "NATIVE_HOOKS_DISABLED");
    need(config.layers.slice(0, config.layers.indexOf(layers[0])).every((layer: any) => layer.config?.hooks === undefined && layer.config?.features?.hooks === undefined), "NATIVE_CONFIG_OVERRIDDEN");
    const keys = admitted.map(h => h.key), planned = admitted.filter(h => !h.enabled || h.trustStatus !== "trusted");
    const preservationText = codexTrustTextWitness(configFile.text, keys);
    const checkInputs = () => { skillsCli.recheck(); assertManagedAgentBridge("codex", { home, dataDir, projectDir: home }); unchanged(policyFile); unchanged(hooksFile); unchanged(configFile); };
    checkInputs();
    const digestInput = { version: 1, home, configPath, configSha256: configFile.sha256, configVersion: layers[0].version, policySha256: policyFile.sha256, hooksSha256: hooksFile.sha256, skillsCli: skillsCli.receipt, nativeVersion: rpc.version, declarations: expected, admitted };
    const planDigest = makePlanDigest(digestInput);
    const baseReceipt = { planDigest, skillsCli: skillsCli.receipt, nativeVersion: rpc.version, ownedNativeProcessId: rpc.processId, agent: "codex", applied: false, planned, nativeEligible: planned.length === 0, transport: "owned-stdio-process", existingSessionsReloaded: false, nativeExecutionVerified: false };
    if (options.apply) need(options.reviewedPlanDigest === planDigest, "PLAN_CHANGED: run the dry-run again and pass its reviewed --plan-digest with --apply");
    const parent = join(dataDir, "native-hook-trust");
    const st = lstatSync(parent, { throwIfNoEntry: false });
    if (st) {
      need(st.isDirectory() && !st.isSymbolicLink() && st.uid === process.getuid!() && (st.mode & 0o777) === 0o700, "UNSAFE_JOURNAL");
      const priorJournals = readdirSync(parent); need(priorJournals.length < 1000, "JOURNAL_BOUND");
      for (const name of priorJournals) {
        need(/^[a-f0-9-]{36}$/.test(name), "UNSAFE_JOURNAL");
        need(lstatSync(join(parent, name, "receipt.json"), { throwIfNoEntry: false })?.isFile(), "RECONCILE_REQUIRED: inspect the incomplete private journal before applying again");
      }
    }
    if (!options.apply || !planned.length) return baseReceipt;
    if (!st) mkdirSync(parent, { mode: 0o700 });
    journal = join(parent, randomUUID()); mkdirSync(journal, { mode: 0o700 });
    save(join(journal, "config.before.toml"), configFile.bytes);
    save(join(journal, "hooks.before.json"), hooksFile.bytes);
    save(join(journal, "policy.before.json"), policyFile.bytes);
    save(join(journal, "intent.json"), json({ ...digestInput, planDigest, hooks: planned, nativeHooks: discovered.map(safeNativeHook) }));
    need(isDeepStrictEqual(admit(await list()), admitted), "NATIVE_DISCOVERY_CHANGED"); checkInputs();
    let result: any;
    try { result = await rpc.request("config/batchWrite", { edits: [{ keyPath: "hooks.state", value: Object.fromEntries(planned.map(h => [h.key, { enabled: true, trusted_hash: h.currentHash }])), mergeStrategy: "upsert" }], filePath: configPath, expectedVersion: layers[0].version, reloadUserConfig: true }); }
    catch { throw new Error("CODEX_HOOK_TRUST_NATIVE_WRITE_FAILED: reconcile the private journal before retrying"); }
    need(result?.status === "ok" && result.filePath === configPath && /^sha256:[a-f0-9]{64}$/.test(result.version), "NATIVE_WRITE_OVERRIDDEN");
    const after = snapshot(configPath, true), expectedConfig = structuredClone(original);
    expectedConfig.hooks ??= {}; expectedConfig.hooks.state ??= {};
    for (const h of planned) expectedConfig.hooks.state[h.key] = { ...expectedConfig.hooks.state[h.key], enabled: true, trusted_hash: h.currentHash };
    need(isDeepStrictEqual(structure(after.text), expectedConfig) && codexTrustTextWitness(after.text, keys) === preservationText, "PRESERVATION_FAILED");
    unchanged(policyFile); unchanged(hooksFile); assertManagedAgentBridge("codex", { home, dataDir, projectDir: home });
    const current = await list(), confirmed = admit(current);
    need(confirmed.every(h => h.enabled && h.trustStatus === "trusted") && isDeepStrictEqual(confirmed.map(h => [h.key, h.currentHash]), admitted.map(h => [h.key, h.currentHash])), "NATIVE_NOT_ELIGIBLE");
    need(isDeepStrictEqual(current.filter(h => !keys.includes(h.key)), discovered.filter(h => !keys.includes(h.key))), "UNRELATED_HOOK_CHANGED");
    unchanged(after); unchanged(hooksFile); unchanged(policyFile); skillsCli.recheck();
    const receipt = { ...baseReceipt, applied: true, nativeEligible: true, nativeConfigVersion: result.version, journal, beforeSha256: configFile.sha256, afterSha256: after.sha256, unrelatedSettingsAndCommentsPreserved: true };
    save(join(journal, "receipt.json"), json(receipt)); return receipt;
  } catch (error) {
    const message = error instanceof Error && error.message.startsWith("CODEX_HOOK_TRUST_") ? error.message : "CODEX_HOOK_TRUST_REFUSED: verify managed bridge installation and native Codex support";
    if (journal) { try { save(join(journal, "stopped.json"), json({ error: message.split(":")[0], automaticRollback: false, reconcileBeforeRetry: true })); } catch { /* Preserve original refusal; never print configuration. */ } }
    throw new Error(message);
  } finally { await rpc?.close(); }
}
