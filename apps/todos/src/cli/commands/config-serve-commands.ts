import type { Command } from "commander";
import chalk from "chalk";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getDatabase } from "../../db/database.js";
import { listTasks } from "../../db/tasks.js";
import { loadConfig } from "../../lib/config.js";
import { autoProject, output, formatTaskLine, normalizeStatus, resolveTaskId } from "../helpers.js";

export function registerConfigServeCommands(program: Command) {
  // config
  program
    .command("config")
    .description("View or update configuration")
    .option("--get <key>", "Get a config value")
    .option("--set <key=value>", "Set a config value (e.g. completion_guard.enabled=true)")
    .action((opts) => {
      const globalOpts = program.opts();
      const home = process.env["HOME"] || "~";
      const newPath = join(home, ".hasna", "todos", "config.json");
      const legacyPath = join(home, ".todos", "config.json");
      const configPath = (!existsSync(newPath) && existsSync(legacyPath)) ? legacyPath : newPath;

      if (opts.get) {
        const config = loadConfig();
        const keys = opts.get.split(".");
        let value: any = config;
        for (const k of keys) { value = value?.[k]; }
        if (globalOpts.json) {
          output({ key: opts.get, value }, true);
        } else {
          console.log(value !== undefined ? JSON.stringify(value, null, 2) : chalk.dim("(not set)"));
        }
        return;
      }

      if (opts.set) {
        const [key, ...valueParts] = opts.set.split("=");
        const rawValue = valueParts.join("=");
        let parsedValue: any;
        try { parsedValue = JSON.parse(rawValue); } catch { parsedValue = rawValue; }

        let config: any = {};
        try { config = JSON.parse(readFileSync(configPath, "utf-8")); } catch {}

        const keys = key.split(".");
        let obj = config;
        for (let i = 0; i < keys.length - 1; i++) {
          if (!obj[keys[i]] || typeof obj[keys[i]] !== "object") obj[keys[i]] = {};
          obj = obj[keys[i]];
        }
        obj[keys[keys.length - 1]] = parsedValue;

        const dir = dirname(configPath);
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        writeFileSync(configPath, JSON.stringify(config, null, 2));

        if (globalOpts.json) {
          output({ key, value: parsedValue }, true);
        } else {
          console.log(chalk.green(`Set ${key} = ${JSON.stringify(parsedValue)}`));
        }
        return;
      }

      // No args: show full config
      const config = loadConfig();
      if (globalOpts.json) {
        output(config, true);
      } else {
        console.log(JSON.stringify(config, null, 2));
      }
    });

  const encryption = program
    .command("encryption")
    .description("Manage local encryption profiles for fields and secure exports");

  encryption
    .command("list")
    .description("List local encryption profiles")
    .action(async () => {
      const globalOpts = program.opts();
      const { listEncryptionProfiles } = await import("../../lib/local-encryption.js");
      const profiles = listEncryptionProfiles();
      if (globalOpts.json) { output(profiles, true); return; }
      if (profiles.length === 0) {
        console.log(chalk.dim("No encryption profiles configured."));
        return;
      }
      for (const profile of profiles) {
        console.log(`${profile.name.padEnd(12)} ${profile.algorithm} ${chalk.dim(`key: ${profile.key_env}`)}`);
      }
    });

  encryption
    .command("set <name>")
    .description("Create or update a local encryption profile")
    .option("--key-env <name>", "Environment variable that supplies the encryption key", "TODOS_ENCRYPTION_KEY")
    .option("--description <text>", "Profile description")
    .action(async (name: string, opts: { keyEnv?: string; description?: string }) => {
      const globalOpts = program.opts();
      const { upsertEncryptionProfile } = await import("../../lib/local-encryption.js");
      const profile = upsertEncryptionProfile({ name, key_env: opts.keyEnv, description: opts.description });
      if (globalOpts.json) { output(profile, true); return; }
      console.log(chalk.green(`Encryption profile saved: ${profile.name}`));
      console.log(chalk.dim(`  Key env: ${profile.key_env}`));
      console.log(chalk.dim("  Key material is not stored by todos."));
    });

  encryption
    .command("status [name]")
    .description("Show whether a local encryption profile is locked or unlocked")
    .action(async (name: string | undefined) => {
      const globalOpts = program.opts();
      const { encryptionProfileStatus } = await import("../../lib/local-encryption.js");
      const status = encryptionProfileStatus(name);
      if (globalOpts.json) { output(status, true); return; }
      console.log(status.locked ? chalk.yellow("Locked") : chalk.green("Unlocked"));
      console.log(chalk.dim(`  Profile: ${status.profile.name}`));
      console.log(chalk.dim(`  Key env: ${status.key_env}`));
    });

  encryption
    .command("remove <name>")
    .description("Remove a local encryption profile")
    .action(async (name: string) => {
      const globalOpts = program.opts();
      const { removeEncryptionProfile } = await import("../../lib/local-encryption.js");
      const removed = removeEncryptionProfile(name);
      if (globalOpts.json) { output({ removed }, true); return; }
      console.log(removed ? chalk.green("Encryption profile removed.") : chalk.dim("No encryption profile matched."));
    });

  encryption
    .command("test [name]")
    .description("Encrypt and decrypt a local test payload without storing key material")
    .option("--text <text>", "Payload text", "hasna/todos encryption test")
    .action(async (name: string | undefined, opts: { text?: string }) => {
      const globalOpts = program.opts();
      const { decryptString, encryptString } = await import("../../lib/local-encryption.js");
      const text = opts.text || "hasna/todos encryption test";
      const encrypted = encryptString(text, { profile: name });
      const plaintext = decryptString(encrypted);
      const result = {
        ok: plaintext === text,
        profile: encrypted.profile,
        key_env: encrypted.key_env,
        ciphertext_bytes: Buffer.from(encrypted.ciphertext, "base64").length,
      };
      if (globalOpts.json) { output(result, true); return; }
      console.log(result.ok ? chalk.green("Encryption profile works.") : chalk.red("Encryption profile failed."));
    });

  function listOption(value: string | undefined): string[] | undefined {
    return value?.split(",").map((item) => item.trim()).filter(Boolean);
  }

  function recordOption(value: string | undefined): Record<string, string> | undefined {
    const entries = listOption(value);
    if (!entries || entries.length === 0) return undefined;
    const pairs = entries.flatMap((entry) => {
      const [rawKey, ...rest] = entry.split("=");
      const key = rawKey?.trim();
      return key ? [[key, rest.join("=").trim()] as const] : [];
    });
    return pairs.length > 0 ? Object.fromEntries(pairs) : undefined;
  }

  const redaction = program
    .command("redaction")
    .description("Manage local secret redaction patterns and scans");

  redaction
    .command("status")
    .description("Show local secret redaction configuration")
    .action(async () => {
      const globalOpts = program.opts();
      const { getSecretSafetyConfig } = await import("../../lib/redaction.js");
      const config = getSecretSafetyConfig();
      if (globalOpts.json) { output(config, true); return; }
      console.log(chalk.bold("Secret redaction"));
      console.log(`  ${chalk.dim("Patterns:")} ${config.redaction_patterns?.join(", ") || "(defaults only)"}`);
      console.log(`  ${chalk.dim("Keys:")}     ${config.redaction_keys?.join(", ") || "(defaults only)"}`);
    });

  redaction
    .command("add")
    .description("Add local secret redaction regex patterns or object key names")
    .option("--pattern <list>", "Comma-separated regex patterns to redact from text")
    .option("--key <list>", "Comma-separated metadata/object key names to redact")
    .action(async (opts: { pattern?: string; key?: string }) => {
      const globalOpts = program.opts();
      const { upsertSecretSafetyConfig } = await import("../../lib/redaction.js");
      const config = upsertSecretSafetyConfig({
        redaction_patterns: listOption(opts.pattern),
        redaction_keys: listOption(opts.key),
      });
      if (globalOpts.json) { output(config, true); return; }
      console.log(chalk.green("Secret redaction config updated."));
    });

  redaction
    .command("scan [text]")
    .description("Scan text or a file for secret-like values without printing values")
    .option("--file <path>", "File to scan")
    .action(async (text: string | undefined, opts: { file?: string }) => {
      const globalOpts = program.opts();
      const { listSecretFindings } = await import("../../lib/redaction.js");
      const value = opts.file ? readFileSync(opts.file, "utf-8") : text || "";
      const findings = listSecretFindings(value);
      if (globalOpts.json) { output({ ok: findings.length === 0, findings }, true); return; }
      if (findings.length === 0) {
        console.log(chalk.green("No secret-like values detected."));
        return;
      }
      console.log(chalk.yellow(`${findings.length} secret pattern(s) detected.`));
      for (const finding of findings) console.log(`  - ${finding.pattern}: ${finding.count}`);
      process.exitCode = 1;
    });

  const trust = program
    .command("trust")
    .description("Manage local workspace trust and permission profiles");

  trust
    .command("list")
    .description("List local workspace trust profiles")
    .action(async () => {
      const globalOpts = program.opts();
      const { listWorkspaceTrustProfiles } = await import("../../lib/workspace-trust.js");
      const profiles = listWorkspaceTrustProfiles();
      if (globalOpts.json) { output(profiles, true); return; }
      if (profiles.length === 0) {
        console.log(chalk.dim("No trusted workspaces configured."));
        return;
      }
      for (const profile of profiles) {
        console.log(`${profile.trusted ? chalk.green("trusted") : chalk.yellow("prompt")} ${profile.preset.padEnd(10)} ${profile.root}`);
      }
    });

  trust
    .command("status [path]")
    .description("Show local trust status for a workspace path")
    .action(async (path: string | undefined) => {
      const globalOpts = program.opts();
      const { getWorkspaceTrustStatus } = await import("../../lib/workspace-trust.js");
      const status = getWorkspaceTrustStatus(path || process.cwd());
      if (globalOpts.json) { output(status, true); return; }
      console.log(chalk.bold(status.trusted ? "Workspace trusted" : "Workspace requires prompts"));
      console.log(`  ${chalk.dim("Path:")}    ${status.root}`);
      console.log(`  ${chalk.dim("Match:")}   ${status.matched_root || "(none)"}`);
      console.log(`  ${chalk.dim("Preset:")}  ${status.profile.preset}`);
    });

  trust
    .command("add <path>")
    .description("Add or update a local workspace trust profile")
    .option("--preset <preset>", "restricted, readonly, standard, or trusted", "standard")
    .option("--trusted <value>", "Override trusted boolean")
    .option("--allow-command <list>", "Comma-separated command prefixes or patterns")
    .option("--deny-command <list>", "Comma-separated denied command substrings or patterns")
    .option("--tool <list>", "Comma-separated tool permission names")
    .option("--write-scope <list>", "Comma-separated allowed write scopes relative to the root")
    .option("--redact-env <list>", "Comma-separated environment key patterns to redact")
    .option("--no-prompt", "Do not require prompts for unsafe checks")
    .action(async (path: string, opts: { preset?: string; trusted?: string; allowCommand?: string; denyCommand?: string; tool?: string; writeScope?: string; redactEnv?: string; prompt?: boolean }) => {
      const globalOpts = program.opts();
      const { upsertWorkspaceTrustProfile } = await import("../../lib/workspace-trust.js");
      const preset = ["restricted", "readonly", "standard", "trusted"].includes(opts.preset || "")
        ? opts.preset as "restricted" | "readonly" | "standard" | "trusted"
        : "standard";
      const profile = upsertWorkspaceTrustProfile({
        root: path,
        preset,
        trusted: opts.trusted === undefined ? undefined : /^(1|true|yes|on)$/i.test(opts.trusted),
        command_allowlist: listOption(opts.allowCommand),
        command_denylist: listOption(opts.denyCommand),
        tool_permissions: listOption(opts.tool),
        write_scopes: listOption(opts.writeScope),
        env_redactions: listOption(opts.redactEnv),
        require_prompt_for_unsafe: opts.prompt === false ? false : undefined,
      });
      if (globalOpts.json) { output(profile, true); return; }
      console.log(chalk.green(`Trusted workspace profile saved for ${profile.root}`));
    });

  trust
    .command("remove <path>")
    .description("Remove a local workspace trust profile")
    .action(async (path: string) => {
      const globalOpts = program.opts();
      const { removeWorkspaceTrustProfile } = await import("../../lib/workspace-trust.js");
      const removed = removeWorkspaceTrustProfile(path);
      if (globalOpts.json) { output({ removed }, true); return; }
      console.log(removed ? chalk.green("Trust profile removed.") : chalk.dim("No trust profile matched."));
    });

  trust
    .command("check [path]")
    .description("Check whether a local command, tool, or write path is allowed")
    .option("--command <command>", "Command line to check")
    .option("--tool <tool>", "Tool permission to check")
    .option("--write <path>", "Write path to check")
    .option("--env <list>", "Comma-separated environment keys to test for redaction")
    .action(async (path: string | undefined, opts: { command?: string; tool?: string; write?: string; env?: string }) => {
      const globalOpts = program.opts();
      const { checkWorkspacePermission } = await import("../../lib/workspace-trust.js");
      const env = Object.fromEntries((listOption(opts.env) || []).map((key) => [key, "set"]));
      const result = checkWorkspacePermission({
        path: path || process.cwd(),
        command: opts.command,
        tool: opts.tool,
        write_path: opts.write,
        env,
      });
      if (globalOpts.json) { output(result, true); return; }
      console.log(result.allowed ? chalk.green("Allowed") : chalk.yellow("Requires review"));
      if (result.reasons.length > 0) {
        for (const reason of result.reasons) console.log(`  - ${reason}`);
      }
      if (result.redacted_env_keys.length > 0) {
        console.log(`  ${chalk.dim("Redacted env:")} ${result.redacted_env_keys.join(", ")}`);
      }
      if (!result.allowed) process.exitCode = 1;
    });

  const sandbox = program
    .command("sandbox")
    .description("Manage local runner sandbox profiles and dry-run checks");

  sandbox
    .command("list")
    .description("List local runner sandbox profiles")
    .action(async () => {
      const globalOpts = program.opts();
      const { listRunnerSandboxProfiles } = await import("../../lib/runner-sandbox.js");
      const profiles = listRunnerSandboxProfiles();
      if (globalOpts.json) { output(profiles, true); return; }
      if (profiles.length === 0) {
        console.log(chalk.dim("No runner sandbox profiles configured."));
        return;
      }
      for (const profile of profiles) {
        console.log(`${profile.name.padEnd(12)} ${profile.network_policy.padEnd(5)} ${profile.root}`);
      }
    });

  sandbox
    .command("set <name> [root]")
    .description("Add or update a local runner sandbox profile")
    .option("--allow-command <list>", "Comma-separated command prefixes or patterns")
    .option("--deny-command <list>", "Comma-separated denied command substrings or patterns")
    .option("--cwd-boundary <path>", "Directory boundary for command cwd")
    .option("--write-scope <list>", "Comma-separated allowed write scopes relative to the root")
    .option("--env-allow <list>", "Comma-separated environment keys or patterns to pass through")
    .option("--redact-env <list>", "Comma-separated environment key patterns to redact")
    .option("--network <policy>", "Network policy: none, local, or full", "none")
    .option("--no-approval", "Do not require approval when checks fail")
    .option("--no-audit", "Do not include audit evidence in check output")
    .action(async (name: string, root: string | undefined, opts: { allowCommand?: string; denyCommand?: string; cwdBoundary?: string; writeScope?: string; envAllow?: string; redactEnv?: string; network?: string; approval?: boolean; audit?: boolean }) => {
      const globalOpts = program.opts();
      const { upsertRunnerSandboxProfile } = await import("../../lib/runner-sandbox.js");
      const network = opts.network === "local" || opts.network === "full" ? opts.network : "none";
      const profile = upsertRunnerSandboxProfile({
        name,
        root: root || process.cwd(),
        command_allowlist: listOption(opts.allowCommand),
        command_denylist: listOption(opts.denyCommand),
        cwd_boundary: opts.cwdBoundary,
        write_scopes: listOption(opts.writeScope),
        env_allowlist: listOption(opts.envAllow),
        env_redactions: listOption(opts.redactEnv),
        network_policy: network,
        require_approval: opts.approval === false ? false : undefined,
        audit_evidence: opts.audit === false ? false : undefined,
      });
      if (globalOpts.json) { output(profile, true); return; }
      console.log(chalk.green(`Runner sandbox ${profile.name} saved for ${profile.root}`));
    });

  sandbox
    .command("remove <name>")
    .description("Remove a local runner sandbox profile")
    .action(async (name: string) => {
      const globalOpts = program.opts();
      const { removeRunnerSandboxProfile } = await import("../../lib/runner-sandbox.js");
      const removed = removeRunnerSandboxProfile(name);
      if (globalOpts.json) { output({ removed }, true); return; }
      console.log(removed ? chalk.green("Runner sandbox removed.") : chalk.dim("No runner sandbox matched."));
    });

  function envOption(value: string | undefined): Record<string, string> {
    return Object.fromEntries((listOption(value) || []).map((key) => [key, "set"]));
  }

  async function runSandboxCheck(name: string | undefined, opts: { path?: string; cwd?: string; command?: string; write?: string; env?: string; network?: boolean }, exitOnDeny: boolean) {
    const globalOpts = program.opts();
    const { checkRunnerSandbox } = await import("../../lib/runner-sandbox.js");
    const result = checkRunnerSandbox({
      name,
      path: opts.path,
      cwd: opts.cwd,
      command: opts.command,
      write_paths: listOption(opts.write),
      env: envOption(opts.env),
      network: opts.network,
    });
    if (globalOpts.json) { output(result, true); return; }
    console.log(result.allowed ? chalk.green("Allowed") : chalk.yellow("Requires review"));
    for (const reason of result.reasons) console.log(`  - ${reason}`);
    if (result.omitted_env_keys.length > 0) console.log(`  ${chalk.dim("Omitted env:")} ${result.omitted_env_keys.join(", ")}`);
    if (result.redacted_env_keys.length > 0) console.log(`  ${chalk.dim("Redacted env:")} ${result.redacted_env_keys.join(", ")}`);
    if (!result.allowed && exitOnDeny) process.exitCode = 1;
  }

  sandbox
    .command("check [name]")
    .description("Check whether a local runner action is allowed")
    .option("--path <path>", "Workspace path to evaluate")
    .option("--cwd <path>", "Command working directory")
    .option("--command <command>", "Command line to check")
    .option("--write <list>", "Comma-separated write paths to check")
    .option("--env <list>", "Comma-separated environment keys to test")
    .option("--network", "Request network access")
    .action((name: string | undefined, opts: { path?: string; cwd?: string; command?: string; write?: string; env?: string; network?: boolean }) => runSandboxCheck(name, opts, true));

  sandbox
    .command("explain [name]")
    .description("Dry-run explain output for a local runner sandbox check")
    .option("--path <path>", "Workspace path to evaluate")
    .option("--cwd <path>", "Command working directory")
    .option("--command <command>", "Command line to check")
    .option("--write <list>", "Comma-separated write paths to check")
    .option("--env <list>", "Comma-separated environment keys to test")
    .option("--network", "Request network access")
    .action((name: string | undefined, opts: { path?: string; cwd?: string; command?: string; write?: string; env?: string; network?: boolean }) => runSandboxCheck(name, opts, false));

  const extensions = program
    .command("extensions")
    .description("Manage local workflow extension registry");

  extensions
    .command("list")
    .description("List installed local extensions")
    .action(async () => {
      const globalOpts = program.opts();
      const { listLocalExtensions, renderExtensionSummary } = await import("../../lib/local-extensions.js");
      const records = listLocalExtensions();
      if (globalOpts.json) { output(records, true); return; }
      if (records.length === 0) {
        console.log(chalk.dim("No local extensions installed."));
        return;
      }
      for (const record of records) console.log(renderExtensionSummary(record));
    });

  extensions
    .command("inspect <source>")
    .description("Validate a local extension manifest, directory, or offline bundle without installing it")
    .action(async (source: string) => {
      const globalOpts = program.opts();
      const { inspectExtensionSource } = await import("../../lib/local-extensions.js");
      const inspected = inspectExtensionSource(source);
      if (globalOpts.json) { output(inspected, true); return; }
      console.log(`${inspected.manifest.name}@${inspected.manifest.version} ${inspected.validation.ok ? chalk.green("valid") : chalk.red("invalid")}`);
      console.log(`  ${chalk.dim("Source:")}   ${inspected.source_type} ${inspected.source}`);
      console.log(`  ${chalk.dim("Checksum:")} ${inspected.checksum}`);
      for (const warning of inspected.validation.warnings) console.log(`  ${chalk.yellow("warning:")} ${warning}`);
      for (const error of inspected.validation.errors) console.log(`  ${chalk.red("error:")} ${error}`);
      if (!inspected.validation.ok) process.exitCode = 1;
    });

  extensions
    .command("install <source>")
    .description("Install or update a local extension from a manifest, directory, or offline bundle")
    .option("--trust", "Mark the extension trusted immediately")
    .option("--checksum <sha256>", "Expected sha256:<hex> checksum for the source manifest or bundle")
    .option("--signature <value>", "Optional detached signature over the checksum")
    .option("--public-key <pem>", "Public key PEM string used to verify --signature")
    .action(async (source: string, opts: { trust?: boolean; checksum?: string; signature?: string; publicKey?: string }) => {
      const globalOpts = program.opts();
      const { installLocalExtension } = await import("../../lib/local-extensions.js");
      const record = installLocalExtension({
        source,
        trust: opts.trust,
        checksum: opts.checksum,
        signature: opts.signature,
        public_key: opts.publicKey,
      });
      if (globalOpts.json) { output(record, true); return; }
      console.log(chalk.green(`Extension ${record.name}@${record.version} installed as ${record.status}.`));
      console.log(`  ${chalk.dim("Checksum:")} ${record.checksum}`);
      console.log(`  ${chalk.dim("Signature:")} ${record.signature_verified ? "verified" : "not verified"}`);
      for (const warning of record.warnings) console.log(`  ${chalk.yellow("warning:")} ${warning}`);
    });

  extensions
    .command("compat <source>")
    .description("Run local CLI/MCP compatibility checks and runner sandbox dry-runs for an extension")
    .action(async (source: string) => {
      const globalOpts = program.opts();
      const { testExtensionCompatibility } = await import("../../lib/local-extensions.js");
      const report = testExtensionCompatibility(source);
      if (globalOpts.json) { output(report, true); return; }
      console.log(report.ok ? chalk.green("Extension compatibility checks passed") : chalk.red("Extension compatibility checks failed"));
      console.log(`  ${chalk.dim("Commands:")} ${report.summary.commands}`);
      console.log(`  ${chalk.dim("MCP tools:")} ${report.summary.mcp_tools}`);
      console.log(`  ${chalk.dim("Sandbox checks:")} ${report.summary.sandbox_checks} (${report.summary.failed_sandbox_checks} require attention)`);
      for (const warning of report.warnings) console.log(`  ${chalk.yellow("warning:")} ${warning}`);
      for (const error of report.errors) console.log(`  ${chalk.red("error:")} ${error}`);
      if (!report.ok) process.exitCode = 1;
    });

  extensions
    .command("verify <source>")
    .description("Verify a local extension source checksum and optional signature without installing it")
    .option("--checksum <sha256>", "Expected sha256:<hex> checksum for the source manifest or bundle")
    .option("--signature <value>", "Optional detached signature over the checksum")
    .option("--public-key <pem>", "Public key PEM string used to verify --signature")
    .action(async (source: string, opts: { checksum?: string; signature?: string; publicKey?: string }) => {
      const globalOpts = program.opts();
      const { inspectExtensionSource, verifyExtensionSignature } = await import("../../lib/local-extensions.js");
      const inspected = inspectExtensionSource(source);
      const expected = opts.checksum || inspected.manifest.checksum;
      const checksum_ok = expected ? expected === inspected.checksum : true;
      const signature_verified = verifyExtensionSignature({
        checksum: inspected.checksum,
        signature: opts.signature || inspected.manifest.signature,
        public_key: opts.publicKey || inspected.manifest.public_key,
      });
      const result = {
        ...inspected,
        checksum_ok,
        signature_verified,
      };
      if (globalOpts.json) { output(result, true); return; }
      console.log(checksum_ok && inspected.validation.ok ? chalk.green("Extension source verified") : chalk.red("Extension source failed verification"));
      console.log(`  ${chalk.dim("Checksum:")} ${inspected.checksum}${checksum_ok ? "" : " (mismatch)"}`);
      console.log(`  ${chalk.dim("Signature:")} ${signature_verified ? "verified" : "not verified"}`);
      if (!checksum_ok || !inspected.validation.ok) process.exitCode = 1;
    });

  extensions
    .command("remove <name>")
    .description("Remove a local extension from the registry")
    .action(async (name: string) => {
      const globalOpts = program.opts();
      const { removeLocalExtension } = await import("../../lib/local-extensions.js");
      const removed = removeLocalExtension(name);
      if (globalOpts.json) { output({ removed }, true); return; }
      console.log(removed ? chalk.green("Extension removed.") : chalk.dim("No extension matched."));
    });

  const workflows = program
    .command("workflows")
    .description("List and render local guided workflow prompts");

  workflows
    .command("list")
    .description("List bundled local workflow prompts")
    .action(async () => {
      const globalOpts = program.opts();
      const { listWorkflowPrompts } = await import("../../lib/workflow-prompts.js");
      const prompts = listWorkflowPrompts();
      if (globalOpts.json) { output(prompts, true); return; }
      for (const prompt of prompts) console.log(`${prompt.id.padEnd(18)} ${prompt.description}`);
    });

  workflows
    .command("show <id>")
    .description("Render a guided workflow prompt as Markdown or JSON")
    .option("--objective <text>", "Objective or goal text")
    .option("--task <id>", "Task ID to ground the workflow")
    .option("--agent <name>", "Agent identity")
    .option("--context <text>", "Additional local context")
    .option("--format <format>", "Output format: markdown or json", "markdown")
    .action(async (id: string, opts: { objective?: string; task?: string; agent?: string; context?: string; format?: string }) => {
      const globalOpts = program.opts();
      const { renderWorkflowPrompt, renderWorkflowPromptMarkdown } = await import("../../lib/workflow-prompts.js");
      const input = { objective: opts.objective, task_id: opts.task, agent_id: opts.agent || globalOpts.agent, context: opts.context };
      if (globalOpts.json || opts.format === "json") { output(renderWorkflowPrompt(id, input), true); return; }
      console.log(renderWorkflowPromptMarkdown(id, input));
    });

  workflows
    .command("export")
    .description("Export bundled local workflow prompt metadata")
    .option("--format <format>", "Output format: json or markdown", "json")
    .action(async (opts: { format?: string }) => {
      const globalOpts = program.opts();
      const { listWorkflowPrompts } = await import("../../lib/workflow-prompts.js");
      const prompts = listWorkflowPrompts();
      if (globalOpts.json || opts.format === "json") { output(prompts, true); return; }
      for (const prompt of prompts) {
        console.log(`## ${prompt.title}`);
        console.log("");
        console.log(prompt.description);
        console.log("");
      }
    });

  const policies = program
    .command("policies")
    .description("Manage local policy packs for task done gates");

  function numberOption(value: string | undefined): number | undefined {
    if (value === undefined) return undefined;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  function policyInput(name: string, root: string | undefined, opts: {
    version?: string;
    requiredCommand?: string;
    prohibitedCommand?: string;
    prohibitedPath?: string;
    requiredStatus?: string;
    requirePassedVerification?: boolean;
    requireCommit?: boolean;
    requirePr?: boolean;
    requireApproval?: boolean;
    requireRun?: boolean;
    requireArtifact?: boolean;
    evidenceMin?: string;
    branchPattern?: string;
  }) {
    return {
      name,
      root: root || process.cwd(),
      version: numberOption(opts.version),
      required_commands: listOption(opts.requiredCommand),
      prohibited_commands: listOption(opts.prohibitedCommand),
      prohibited_paths: listOption(opts.prohibitedPath),
      required_statuses: listOption(opts.requiredStatus),
      require_passed_verification: opts.requirePassedVerification,
      require_commit: opts.requireCommit,
      require_pull_request: opts.requirePr,
      require_approval: opts.requireApproval,
      require_run: opts.requireRun,
      require_artifact: opts.requireArtifact,
      evidence_min_count: numberOption(opts.evidenceMin),
      branch_pattern: opts.branchPattern,
    };
  }

  policies
    .command("list")
    .description("List local policy packs")
    .action(async () => {
      const globalOpts = program.opts();
      const { listPolicyPacks } = await import("../../lib/policy-packs.js");
      const packs = listPolicyPacks();
      if (globalOpts.json) { output(packs, true); return; }
      if (packs.length === 0) {
        console.log(chalk.dim("No local policy packs configured."));
        return;
      }
      for (const pack of packs) {
        console.log(`${pack.name.padEnd(14)} v${String(pack.version).padEnd(3)} ${pack.root}`);
      }
    });

  policies
    .command("set <name> [root]")
    .description("Add or update a local policy pack")
    .option("--version <number>", "Policy pack version")
    .option("--required-command <list>", "Comma-separated passed command patterns required for the task")
    .option("--prohibited-command <list>", "Comma-separated command patterns that must not appear in evidence")
    .option("--prohibited-path <list>", "Comma-separated changed file or artifact path patterns that must not appear")
    .option("--required-status <list>", "Comma-separated allowed task statuses")
    .option("--require-passed-verification", "Require at least one passed verification record")
    .option("--require-commit", "Require at least one linked commit")
    .option("--require-pr", "Require at least one linked pull request")
    .option("--require-approval", "Require task approval fields")
    .option("--require-run", "Require at least one local run ledger")
    .option("--require-artifact", "Require at least one verification or run artifact")
    .option("--evidence-min <number>", "Minimum total evidence record count")
    .option("--branch-pattern <pattern>", "Require a linked branch matching a string, wildcard, or /regex/")
    .action(async (name: string, root: string | undefined, opts) => {
      const globalOpts = program.opts();
      const { upsertPolicyPack } = await import("../../lib/policy-packs.js");
      const pack = upsertPolicyPack(policyInput(name, root, opts));
      if (globalOpts.json) { output(pack, true); return; }
      console.log(chalk.green(`Policy pack ${pack.name} v${pack.version} saved for ${pack.root}`));
    });

  policies
    .command("remove <name>")
    .description("Remove a local policy pack")
    .action(async (name: string) => {
      const globalOpts = program.opts();
      const { removePolicyPack } = await import("../../lib/policy-packs.js");
      const removed = removePolicyPack(name);
      if (globalOpts.json) { output({ removed }, true); return; }
      console.log(removed ? chalk.green("Policy pack removed.") : chalk.dim("No policy pack matched."));
    });

  async function runPolicyValidation(name: string, taskId: string, explain: boolean) {
    const globalOpts = program.opts();
    const { validatePolicyPack, explainPolicyPack } = await import("../../lib/policy-packs.js");
    const resolvedId = resolveTaskId(taskId);
    const result = explain
      ? explainPolicyPack({ name, task_id: resolvedId })
      : validatePolicyPack({ name, task_id: resolvedId });
    if (globalOpts.json) { output(result, true); return; }
    console.log(result.passed ? chalk.green("Policy passed") : chalk.red("Policy failed"));
    for (const item of result.findings) {
      const marker = item.status === "pass" ? chalk.green("pass") : chalk.red("fail");
      console.log(`  ${marker} ${item.id}: ${item.message}`);
      if (item.evidence.length > 0) console.log(`    ${chalk.dim(item.evidence.join(", "))}`);
    }
    if (!result.passed && !explain) process.exitCode = 1;
  }

  policies
    .command("validate <name> <task-id>")
    .description("Validate a task against a local policy pack")
    .action((name: string, taskId: string) => runPolicyValidation(name, taskId, false));

  policies
    .command("explain <name> <task-id>")
    .description("Dry-run explain output for local policy-pack validation")
    .action((name: string, taskId: string) => runPolicyValidation(name, taskId, true));

  const approvals = program
    .command("approvals")
    .description("Manage local approval gates and manual checkpoints");

  function printApprovalGate(gate: any, json: boolean) {
    if (json) { output(gate, true); return; }
    const color = gate.status === "approved" ? chalk.green : gate.status === "pending" ? chalk.yellow : chalk.red;
    console.log(`${color(gate.status)} ${gate.gate} ${chalk.dim(gate.task_id.slice(0, 8))}`);
    if (gate.reviewer) console.log(`  ${chalk.dim("Reviewer:")} ${gate.reviewer}`);
    if (gate.reason) console.log(`  ${chalk.dim("Reason:")}   ${gate.reason}`);
    if (gate.expires_at) console.log(`  ${chalk.dim("Expires:")}  ${gate.expires_at}`);
  }

  approvals
    .command("require <task-id> <gate>")
    .description("Require a local manual approval gate before risky work")
    .option("--reviewer <name>", "Expected reviewer")
    .option("--requester <name>", "Requester or agent creating the gate")
    .option("--reason <text>", "Why this gate is required")
    .option("--plan <id>", "Related local plan ID")
    .option("--run <id>", "Related local run ledger ID")
    .option("--expires-at <iso>", "ISO timestamp when this pending gate expires")
    .action(async (taskId: string, gateName: string, opts: { reviewer?: string; requester?: string; reason?: string; plan?: string; run?: string; expiresAt?: string }) => {
      const globalOpts = program.opts();
      const { requestApprovalGate } = await import("../../lib/approval-gates.js");
      const gate = requestApprovalGate({
        task_id: resolveTaskId(taskId),
        gate: gateName,
        requester: opts.requester || globalOpts.agent,
        reviewer: opts.reviewer,
        reason: opts.reason,
        plan_id: opts.plan,
        run_id: opts.run,
        expires_at: opts.expiresAt,
      });
      printApprovalGate(gate, globalOpts.json);
    });

  approvals
    .command("approve <task-id> <gate>")
    .description("Approve a local approval gate")
    .option("--reviewer <name>", "Reviewer or approver")
    .option("--note <text>", "Approval note")
    .action(async (taskId: string, gateName: string, opts: { reviewer?: string; note?: string }) => {
      const globalOpts = program.opts();
      const { approveApprovalGate } = await import("../../lib/approval-gates.js");
      const gate = approveApprovalGate({
        task_id: resolveTaskId(taskId),
        gate: gateName,
        reviewer: opts.reviewer || globalOpts.agent || "cli",
        note: opts.note,
      });
      printApprovalGate(gate, globalOpts.json);
    });

  approvals
    .command("reject <task-id> <gate>")
    .description("Reject a local approval gate")
    .option("--reviewer <name>", "Reviewer or approver")
    .option("--reason <text>", "Rejection reason")
    .action(async (taskId: string, gateName: string, opts: { reviewer?: string; reason?: string }) => {
      const globalOpts = program.opts();
      const { rejectApprovalGate } = await import("../../lib/approval-gates.js");
      const gate = rejectApprovalGate({
        task_id: resolveTaskId(taskId),
        gate: gateName,
        reviewer: opts.reviewer || globalOpts.agent || "cli",
        reason: opts.reason,
      });
      printApprovalGate(gate, globalOpts.json);
    });

  approvals
    .command("expire <task-id> <gate>")
    .description("Expire a pending local approval gate")
    .option("--reviewer <name>", "Reviewer or agent expiring the gate")
    .option("--reason <text>", "Expiration reason")
    .action(async (taskId: string, gateName: string, opts: { reviewer?: string; reason?: string }) => {
      const globalOpts = program.opts();
      const { expireApprovalGate } = await import("../../lib/approval-gates.js");
      const gate = expireApprovalGate({
        task_id: resolveTaskId(taskId),
        gate: gateName,
        reviewer: opts.reviewer || globalOpts.agent || "cli",
        reason: opts.reason,
      });
      printApprovalGate(gate, globalOpts.json);
    });

  approvals
    .command("check <task-id> <gate>")
    .description("Check whether a local approval gate allows work to proceed")
    .action(async (taskId: string, gateName: string) => {
      const globalOpts = program.opts();
      const { checkApprovalGate } = await import("../../lib/approval-gates.js");
      const result = checkApprovalGate(resolveTaskId(taskId), gateName);
      if (!result.allowed) process.exitCode = 1;
      if (globalOpts.json) { output(result, true); return; }
      console.log(result.allowed ? chalk.green("Approval gate passed") : chalk.red("Approval gate blocked"));
      for (const reason of result.reasons) console.log(`  - ${reason}`);
    });

  approvals
    .command("list <task-id>")
    .description("List local approval gates for a task")
    .action(async (taskId: string) => {
      const globalOpts = program.opts();
      const { listApprovalGates } = await import("../../lib/approval-gates.js");
      const gates = listApprovalGates(resolveTaskId(taskId));
      if (globalOpts.json) { output(gates, true); return; }
      if (gates.length === 0) {
        console.log(chalk.dim("No approval gates recorded."));
        return;
      }
      for (const gate of gates) printApprovalGate(gate, false);
    });

  const eventHooks = program
    .command("event-hooks")
    .description("Manage local event hooks and automation triggers");

  eventHooks
    .command("list")
    .description("List local event hooks")
    .action(async () => {
      const globalOpts = program.opts();
      const { listLocalEventHooks } = await import("../../lib/event-hooks.js");
      const hooks = listLocalEventHooks();
      if (globalOpts.json) { output(hooks, true); return; }
      if (hooks.length === 0) {
        console.log(chalk.dim("No local event hooks configured."));
        return;
      }
      for (const hook of hooks) {
        const status = hook.enabled === false ? chalk.yellow("disabled") : chalk.green("enabled ");
        console.log(`${status} ${hook.name.padEnd(14)} ${hook.target.padEnd(6)} ${hook.events.join(",")}`);
      }
    });

  eventHooks
    .command("set <name>")
    .description("Add or update a local event hook")
    .requiredOption("--event <list>", "Comma-separated events, or *")
    .option("--target <target>", "stdout, file, socket, or script", "file")
    .option("--file <path>", "Append JSONL events to this file for file targets")
    .option("--socket <path>", "Unix socket path for socket targets")
    .option("--command <command>", "Local script command for script targets")
    .option("--cwd <path>", "Working directory for script targets")
    .option("--sandbox <name>", "Runner sandbox profile used before script execution")
    .option("--env <list>", "Comma-separated KEY=value environment entries for script targets")
    .option("--attempts <number>", "Delivery attempts for socket/script targets", "1")
    .option("--backoff-ms <number>", "Backoff between retry attempts in milliseconds", "0")
    .option("--disabled", "Store hook disabled")
    .action(async (name: string, opts: { event: string; target?: string; file?: string; socket?: string; command?: string; cwd?: string; sandbox?: string; env?: string; attempts?: string; backoffMs?: string; disabled?: boolean }) => {
      const globalOpts = program.opts();
      const { upsertLocalEventHook } = await import("../../lib/event-hooks.js");
      const hook = upsertLocalEventHook({
        name,
        events: listOption(opts.event) || [],
        target: (opts.target || "file") as any,
        enabled: opts.disabled ? false : true,
        file_path: opts.file,
        socket_path: opts.socket,
        command: opts.command,
        cwd: opts.cwd,
        sandbox: opts.sandbox,
        env: recordOption(opts.env),
        retry: {
          attempts: Number.parseInt(opts.attempts || "1", 10),
          backoff_ms: Number.parseInt(opts.backoffMs || "0", 10),
        },
      });
      if (globalOpts.json) { output(hook, true); return; }
      console.log(chalk.green(`Event hook ${hook.name} saved for ${hook.events.join(",")}`));
    });

  eventHooks
    .command("remove <name>")
    .description("Remove a local event hook")
    .action(async (name: string) => {
      const globalOpts = program.opts();
      const { removeLocalEventHook } = await import("../../lib/event-hooks.js");
      const removed = removeLocalEventHook(name);
      if (globalOpts.json) { output({ removed }, true); return; }
      console.log(removed ? chalk.green("Event hook removed.") : chalk.dim("No event hook matched."));
    });

  eventHooks
    .command("test <name>")
    .description("Deliver a test event to one local event hook")
    .option("--event <event>", "Event type to emit", "task.completed")
    .option("--payload <json>", "JSON payload for the test event")
    .option("--task <id>", "Task ID to include in the payload")
    .action(async (name: string, opts: { event?: string; payload?: string; task?: string }) => {
      const globalOpts = program.opts();
      const { testLocalEventHook } = await import("../../lib/event-hooks.js");
      const payload = opts.payload ? JSON.parse(opts.payload) : {};
      if (opts.task) (payload as Record<string, unknown>).id = resolveTaskId(opts.task);
      const results = await testLocalEventHook(name, { type: opts.event || "task.completed", payload });
      if (globalOpts.json) { output(results, true); return; }
      for (const result of results) {
        const color = result.status === "delivered" ? chalk.green : result.status === "skipped" ? chalk.yellow : chalk.red;
        console.log(`${color(result.status)} ${result.hook} ${result.event_type} ${result.integrity.digest.slice(0, 12)}`);
        if (result.error) console.log(`  ${chalk.red(result.error)}`);
      }
    });

  // serve (web dashboard)
  program
    .command("serve")
    .description("Start the web dashboard")
    .option("--port <port>", "Port number", "19427")
    .option("--host <host>", "Host to bind (default: 127.0.0.1 localhost only, use 0.0.0.0 for all interfaces)")
    .option("--api-key <key>", "Require this API key for /api/* requests")
    .option("--no-open", "Don't open browser automatically")
    .action(async (opts) => {
      const { startServer } = await import("../../server/serve.js");
      const requestedPort = parseInt(opts.port, 10);
      let port = requestedPort;
      // Auto-find free port if default is in use
      for (let p = requestedPort; p < requestedPort + 100; p++) {
        try {
          const s = Bun.serve({ port: p, fetch: () => new Response("") });
          s.stop(true);
          port = p;
          break;
        } catch { /* port in use */ }
      }
      if (port !== requestedPort) {
        console.log(`Port ${requestedPort} in use, using ${port}`);
      }
      await startServer(port, { open: opts.open !== false, host: opts.host, apiKey: opts.apiKey });
    });

  // watch
  program
    .command("watch")
    .description("Live-updating task list (refreshes every few seconds)")
    .option("-s, --status <status>", "Filter by status (default: pending,in_progress)")
    .option("-i, --interval <seconds>", "Refresh interval in seconds", "5")
    .action(async (opts) => {
      const globalOpts = program.opts();
      const projectId = autoProject(globalOpts);
      const interval = parseInt(opts.interval, 10) * 1000;
      const statusFilter = opts.status ? opts.status.split(",").map((s: string) => normalizeStatus(s.trim())) : ["pending", "in_progress"];

      function render() {
        const tasks = listTasks({ project_id: projectId, status: statusFilter as any });
        const all = listTasks({ project_id: projectId });
        const counts: Record<string, number> = {};
        for (const t of all) counts[t.status] = (counts[t.status] || 0) + 1;

        // Clear screen
        process.stdout.write("\x1B[2J\x1B[0f");

        // Header
        const now = new Date().toLocaleTimeString();
        console.log(chalk.bold(`todos watch`) + chalk.dim(` — ${now} — refreshing every ${opts.interval}s — Ctrl+C to stop\n`));

        // Stats line
        const parts = [
          `total: ${chalk.bold(String(all.length))}`,
          `pending: ${chalk.yellow(String(counts["pending"] || 0))}`,
          `in_progress: ${chalk.blue(String(counts["in_progress"] || 0))}`,
          `completed: ${chalk.green(String(counts["completed"] || 0))}`,
          `failed: ${chalk.red(String(counts["failed"] || 0))}`,
        ];
        console.log(parts.join("  ") + "\n");

        if (tasks.length === 0) {
          console.log(chalk.dim("No matching tasks."));
          return;
        }

        for (const t of tasks) {
          console.log(formatTaskLine(t));
        }
        console.log(chalk.dim(`\n${tasks.length} task(s) shown`));
      }

      render();
      const timer = setInterval(render, interval);

      process.on("SIGINT", () => {
        clearInterval(timer);
        process.exit(0);
      });

      // Keep alive
      await new Promise(() => {});
    });

  // stream — SSE task event stream
  program
    .command("stream")
    .description("Subscribe to real-time task events via SSE (requires todos serve)")
    .option("--agent <id>", "Filter to events for a specific agent")
    .option("--events <list>", "Comma-separated event types (default: all)", "task.created,task.started,task.completed,task.failed,task.assigned,task.status_changed")
    .option("--port <n>", "Server port", "3000")
    .option("--json", "Output raw JSON events")
    .action(async (opts) => {
      const baseUrl = `http://localhost:${opts.port}`;
      const params = new URLSearchParams();
      if (opts.agent) params.set("agent_id", opts.agent);
      if (opts.events) params.set("events", opts.events);
      const url = `${baseUrl}/api/tasks/stream?${params}`;

      const eventColors: Record<string, (s: string) => string> = {
        "task.created": chalk.blue,
        "task.started": chalk.cyan,
        "task.completed": chalk.green,
        "task.failed": chalk.red,
        "task.assigned": chalk.yellow,
        "task.status_changed": chalk.magenta,
      };

      console.log(chalk.dim(`Connecting to ${url} — Ctrl+C to stop\n`));

      try {
        const resp = await fetch(url);
        if (!resp.ok || !resp.body) {
          console.error(chalk.red(`Failed to connect: ${resp.status}`));
          process.exit(1);
        }
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          let eventName = "";
          for (const line of lines) {
            if (line.startsWith("event: ")) {
              eventName = line.slice(7).trim();
            } else if (line.startsWith("data: ")) {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.type === "connected") continue;
                if (opts.json) {
                  console.log(JSON.stringify({ event: eventName, ...data }));
                } else {
                  const colorFn = eventColors[eventName] || chalk.white;
                  const ts = new Date(data.timestamp || Date.now()).toLocaleTimeString();
                  const taskId = data.task_id ? data.task_id.slice(0, 8) : "";
                  const agentInfo = data.agent_id ? ` [${data.agent_id}]` : "";
                  console.log(`${chalk.dim(ts)} ${colorFn(eventName.padEnd(25))} ${taskId}${agentInfo}`);
                }
              } catch {}
              eventName = "";
            }
          }
        }
      } catch (e) {
        console.error(chalk.red(`Connection error: ${e instanceof Error ? e.message : e}`));
        console.error(chalk.dim("Is `todos serve` running?"));
        process.exit(1);
      }
    });

  // interactive (TUI)
  program
    .command("interactive")
    .description("Launch interactive TUI")
    .action(async () => {
      const { renderApp } = await import("../components/App.js");
      const globalOpts = program.opts();
      const projectId = autoProject(globalOpts);
      renderApp(projectId);
    });

  // blame
  program
    .command("blame <file>")
    .description("Show which tasks/agents touched a file and why — combines task_files + task_commits")
    .action(async (filePath: string) => {
      const globalOpts = program.opts();
      const { findTasksByFile } = await import("../../db/task-files.js");
      const { getTask } = await import("../../db/tasks.js");
      const db = getDatabase();

      // Find via task_files
      const taskFiles = findTasksByFile(filePath, db) as any[];

      // Find via task_commits (search files_changed JSON)
      const commitRows = db.query(
        "SELECT tc.*, t.title, t.short_id FROM task_commits tc JOIN tasks t ON t.id = tc.task_id WHERE tc.files_changed LIKE ? ORDER BY tc.committed_at DESC"
      ).all(`%${filePath}%`) as any[];

      if (globalOpts.json) {
        output({ file: filePath, task_files: taskFiles, commits: commitRows }, true);
        return;
      }

      console.log(chalk.bold(`\nBlame: ${filePath}\n`));

      if (taskFiles.length > 0) {
        console.log(chalk.bold("Task File Links:"));
        for (const tf of taskFiles) {
          const task = getTask(tf.task_id, db);
          const title = task ? task.title : "unknown";
          const sid = task?.short_id || tf.task_id.slice(0, 8);
          console.log(`  ${chalk.cyan(sid)} ${title} — ${chalk.dim(tf.role || "file")} ${chalk.dim(tf.updated_at)}`);
        }
      }

      if (commitRows.length > 0) {
        console.log(chalk.bold(`\nCommit Links (${commitRows.length}):`));
        for (const c of commitRows) {
          const sid = c.short_id || c.task_id.slice(0, 8);
          console.log(`  ${chalk.yellow(c.sha?.slice(0, 7) || "?")} ${chalk.cyan(sid)} ${c.title || ""} — ${chalk.dim(c.author || "")} ${chalk.dim(c.committed_at || "")}`);
        }
      }

      if (taskFiles.length === 0 && commitRows.length === 0) {
        console.log(chalk.dim("No task or commit links found for this file."));
        console.log(chalk.dim("Use 'todos hook install' to auto-link future commits."));
      }
      console.log();
    });

  // dashboard
  program
    .command("dashboard")
    .description("Live-updating dashboard showing project health, agents, task flow")
    .option("--project <id>", "Filter to project")
    .option("--refresh <ms>", "Refresh interval in ms (default: 2000)", "2000")
    .action(async (opts) => {
      const { render } = await import("ink");
      const React = await import("react");
      const { Dashboard } = await import("../components/Dashboard.js");
      const globalOpts = program.opts();
      const projectId = opts.project || autoProject(globalOpts) || undefined;
      render(React.createElement(Dashboard, { projectId, refreshMs: parseInt(opts.refresh, 10) }));
    });
}
