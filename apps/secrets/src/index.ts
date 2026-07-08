#!/usr/bin/env bun
import { getStore } from "./store/index.js";
import type { Store } from "./store/types.js";
import { getMasterKey, initKms, getKeyStatus } from "./crypto.js";
import type { SecretEntry, SecretMetadata, VaultItemKind, VaultItemMetadata, VaultItemPayload } from "./types.js";
import { getSecretReferenceStatus } from "./status.js";

const SECRET_TYPES: SecretEntry["type"][] = ["api_key", "password", "token", "credential", "other"];
const VAULT_ITEM_KINDS: VaultItemKind[] = [
  "login",
  "address",
  "identity",
  "payment_card",
  "secure_note",
  "api_key",
  "custom",
];

function usage(): void {
  console.log(`
secrets — local secrets vault for AI agents

Commands:
  docs                        show a practical usage guide
  set <key> <value> [--type <type>] [--label <label>] [--ttl <ttl>]
  get <key>
  delete <key>               (aliases: remove, rm, uninstall)
  items list [kind]           list structured vault items
  items search <query>        search structured vault item metadata
  items get <id> [--show]     show a structured vault item; redacted unless --show is passed
  items delete <id>           delete a structured vault item
  items add-login --title <title> --url <url> --username <user> --password <pass>
  items add-address --title <title> [--name <name>] [--line1 <line>] [--city <city>]
  import-env                 import ~/.secrets/ .env files into vault [--dir <path>] [--push] [--dry-run] [--overwrite]
  export-env                 export vault secrets to ~/.secrets/ .env files [--dir <path>] [--force] [--dry-run]
  list [namespace]
  search <query>
  export [--show|--plaintext] [--pretty]  export redacted compact JSON by default
  scan workspace [path] [--limit <n>] [--max-bytes <n>] [--max-files <n>] [--max-scan-bytes <n>] [--timeout-ms <n>] [--pretty]
  scan history [path] [--limit <n>] [--max-commits <n>] [--timeout-ms <n>] [--pretty]
  security permissions [--roots <paths>] [--fix-permissions] [--report-dir <dir>] [--upsert-tasks] [--todos-project <path>] [--task-list <slug>] [--max-task-actions <n>] [--json|--pretty]
  security exposure [--mode workspace|history] [--roots <paths>] [--limit <n>] [--json|--pretty]
  security supply-chain [--roots <paths>] [--max-files <n>] [--max-findings <n>] [--json|--pretty]
  import <json-file>
  status                      show metadata-only secret reference health
  gc                          prune expired secrets
  audit [key]                 show audit log
  path                        show vault db path
  events                      emit, list, and replay Hasna events
  webhooks                    manage Hasna event webhook subscriptions

  users list [--type human|agent]
  users register <id> <name> [--type human|agent]
  users delete <id>

  encrypt-vault               encrypt all plaintext secrets in the vault
  key                         show master key status
  key init                    generate master key if missing
  key path                    show master key file path

  aws configure               interactive AWS setup
  aws push [key]              push secret(s) to AWS Secrets Manager [--dry-run|--plan]
  aws pull <key>              pull secret from AWS Secrets Manager [--dry-run|--plan]
  aws sync                    bidirectional sync [--dry-run|--plan]

  serve                       start local HTTP server for Chrome extension (port 27462)
  serve token                 print the current serve token

  feedback <message>          send feedback [--email <email>] [--category <cat>]
  mcp                         start MCP server (stdio)
  mcp http [--port <n>]        start Streamable HTTP MCP server
  mcp install [--target claude|codex|gemini]  install MCP into AI agents

Types: ${SECRET_TYPES.join(", ")}
TTL examples: 30d, 24h, 60m

Examples:
  secrets set openai/api_key "$OPENAI_API_KEY" --type api_key
  secrets set gmail/password "$GMAIL_PASSWORD" --type password --label "Gmail"
  secrets get openai/api_key
  secrets list openai
  secrets search gmail
  secrets users register my-agent "My Agent" --type agent
  secrets aws configure
  secrets aws sync

Self-hosted (api mode): set HASNA_SECRETS_API_URL + HASNA_SECRETS_API_KEY to route
all reads/writes to the cloud API. Unset them to fall back to the local vault.
`);
}

