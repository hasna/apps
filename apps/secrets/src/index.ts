#!/usr/bin/env bun
import { getStore } from "./store/index.js";
import type { Store } from "./store/types.js";
import { getMasterKey, initKms, getKeyStatus } from "./crypto.js";
import type { SecretEntry } from "./types.js";
import { getSecretReferenceStatus } from "./status.js";
import {
  commaListFlag,
  formatEntry,
  formatJson,
  parseArgs,
  parseAwsOptions,
  parseTtl,
  positiveIntegerFlag,
} from "./cli/args.js";
import { docs, SECRET_TYPES, usage } from "./cli/help.js";
import { runItemsCommand } from "./cli/items.js";

const args = process.argv.slice(2);

async function runSharedEventCli(args: string[]): Promise<boolean> {
  if (args[0] !== "events" && args[0] !== "webhooks") return false;
  const [{ Command }, { registerEventsCommands }] = await Promise.all([
    import("commander"),
    import("@hasna/events/commander"),
  ]);
  const program = new Command().name("secrets");
  // The shared events package renamed its "webhooks" command to "channels";
  // register it under the "webhooks" name so `secrets webhooks …` (as advertised
  // in --help) keeps working against event channel subscriptions.
  registerEventsCommands(program, { source: "secrets", channelsCommandName: "webhooks" });
  await program.parseAsync(["node", "secrets", ...args]);
  return true;
}

if (await runSharedEventCli(args)) process.exit(0);
const [command, ...rest] = args;

if (!command || command === "--help" || command === "-h") {
  usage();
  process.exit(0);
}

// `--help`/`-h` on ANY (sub)command prints usage and exits WITHOUT running the
// command. Previously these tokens were ignored (or, for `-h`, treated as a
// positional), so side-effecting subcommands (aws push/pull/sync, mcp install)
// executed anyway. Scan raw args because `parseArgs` only recognizes `--` flags.
if (rest.includes("--help") || rest.includes("-h")) {
  usage();
  process.exit(0);
}

const { flags, positional } = parseArgs(rest);

// Resolve the active Store (LocalStore or ApiStore) lazily and once. Only data
// commands trigger resolution; utility commands (docs/key/mcp install) do not.
let _store: Store | undefined;
function store(): Store {
  if (_store) return _store;
  try {
    _store = getStore();
  } catch (e: any) {
    // Misconfigured cloud mode (e.g. mode=cloud but no API key). Fail loud with a
    // clean message instead of silently reading the wrong dataset.
    console.error(e?.message ?? String(e));
    process.exit(1);
  }
  return _store;
}

