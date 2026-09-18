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
type Connect = typeof connectCodexHookRpc;
const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n";
const structure = (text: string) => JSON.parse(JSON.stringify(Bun.TOML.parse(text)));
const eventNames = { UserPromptSubmit: ["userPromptSubmit", "user_prompt_submit"], SessionStart: ["sessionStart", "session_start"], SubagentStart: ["subagentStart", "subagent_start"] } as const;

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
    const planDigest = createHash("sha256").update(json({ version: 1, home, configPath, configSha256: configFile.sha256, configVersion: layers[0].version, policySha256: policyFile.sha256, hooksSha256: hooksFile.sha256, skillsCli: skillsCli.receipt, nativeVersion: rpc.version, declarations: expected, admitted })).digest("hex");
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
    save(join(journal, "intent.json"), json({ version: 1, planDigest, skillsCli: skillsCli.receipt, nativeVersion: rpc.version, configPath, beforeSha256: configFile.sha256, hooksSha256: hooksFile.sha256, policySha256: policyFile.sha256, expectedVersion: layers[0].version, hooks: planned }));
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