function docs(): void {
  console.log(`
secrets docs

Purpose
  secrets is a local encrypted vault for API keys, passwords, tokens, and
  credentials that need to be available to CLIs and AI agents without being
  committed to source control.

Storage
  Vault database:   ~/.hasna/secrets/vault.db
  Key material:     ~/.hasna/secrets/vault.key or vault.key.enc
  Env-file bridge:  ~/.secrets/{division}/{service}/{env}.env

Key format
  Use slash-delimited keys:
    <division>/<service>/<env>/<name>

  Examples:
    example/anthropic/test/api_key
    example/local/dev-workstation/tool/exa-api-key
    example-app/oauth/youtube_client_secret

Common CLI workflows
  Store a secret:
    secrets set example/anthropic/test/api_key "$ANTHROPIC_API_KEY" --type api_key --label "Anthropic API Key (test)"

  Read a secret value:
    secrets get example/anthropic/test/api_key

  List or search without revealing values:
    secrets list example/anthropic
    secrets search anthropic

  Review access history:
    secrets audit example/anthropic/test/api_key

  Export redacted JSON for review:
    secrets export

  Export plaintext only when a restorable local artifact is explicitly needed:
    secrets export --show --pretty > secrets-backup.json

  Scan the current workspace or bounded git history for exposed credentials:
    secrets scan workspace --limit 50
    secrets scan history --max-commits 200 --limit 50

Structured vault items
  Store a browser login:
    secrets items add-login --title "GitHub" --url https://github.com --username you@example.com --password "$GITHUB_PASSWORD"

  Store an address for checkout/profile forms:
    secrets items add-address --title "Home" --name "Example User" --line1 "1 Main St" --city "New York" --state "NY" --postal-code "10001" --country US

  Review items:
    secrets items list
    secrets items search github
    secrets items get <id>        # redacted
    secrets items get <id> --show # decrypted payload

Env-file bridge
  Import ~/.secrets .env files into the vault:
    secrets import-env --dir ~/.secrets --dry-run
    secrets import-env --dir ~/.secrets --overwrite

  Export vault entries back to ~/.secrets .env files:
    secrets export-env --dir ~/.secrets --dry-run
    secrets export-env --dir ~/.secrets --force

AWS Secrets Manager sync
  Preview metadata-only actions with profile/default-chain credentials:
    AWS_PROFILE=hasna-xyz-infra secrets aws sync --dry-run
    secrets aws push hasna/xyz/opensource/files/prod/s3 --profile hasna-xyz-infra --dry-run

  Legacy static-key aws.json behavior remains supported:
    secrets aws configure
    secrets aws sync

MCP usage
  Install the MCP server into local agents:
    secrets mcp install --target codex
    secrets mcp install --target claude
    secrets mcp install --target gemini

  Agents connect over stdio by running:
    secrets mcp

  Start the Streamable HTTP MCP server explicitly:
    secrets mcp http --port 8848

  MCP tools:
    list_secrets(namespace?)
    search_secrets(query)
    get_secret(key)
    set_secret(key, value, type?, label?, ttl?)
    delete_secret(key)
    audit_log(key?, limit?)
    scan_workspace_exposures(root?, limit?, maxFileBytes?, maxFiles?, maxBytesScanned?, timeoutMs?)
    scan_history_exposures(root?, limit?, maxCommits?, timeoutMs?)

Self-hosted (api mode)
  Route all reads/writes to the cloud API instead of the local vault:
    export HASNA_SECRETS_API_URL=https://secrets.hasna.xyz
    export HASNA_SECRETS_API_KEY=<bearer key from your vault>

  Unset both vars to fall back to the local encrypted vault (fully reversible).
  A raw database URL is NEVER used on the client.

Safety
  list, search, export, and scan commands do not print secret values by default.
  export --show and export --plaintext are explicit plaintext escape hatches.
  get and get_secret return raw secret values. Use them only when needed.
  Never paste secrets into commits, logs, issues, PRs, or chat messages.
`);
}

const BOOLEAN_FLAGS = new Set([
  "redact",
  "push",
  "dry-run",
  "plan",
  "force",
  "overwrite",
  "show",
  "plaintext",
  "pretty",
  "favorite",
  "json",
  "fix-permissions",
]);

function parseArgs(args: string[]): { flags: Record<string, string>; positional: string[] } {
  const flags: Record<string, string> = {};
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      if (BOOLEAN_FLAGS.has(key) || !args[i + 1] || args[i + 1].startsWith("--")) {
        flags[key] = "true";
      } else {
        flags[key] = args[i + 1];
        i++;
      }
    } else {
      positional.push(args[i]);
    }
  }
  return { flags, positional };
}