switch (command) {
  case "docs":
  case "guide": {
    docs();
    break;
  }

  case "set": {
    const [key, value] = positional;
    if (!key || !value) { console.error("Usage: secrets set <key> <value>"); process.exit(1); }
    const type = (flags.type as SecretEntry["type"]) ?? "other";
    if (!SECRET_TYPES.includes(type)) {
      console.error(`Invalid type "${type}". Valid: ${SECRET_TYPES.join(", ")}`);
      process.exit(1);
    }
    // Warn if AGENT_ID is set but agent is not registered — mirrors open-todos
    // pattern. Best-effort DX only; never let it fail the write (a lookup error
    // in api mode must not block storing a secret).
    const agentId = process.env["AGENT_ID"];
    if (agentId) {
      try {
        if (!(await store().getUser(agentId))) {
          console.warn(`⚠ Warning: AGENT_ID="${agentId}" is set but not registered. Run: secrets users register ${agentId} <name> --type agent`);
        }
      } catch {
        /* ignore: the unregistered-agent hint is advisory */
      }
    }
    const expiresAt = flags.ttl ? parseTtl(flags.ttl) : undefined;
    try {
      const entry = await store().setSecret(key, value, type, flags.label, expiresAt);
      console.log(`✓ Stored: ${entry.key} [${entry.type}]${expiresAt ? ` (expires ${new Date(expiresAt).toLocaleDateString()})` : ""}`);
    } catch (e: any) {
      console.error(e.message);
      process.exit(1);
    }
    break;
  }

  case "get": {
    const [key] = positional;
    if (!key) { console.error("Usage: secrets get <key>"); process.exit(1); }
    let entry;
    try {
      entry = await store().getSecret(key);
    } catch (e: any) {
      // A single-key read is strict: ApiStore.getSecret maps 404 to `undefined`
      // (handled as "Not found" below) but RETHROWS every other failure — e.g. a
      // server-side decrypt 500. Catch it here so the CLI prints a clean one-line
      // error and exits non-zero, instead of leaking a raw HasnaHttpError stack
      // trace + internal frames (matches the export-env "Skipped unreadable" path).
      // The message is value-free (method/path/status only); never log the value.
      console.error(`Unable to read secret "${key}": ${e?.message ?? String(e)}`);
      process.exit(1);
    }
    if (!entry) { console.error(`Not found: ${key}`); process.exit(1); }
    if (process.stdout.isTTY) {
      console.log(formatEntry(entry, true));
    } else {
      process.stdout.write(entry.value);
    }
    break;
  }

  case "delete":
  case "remove":
  case "rm":
  case "uninstall": {
    const [key] = positional;
    if (!key) { console.error(`Usage: secrets ${command} <key>`); process.exit(1); }
    if (!await store().deleteSecret(key)) { console.error(`Not found: ${key}`); process.exit(1); }
    console.log(`✓ Deleted: ${key}`);
    break;
  }

  case "list": {
    const [namespace] = positional;
    const entries = await store().listSecretMetadata(namespace);
    if ("json" in flags) {
      console.log(JSON.stringify(entries, null, 2));
      break;
    }
    if (entries.length === 0) {
      console.log(namespace ? `No secrets in namespace: ${namespace}` : "Vault is empty.");
    } else {
      for (const e of entries) console.log(formatEntry(e));
      console.log(`\n${entries.length} secret(s)`);
    }
    break;
  }

  case "search": {
    const [query] = positional;
    if (!query) { console.error("Usage: secrets search <query>"); process.exit(1); }
    const results = await store().searchSecretMetadata(query);
    if ("json" in flags) {
      console.log(JSON.stringify(results, null, 2));
      break;
    }
    if (results.length === 0) { console.log(`No results for: ${query}`); }
    else {
      for (const e of results) console.log(formatEntry(e));
      console.log(`\n${results.length} result(s)`);
    }
    break;
  }

  case "export": {
    const showPlaintext = flags.show === "true" || flags.plaintext === "true";
    if (showPlaintext && flags.redact === "true") {
      console.error("Usage: secrets export [--show|--plaintext] [--pretty]. Do not combine --redact with plaintext flags.");
      process.exit(1);
    }
    console.log(formatJson(await store().exportSecrets(!showPlaintext), flags.pretty === "true"));
    break;
  }

  case "scan": {
    const [target = "workspace", root] = positional;
    const { scanWorkspaceExposures, scanHistoryExposures } = await import("./scanner.js");
    const common = {
      root,
      limit: positiveIntegerFlag(flags, "limit"),
    };
    switch (target) {
      case "workspace": {
        const result = scanWorkspaceExposures({
          ...common,
          maxFileBytes: positiveIntegerFlag(flags, "max-bytes"),
          maxFiles: positiveIntegerFlag(flags, "max-files"),
          maxBytesScanned: positiveIntegerFlag(flags, "max-scan-bytes"),
          timeoutMs: positiveIntegerFlag(flags, "timeout-ms"),
        });
        console.log(formatJson(result, flags.pretty === "true"));
        break;
      }
      case "history": {
        const result = scanHistoryExposures({
          ...common,
          maxCommits: positiveIntegerFlag(flags, "max-commits"),
          timeoutMs: positiveIntegerFlag(flags, "timeout-ms"),
        });
        console.log(formatJson(result, flags.pretty === "true"));
        break;
      }
      default:
        console.error("Usage: secrets scan workspace|history [path] [--limit <n>] [--max-bytes <n>] [--max-files <n>] [--max-scan-bytes <n>] [--max-commits <n>] [--timeout-ms <n>] [--pretty]");
        process.exit(1);
    }
    break;
  }

  case "security": {
    const [sub = "permissions"] = positional;
    const {
      auditSecretFilePermissions,
      runSecurityExposureSweep,
      runSupplyChainWatch,
    } = await import("./security.js");
    const pretty = flags.pretty === "true" || flags.json === "true";

    switch (sub) {
      case "permissions": {
        const result = auditSecretFilePermissions({
          roots: commaListFlag(flags, "roots") ?? commaListFlag(flags, "root"),
          maxFiles: positiveIntegerFlag(flags, "max-files"),
          fixPermissions: flags["fix-permissions"] === "true",
        });
        let output: Record<string, unknown> = result as unknown as Record<string, unknown>;
        if (flags["upsert-tasks"] === "true") {
          const { defaultLoopsTodosProject, upsertSecurityTaskSuggestions } = await import("./loop-tasks.js");
          const upsert = upsertSecurityTaskSuggestions(result.task_suggestions, {
            project: flags["todos-project"] ?? defaultLoopsTodosProject(),
            taskList: flags["task-list"] ?? "secret-file-permissions",
            taskListName: flags["task-list-name"] ?? "Secret File Permissions",
            taskListDescription: "Deduped deterministic OpenSecrets findings for unsafe sensitive-file permissions.",
            maxActions: positiveIntegerFlag(flags, "max-task-actions"),
          });
          output = { ...output, todos: upsert };
          if (upsert.summary.errors > 0) process.exitCode = 1;
        }
        if (flags["report-dir"]) {
          const { writeSecureLoopReport } = await import("./loop-tasks.js");
          const reportPath = writeSecureLoopReport(output, {
            reportDir: flags["report-dir"],
            prefix: "secret-file-permissions",
            annotatePath: true,
          });
          if (reportPath) {
            const loop = output.loop && typeof output.loop === "object" && !Array.isArray(output.loop)
              ? output.loop as Record<string, unknown>
              : {};
            output = { ...output, loop: { ...loop, report_path: reportPath } };
          }
        }
        console.log(formatJson(output, pretty));
        if (result.summary.findings > 0 && !result.fixed) process.exitCode = 1;
        break;
      }
      case "exposure": {
        const mode = flags.mode === "history" ? "history" : "workspace";
        const result = runSecurityExposureSweep({
          roots: commaListFlag(flags, "roots") ?? commaListFlag(flags, "root"),
          mode,
          limit: positiveIntegerFlag(flags, "limit"),
          maxFiles: positiveIntegerFlag(flags, "max-files"),
          maxBytesScanned: positiveIntegerFlag(flags, "max-scan-bytes"),
          maxCommits: positiveIntegerFlag(flags, "max-commits"),
          timeoutMs: positiveIntegerFlag(flags, "timeout-ms"),
        });
        console.log(formatJson(result, pretty));
        if (result.summary.findings > 0 || result.summary.errors > 0) process.exitCode = 1;
        break;
      }
      case "supply-chain": {
        const result = runSupplyChainWatch({
          roots: commaListFlag(flags, "roots") ?? commaListFlag(flags, "root"),
          maxFiles: positiveIntegerFlag(flags, "max-files"),
          maxFindings: positiveIntegerFlag(flags, "max-findings"),
        });
        console.log(formatJson(result, pretty));
        if (result.summary.findings > 0) process.exitCode = 1;
        break;
      }
      default:
        console.error("Usage: secrets security permissions|exposure|supply-chain [--roots <paths>] [--json|--pretty]");
        process.exit(1);
    }
    break;
  }

  case "import": {
    const [file] = positional;
    if (!file) { console.error("Usage: secrets import <json-file>"); process.exit(1); }
    try {
      const { readFileSync } = await import("fs");
      const data = JSON.parse(readFileSync(file, "utf-8"));
      const entries = Array.isArray(data) ? data : data.secrets ? Object.values(data.secrets) : [];
      const hasRedactedValues = data?.redacted === true ||
        entries.some((entry: any) => entry?.value === "***REDACTED***");
      if (hasRedactedValues) {
        console.error("Import refused: this looks like a redacted export. Use `secrets export --show` to create a restorable local backup.");
        process.exit(1);
      }
      const count = await store().importSecrets(entries as any);
      console.log(`✓ Imported ${count} secret(s)`);
    } catch (e: any) {
      console.error(`Import failed: ${e.message}`);
      process.exit(1);
    }
    break;
  }

  case "status": {
    const status = await getSecretReferenceStatus();
    if ("json" in flags) {
      console.log(JSON.stringify(status, null, 2));
    } else {
      console.log(`secrets ${status.package.version}`);
      console.log(`mode: ${status.mode}`);
      console.log(`location: ${status.location}`);
      console.log(`secrets: ${status.counts.secrets}`);
      console.log(`users: ${status.counts.users}`);
      console.log("values: not included");
    }
    break;
  }

  case "gc": {
    const count = await store().pruneExpired();
    console.log(`✓ Pruned ${count} expired secret(s)`);
    break;
  }

  case "audit": {
    const [key] = positional;
    const limit = flags.limit ? parseInt(flags.limit) : 50;
    const entries = await store().getAuditLog(key, limit);
    if ("json" in flags) {
      console.log(JSON.stringify(entries, null, 2));
      break;
    }
    if (entries.length === 0) { console.log("No audit entries."); }
    else {
      for (const e of entries) {
        console.log(`[${e.timestamp}] ${e.action.toUpperCase().padEnd(6)} ${e.key} — ${e.agent}`);
      }
    }
    break;
  }

  case "path": {
    console.log(store().describe().location);
    break;
  }

  case "users": {
    // Flags (e.g. --type) are already extracted by the top-level parseArgs into
    // `flags`; the subcommand args are the remaining positionals. Re-parsing
    // `userRest` would miss --type entirely (it was consumed above), which is why
    // `users register/list --type agent` used to silently fall back to "human".
    const [sub, ...uPos] = positional;
    switch (sub) {
      case "list": {
        const users = await store().listUsers(flags.type as any);
        if ("json" in flags) {
          console.log(JSON.stringify(users, null, 2));
          break;
        }
        if (users.length === 0) { console.log("No users registered."); }
        else {
          for (const u of users) {
            const seen = u.last_seen ? ` (last seen: ${new Date(u.last_seen).toLocaleDateString()})` : "";
            console.log(`${u.id} [${u.type}] — ${u.name}${seen}`);
          }
          console.log(`\n${users.length} user(s)`);
        }
        break;
      }
      case "register": {
        const [id, name] = uPos;
        if (!id || !name) { console.error("Usage: secrets users register <id> <name> [--type human|agent]"); process.exit(1); }
        const type = (flags.type as string) ?? "human";
        if (type !== "human" && type !== "agent") {
          console.error(`Invalid type "${type}". Valid: human, agent`);
          process.exit(1);
        }
        const user = await store().registerUser(id, name, type);
        console.log(`✓ Registered: ${user.id} [${user.type}] — ${user.name}`);
        break;
      }
      case "delete": {
        const [id] = uPos;
        if (!id) { console.error("Usage: secrets users delete <id>"); process.exit(1); }
        if (!await store().deleteUser(id)) { console.error(`Not found: ${id}`); process.exit(1); }
        console.log(`✓ Deleted user: ${id}`);
        break;
      }
      default:
        console.error(`Unknown users subcommand: ${sub}`);
        process.exit(1);
    }
    break;
  }

  case "items": {
    await runItemsCommand(store, positional, flags);
    break;
  }

  case "aws": {
    const [sub, ...awsRest] = positional;
    const { loadAwsConfig, saveAwsConfig, pushSecret, pullSecret, syncAll } = await import("./aws.js");
    const awsOptions = parseAwsOptions(flags);

    switch (sub) {
      case "configure": {
        const readline = await import("readline");
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const ask = (q: string): Promise<string> =>
          new Promise((r) => rl.question(q, r));

        console.log("Configure AWS Secrets Manager access\n");
        const access_key_id = await ask("AWS Access Key ID: ");
        const secret_access_key = await ask("AWS Secret Access Key: ");
        const region = await ask("AWS Region [us-east-1]: ") || "us-east-1";
        const prefix = await ask("Key prefix (optional, e.g. open-secrets/prod): ");
        rl.close();

        saveAwsConfig({ access_key_id, secret_access_key, region, prefix: prefix || undefined });
        console.log("✓ AWS configuration saved");
        break;
      }

      case "push": {
        const [key] = awsRest;
        if (key) {
          const result = await pushSecret(key, awsOptions);
          if (result) console.log(JSON.stringify(result, null, 2));
          else console.log(`✓ Pushed: ${key}`);
        } else {
          const entries = await store().listSecretMetadata();
          const dryRunActions = [];
          let dryRunResult: any;
          for (const e of entries) {
            const result = await pushSecret(e.key, awsOptions);
            if (result) {
              dryRunResult = result;
              dryRunActions.push(...result.actions);
            } else {
              console.log(`✓ Pushed: ${e.key}`);
            }
          }
          if (dryRunResult) {
            console.log(JSON.stringify({ ...dryRunResult, actions: dryRunActions }, null, 2));
          }
        }
        break;
      }

      case "pull": {
        const [key] = awsRest;
        if (!key) { console.error("Usage: secrets aws pull <key>"); process.exit(1); }
        const result = await pullSecret(key, awsOptions);
        if (result) console.log(JSON.stringify(result, null, 2));
        else console.log(`✓ Pulled: ${key}`);
        break;
      }

      case "sync": {
        if (!awsOptions.dryRun) console.log("Syncing with AWS Secrets Manager...");
        const { pushed, pulled, errors, plan } = await syncAll(awsOptions);
        if (plan) {
          console.log(JSON.stringify(plan, null, 2));
          break;
        }
        if (pushed.length) console.log(`Pushed (${pushed.length}): ${pushed.join(", ")}`);
        if (pulled.length) console.log(`Pulled (${pulled.length}): ${pulled.join(", ")}`);
        if (errors.length) { console.error(`Errors:\n${errors.map(e => `  ${e}`).join("\n")}`); }
        console.log("✓ Sync complete");
        break;
      }

      default:
        console.error(`Unknown aws subcommand: ${sub}`);
        process.exit(1);
    }
    break;
  }

  case "serve": {
    const [sub] = positional;
    if (sub === "token") {
      const { getOrCreateServeToken } = await import("./serve.js");
      console.log(getOrCreateServeToken());
    } else {
      const { startHttpServer } = await import("./serve.js");
      await startHttpServer();
    }
    break;
  }

  case "mcp": {
    const [sub] = positional;
    if (sub === "install") {
      const targets = flags.target ? [flags.target] : ["claude", "codex", "gemini"];
      const { installMcp } = await import("./install.js");
      installMcp(targets);
    } else if (flags.stdio === "true") {
      const { startMcpServer } = await import("./mcp.js");
      await startMcpServer();
    } else {
      const { isHttpMode, resolveMcpHttpPort, startMcpHttpServer } = await import("./mcp-http.js");
      const mcpArgs = [
        ...(sub === "http" || flags.http === "true" ? ["--http"] : []),
        ...(flags.port ? ["--port", String(flags.port)] : []),
      ];
      if (isHttpMode(mcpArgs)) {
        const { buildServer } = await import("./mcp.js");
        startMcpHttpServer({ name: "secrets", port: resolveMcpHttpPort(mcpArgs), buildServer });
      } else {
        const { startMcpServer } = await import("./mcp.js");
        await startMcpServer();
      }
    }
    break;
  }

  case "import-env": {
    const { importEnv } = await import("./env.js");
    try {
      const result = await importEnv({
        dir: flags.dir,
        push: "push" in flags,
        dryRun: "dry-run" in flags,
        overwrite: "overwrite" in flags,
      });
      if ("dry-run" in flags) {
        console.log(`\n[dry-run] Would import ${result.imported} secret(s) from ${result.files} file(s)`);
      } else {
        console.log(`✓ Imported ${result.imported} secret(s) from ${result.files} file(s)`);
        if (result.skipped > 0) console.log(`  Skipped ${result.skipped} already-existing key(s) (use --overwrite to replace)`);
      }
    } catch (e: any) {
      console.error(`Import failed: ${e.message}`);
      process.exit(1);
    }
    break;
  }

  case "export-env": {
    const { exportEnv } = await import("./env.js");
    try {
      const result = await exportEnv({
        dir: flags.dir,
        force: "force" in flags,
        dryRun: "dry-run" in flags,
      });
      if ("dry-run" in flags) {
        console.log(`\n[dry-run] Would export ${result.exported} secret(s) to ${result.files} file(s)`);
      } else {
        console.log(`✓ Exported ${result.exported} secret(s) to ${result.files} file(s)`);
        if (result.skippedFiles > 0) console.log(`  Skipped ${result.skippedFiles} existing file(s) (use --force to overwrite)`);
      }
    } catch (e: any) {
      console.error(`Export failed: ${e.message}`);
      process.exit(1);
    }
    break;
  }

  case "encrypt-vault": {
    // Migrate all plaintext secrets to encrypted (local vault maintenance).
    try {
      const { migrated, alreadyEncrypted } = await store().encryptVault();
      console.log(`✓ Encrypted ${migrated} secret(s). ${alreadyEncrypted} already encrypted.`);
    } catch (e: any) {
      console.error(e.message);
      process.exit(1);
    }
    break;
  }

  case "key": {
    // The `key` family (init, kms setup, status) manages the LOCAL encryption
    // master key. In api mode the server owns encryption at rest, so these are
    // meaningless and must not create a local key file. Guard like encrypt-vault.
    if (store().mode === "api") {
      console.error("`secrets key` is a local-vault operation; in api mode the server owns encryption at rest.");
      process.exit(1);
    }
    const [sub] = positional;
    const { statSync } = await import("fs");

    if (sub === "kms") {
      const [kmsAction] = positional.slice(1);
      if (kmsAction === "setup") {
        const keyId = flags["key-id"] ?? flags.key;
        if (!keyId) { console.error("Usage: secrets key kms setup --key-id <KMS key ID or alias> [--region <region>] [--profile <profile>]"); process.exit(1); }
        const region = flags.region ?? "us-east-1";
        initKms(keyId, region, flags.profile);
        console.log(`✓ KMS configured: ${keyId} (${region})`);
        // Trigger migration if local key exists
        getMasterKey();
        const status = getKeyStatus();
        if (status.mode === "kms") {
          console.log(`✓ Data key wrapped with KMS and stored at ${status.keyPath}`);
        }
      } else {
        const status = getKeyStatus();
        if (status.mode === "kms") {
          console.log(`Mode:       KMS (envelope encryption)`);
          console.log(`KMS Key:    ${status.kmsKeyId}`);
          console.log(`Data key:   ${status.keyPath} (encrypted with KMS)`);
        } else {
          console.log(`KMS not configured.`);
          console.log(`\nSetup: secrets key kms setup --key-id <KMS key ID or alias> [--region us-east-1] [--profile example-aws-profile]`);
        }
      }
    } else if (sub === "path") {
      const status = getKeyStatus();
      console.log(status.keyPath);
    } else if (sub === "exists") {
      const status = getKeyStatus();
      console.log(status.exists ? "yes" : "no");
    } else if (sub === "init") {
      getMasterKey();
      const status = getKeyStatus();
      console.log(`✓ Master key ready (${status.mode} mode) at ${status.keyPath}`);
    } else {
      const status = getKeyStatus();
      console.log(`Mode:       ${status.mode}`);
      if (status.kmsKeyId) console.log(`KMS Key:    ${status.kmsKeyId}`);
      console.log(`Key file:   ${status.keyPath}`);
      console.log(`Exists:     ${status.exists ? "✓ yes" : "✗ no"}`);
      if (status.exists) {
        try {
          const stat = statSync(status.keyPath);
          const mode = (stat.mode & 0o777).toString(8);
          console.log(`Permissions: ${mode}${mode === "600" ? " (correct)" : " ⚠ should be 600"}`);
        } catch { /* skip */ }
      }
      console.log(`\nCommands:`);
      console.log(`  secrets key init                     Generate/load key`);
      console.log(`  secrets key path                     Show key file path`);
      console.log(`  secrets key kms setup --key-id <id>  Enable KMS envelope encryption`);
      console.log(`  secrets key kms                      Show KMS status`);
    }
    break;
  }

  case "feedback": {
    const [msg, ...restMsg] = positional;
    const message = [msg, ...restMsg.filter(r => !r.startsWith("--"))].join(" ");
    if (!message) { console.error("Usage: secrets feedback <message> [--email <email>] [--category <cat>]"); process.exit(1); }
    try {
      await store().sendFeedback(message, flags.email || undefined, flags.category || "general");
      console.log("✓ Feedback saved. Thank you!");
    } catch (e: any) {
      console.error(`Failed to send feedback: ${e?.message ?? String(e)}`);
      process.exit(1);
    }
    break;
  }

  default: {
    console.error(`Unknown command: ${command}`);
    usage();
    process.exit(1);
  }
}