function parseTtl(ttl: string): string {
  const match = ttl.match(/^(\d+)([smhd])$/);
  if (!match) { console.error(`Invalid TTL: ${ttl}. Use e.g. 30d, 24h, 60m`); process.exit(1); }
  const [, num, unit] = match;
  const ms = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit as string]!;
  return new Date(Date.now() + parseInt(num) * ms).toISOString();
}

function formatEntry(entry: SecretEntry | SecretMetadata, showValue = false): string {
  const val = showValue && "value" in entry ? entry.value : "***";
  const label = entry.label ? ` (${entry.label})` : "";
  const expiry = entry.expires_at
    ? ` [expires: ${new Date(entry.expires_at).toLocaleDateString()}]`
    : "";
  const expired =
    entry.expires_at && new Date(entry.expires_at) < new Date() ? " [EXPIRED]" : "";
  return `${entry.key}${label} [${entry.type}]${expiry}${expired} = ${val}`;
}

function splitFlagList(value?: string): string[] {
  if (!value) return [];
  return value.split(",").map((entry) => entry.trim()).filter(Boolean);
}

function itemDomains(flags: Record<string, string>): string[] {
  return [
    ...splitFlagList(flags.domain),
    ...splitFlagList(flags.domains),
    ...(flags.url ? [flags.url] : []),
  ];
}

function requireFlag(flags: Record<string, string>, name: string, usageText: string): string {
  const value = flags[name]?.trim();
  if (!value) {
    console.error(usageText);
    process.exit(1);
  }
  return value;
}

function compactPayload(payload: VaultItemPayload): VaultItemPayload {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined && value !== null && value !== "")
  );
}

function redactVaultPayload(data: VaultItemPayload): VaultItemPayload {
  const sensitive = new Set([
    "password",
    "totp",
    "cardNumber",
    "securityCode",
    "cvv",
    "secret",
    "token",
    "apiKey",
  ]);
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [
      key,
      sensitive.has(key) && value ? "***REDACTED***" : value,
    ])
  );
}

function formatVaultItem(item: VaultItemMetadata): string {
  const domains = item.domains.length ? ` ${item.domains.join(",")}` : "";
  const subtitle = item.subtitle ? ` - ${item.subtitle}` : "";
  const favorite = item.favorite ? " *" : "";
  return `${item.id} [${item.kind}]${favorite} ${item.title}${subtitle}${domains}`;
}

function parseAwsOptions(flags: Record<string, string>) {
  return {
    dryRun: flags["dry-run"] === "true" || flags.plan === "true",
    region: flags.region,
    prefix: flags.prefix,
    profile: flags.profile,
    credentialMode: flags["credential-mode"] as any,
    roleArn: flags["role-arn"],
    sourceProfile: flags["source-profile"],
    externalId: flags["external-id"],
    sessionName: flags["session-name"],
  };
}

function formatJson(value: unknown, pretty = false): string {
  return JSON.stringify(value, null, pretty ? 2 : 0);
}

function positiveIntegerFlag(flags: Record<string, string>, name: string): number | undefined {
  const value = flags[name];
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    console.error(`Invalid --${name}: ${value}. Use a positive integer.`);
    process.exit(1);
  }
  return parsed;
}

function commaListFlag(flags: Record<string, string>, name: string): string[] | undefined {
  const value = flags[name];
  if (!value) return undefined;
  const parts = value.split(",").map((entry) => entry.trim()).filter(Boolean);
  return parts.length > 0 ? parts : undefined;
}

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
  registerEventsCommands(program, { source: "secrets", webhooksCommandName: "webhooks" });
  await program.parseAsync(["node", "secrets", ...args]);
  return true;
}

if (await runSharedEventCli(args)) process.exit(0);
const [command, ...rest] = args;

if (!command || command === "--help" || command === "-h") {
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
    const entry = await store().getSecret(key);
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
    const [sub, idOrKind] = positional;
    switch (sub) {
      case "list": {
        const kind = idOrKind as VaultItemKind | undefined;
        if (kind && !VAULT_ITEM_KINDS.includes(kind)) {
          console.error(`Invalid kind "${kind}". Valid: ${VAULT_ITEM_KINDS.join(", ")}`);
          process.exit(1);
        }
        const items = await store().listVaultItemMetadata(kind);
        if (items.length === 0) {
          console.log(kind ? `No ${kind} vault items.` : "No structured vault items.");
        } else {
          for (const item of items) console.log(formatVaultItem(item));
          console.log(`\n${items.length} item(s)`);
        }
        break;
      }

      case "search": {
        const query = idOrKind;
        if (!query) { console.error("Usage: secrets items search <query>"); process.exit(1); }
        const items = await store().searchVaultItemMetadata(query);
        if (items.length === 0) {
          console.log(`No vault items for: ${query}`);
        } else {
          for (const item of items) console.log(formatVaultItem(item));
          console.log(`\n${items.length} item(s)`);
        }
        break;
      }

      case "get": {
        const id = idOrKind;
        if (!id) { console.error("Usage: secrets items get <id> [--show]"); process.exit(1); }
        const item = await store().getVaultItem(id);
        if (!item) { console.error(`Not found: ${id}`); process.exit(1); }
        console.log(JSON.stringify({
          ...item,
          data: flags.show === "true" ? item.data : redactVaultPayload(item.data),
        }, null, 2));
        break;
      }

      case "delete":
      case "rm":
      case "remove": {
        const id = idOrKind;
        if (!id) { console.error(`Usage: secrets items ${sub} <id>`); process.exit(1); }
        if (!await store().deleteVaultItem(id)) { console.error(`Not found: ${id}`); process.exit(1); }
        console.log(`✓ Deleted vault item: ${id}`);
        break;
      }

      case "add-login": {
        const title = requireFlag(flags, "title", "Usage: secrets items add-login --title <title> --url <url> --username <user> --password <pass>");
        const username = requireFlag(flags, "username", "Usage: secrets items add-login --title <title> --url <url> --username <user> --password <pass>");
        const password = requireFlag(flags, "password", "Usage: secrets items add-login --title <title> --url <url> --username <user> --password <pass>");
        const item = await store().setVaultItem({
          kind: "login",
          title,
          subtitle: username,
          domains: itemDomains(flags),
          tags: splitFlagList(flags.tags ?? flags.tag),
          favorite: flags.favorite === "true",
          data: compactPayload({
            username,
            password,
            url: flags.url,
            notes: flags.notes,
            totp: flags.totp,
          }),
        });
        console.log(`✓ Stored vault item: ${item.id} [${item.kind}] ${item.title}`);
        break;
      }

      case "add-address": {
        const title = requireFlag(flags, "title", "Usage: secrets items add-address --title <title> [--name <name>] [--line1 <line>] [--city <city>]");
        const item = await store().setVaultItem({
          kind: "address",
          title,
          subtitle: flags.name ?? flags.email ?? flags.phone,
          domains: itemDomains(flags),
          tags: splitFlagList(flags.tags ?? flags.tag),
          favorite: flags.favorite === "true",
          data: compactPayload({
            name: flags.name,
            givenName: flags["given-name"],
            familyName: flags["family-name"],
            organization: flags.organization ?? flags.company,
            addressLine1: flags.line1 ?? flags["address-line1"],
            addressLine2: flags.line2 ?? flags["address-line2"],
            city: flags.city,
            state: flags.state,
            postalCode: flags.postal ?? flags.zip ?? flags["postal-code"],
            country: flags.country,
            phone: flags.phone,
            email: flags.email,
          }),
        });
        console.log(`✓ Stored vault item: ${item.id} [${item.kind}] ${item.title}`);
        break;
      }

      case "add-note": {
        const title = requireFlag(flags, "title", "Usage: secrets items add-note --title <title> --body <text>");
        const body = requireFlag(flags, "body", "Usage: secrets items add-note --title <title> --body <text>");
        const item = await store().setVaultItem({
          kind: "secure_note",
          title,
          subtitle: flags.subtitle,
          domains: itemDomains(flags),
          tags: splitFlagList(flags.tags ?? flags.tag),
          favorite: flags.favorite === "true",
          data: { body },
        });
        console.log(`✓ Stored vault item: ${item.id} [${item.kind}] ${item.title}`);
        break;
      }

      default:
        console.error(`Unknown items subcommand: ${sub ?? ""}`);
        console.error("Usage: secrets items list|get|search|delete|add-login|add-address|add-note");
        process.exit(1);
    }
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
    await store().sendFeedback(message, flags.email || undefined, flags.category || "general");
    console.log("✓ Feedback saved. Thank you!");
    break;
  }

  default: {
    console.error(`Unknown command: ${command}`);
    usage();
    process.exit(1);
  }
}
