#!/usr/bin/env bun
import { getStoreWithResolution, LocalStore } from "./store/index.js";
import type { Store } from "./store/types.js";
import { clientTransportEnvKeys, type ClientTransportResolution } from "./store/contracts-client/transport.js";
import { getMasterKey, initKms, getKeyStatus } from "./crypto.js";
import { VERSION } from "./version.js";
import type { SecretEntry, SecretMetadata, VaultItemKind, VaultItemMetadata, VaultItemPayload } from "./types.js";
import { getSecretReferenceStatus } from "./status.js";
import {
  copySecret,
  verifyCopy,
  CopySourceEqualsDestinationError,
  CopySourceNotFoundError,
} from "./copy.js";

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

Options:
  -V, --version           print the package version and exit
  -h, --help              show this help and exit

Commands:
  docs                        show a practical usage guide
  set <key> [<value>] [--stdin] [--type <type>] [--label <label>] [--ttl <ttl>] [--reason <text>] [--rotation]
  get <key> [--show|--plaintext|--check]   redacted by default; --check prints length+sha256
  copy <old> <new> [--type <t>] [--label <l>] [--ttl <ttl>] [--reason <text>] [--verify]
                              value-safe copy/migration: reads <old> in-process, writes <new>
                              in the same call; the value never renders to any output surface
  exec <key> [--as <VAR>] -- <cmd> [args...]   run <cmd> with a local vault value in its env only
  exec --provider <PROFILE> --account <ID> --env <VAR> -- <cmd> [args...]
                              run <cmd> with an account-scoped AWS secret in <VAR>
  delete <key>               (aliases: remove, rm, uninstall)
  versions <key> [--limit <n>] [--json]   metadata-only version history; never prints values
  versions <key> --version <N> --check [--json]   length + sha256 of a version (get --check class)
  restore <key> --version <N> --reason <text> [--expect-current <N>]
                              append-only restore: copies a historical value server-side
                              into a new current version; the history is never rewound
  items list [kind] [--json]  list structured vault items
  items search <query> [--json]  search structured vault item metadata
  items get <id> [--show]     show a structured vault item; redacted unless --show is passed
  items delete <id>           delete a structured vault item
  items add-login --title <title> --url <url> --username <user> --password <pass>
  items add-address --title <title> [--name <name>] [--line1 <line>] [--city <city>]
  import-env                 import ~/.secrets/ .env files into vault [--dir <path>] [--push] [--dry-run] [--overwrite]
  export-env                 export vault secrets to ~/.secrets/ .env files [--dir <path>] [--force] [--dry-run]
  list [namespace] [--json]
  search <query> [--json]
  export [--show|--plaintext] [--pretty]  export redacted compact JSON by default
  scan workspace [path] [--limit <n>] [--cursor <cursor>] [--max-bytes <n>] [--max-files <n>] [--max-scan-bytes <n>] [--timeout-ms <n>] [--pretty]
  scan history [path] [--limit <n>] [--cursor <cursor>] [--max-commits <n>] [--timeout-ms <n>] [--pretty]
  scan staged [path] [--limit <n>] [--max-bytes <n>] [--max-files <n>] [--subtree] [--json]   commit gate; exit 0 clean / 1 finding / 2 could not scan
  scan input [path ...] [--limit <n>] [--max-bytes <n>] [--timeout-ms <n>] [--json]   scan stdin or one or more files before the text is persisted; every named path is scanned; same exit codes (aliases: stdin, text)
  security permissions [--roots <paths>] [--fix-permissions] [--report-dir <dir>] [--upsert-tasks] [--todos-project <path>] [--task-list <slug>] [--max-task-actions <n>] [--json|--pretty]
  security exposure [--mode workspace|history] [--roots <paths>] [--limit <n>] [--json|--pretty]
  security supply-chain [--roots <paths>] [--max-files <n>] [--max-findings <n>] [--json|--pretty]
  import <json-file>
  status                      show metadata-only secret reference health
  gc                          prune expired secrets
  audit [key] [--json]        show audit log
  path                        show vault db path
  events                      emit, list, and replay Hasna events
  webhooks                    manage Hasna event webhook subscriptions

  users list [--type human|agent] [--json]
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
  secrets set gmail/password --stdin < /path/to/value   # value never enters argv
  secrets exec openai/api_key --as OPENAI_API_KEY -- my-tool sync
  secrets get openai/api_key --check
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
  Vault database:   <data home>/vault.db — the effective secrets data home,
                    resolved through @hasna/paths (XDG/macOS home layout, e.g.
                    ~/.local/share/hasna/secrets). The legacy ~/.hasna/secrets
                    default stays effective until the store is migrated there
                    or HASNA_DATA_HOME is set.
  Key material:     <data home>/vault.key or vault.key.enc
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

  Consume a secret without printing it (preferred — the value only ever exists
  in the child's environment):
    secrets exec example/anthropic/test/api_key --as ANTHROPIC_API_KEY -- my-tool sync

  Prove a secret exists or compare values without revealing them:
    secrets get example/anthropic/test/api_key --check

  Move a secret to a new path without the value ever rendering anywhere
  (value-safe migration primitive; works on non-TTY without get --show):
    secrets copy example/anthropic/test/api_key anthropic/test/api_key
    secrets copy example/anthropic/test/api_key anthropic/live/api_key --type api_key \
      --label "Anthropic (live)" --reason "taxonomy 2026-08-20" --verify

  Review value history without revealing values (metadata only):
    secrets versions example/anthropic/test/api_key
    secrets versions example/anthropic/test/api_key --version 1 --check

  Recover a previous value (append-only server-side restore; history is never rewound):
    secrets restore example/anthropic/test/api_key --version 1 --reason "bad rotation, roll back"
    secrets restore example/anthropic/test/api_key --version 1 --reason "roll back" --expect-current 2

  Record why an overwrite happened:
    secrets set example/anthropic/test/api_key --stdin --reason "replaced revoked key"

  Store a value without putting it in argv (ps/shell-history safe):
    secrets set example/anthropic/test/api_key --stdin < value-file

  Explicitly print a plaintext value (escape hatch; never in captured output):
    secrets get example/anthropic/test/api_key --show

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
    AWS_PROFILE=your-aws-profile secrets aws sync --dry-run
    secrets aws push example/app/prod/s3 --profile your-aws-profile --dry-run

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
    list_vault_items(kind?)
    search_vault_items(query)
    get_vault_item(id)
    set_vault_item(kind, title, data, id?, subtitle?, domains?, tags?, favorite?)
    delete_vault_item(id)
    audit_log(key?, limit?)
    register_user(id, name, type?)
    list_users(type?)
    send_feedback(message, email?, category?)
    scan_workspace_exposures(root?, cursor?, limit?, maxFileBytes?, maxFiles?, maxBytesScanned?, timeoutMs?)
    scan_history_exposures(root?, cursor?, limit?, maxCommits?, timeoutMs?)

Self-hosted (api mode)
  Route all reads/writes to the cloud API instead of the local vault:
    export HASNA_SECRETS_API_URL=https://secrets.your-deployment.example
    export HASNA_SECRETS_API_KEY=<bearer key from your vault>

  Unset both vars to fall back to the local encrypted vault (fully reversible).
  A raw database URL is NEVER used on the client.

Safety
  NO command prints a secret value to stdout without an explicit --show or
  --plaintext flag. get is redacted by default: it refuses captured (non-TTY)
  output entirely, and prints metadata only in a terminal.
  Consume values with "secrets exec <key> -- <cmd>" (child env only), prove them
  with "secrets get <key> --check" (length + sha256), and store them with
  "secrets set <key> --stdin" so they never enter argv.
  export --show, export --plaintext, and get --show are the explicit escape hatches.
  The MCP get_secret tool still returns the raw value to the calling agent.
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
  "check",
  "stdin",
  "pretty",
  "favorite",
  "json",
  "fix-permissions",
  "rotation",
  "verify",
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
  registerEventsCommands(program, { source: "secrets", channelsCommandName: "webhooks" });
  await program.parseAsync(["node", "secrets", ...args]);
  return true;
}

if (await runSharedEventCli(args)) process.exit(0);
const [command, ...rest] = args;

// Binds-before-help class (todos row afd9e358): --version must answer
// BEFORE any store resolution or command dispatch. It previously fell through
// to command dispatch and died with rc=1 "Unknown command: --version".
if (command === "--version" || command === "-V") {
  console.log(VERSION);
  process.exit(0);
}

if (!command || command === "--help" || command === "-h") {
  usage();
  process.exit(0);
}

// `--help`/`-h` on ANY (sub)command prints usage and exits WITHOUT running the
// command. Previously these tokens were ignored (or, for `-h`, treated as a
// positional), so side-effecting subcommands (aws push/pull/sync, mcp install)
// executed anyway. Scan raw args because `parseArgs` only recognizes `--` flags.
// Never scan past a bare `--`: everything after it belongs to `exec`'s child
// command (`secrets exec k -- tool --help` must run the tool, not print usage).
const helpScanEnd = rest.indexOf("--") === -1 ? rest.length : rest.indexOf("--");
const helpScanArgs = rest.slice(0, helpScanEnd);
if (helpScanArgs.includes("--help") || helpScanArgs.includes("-h")) {
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
    const resolved = getStoreWithResolution();
    emitLocalFallbackNotice(resolved.store, resolved.resolution);
    _store = resolved.store;
  } catch (e: any) {
    // Misconfigured cloud mode (e.g. mode=cloud but no API key). Fail loud with a
    // clean message instead of silently reading the wrong dataset.
    console.error(e?.message ?? String(e));
    process.exit(1);
  }
  return _store;
}

/**
 * When the transport falls back to the LOCAL vault WITHOUT any cloud intent in
 * the environment — no API_URL+API_KEY pair (the flip signal needs BOTH) — the
 * CLI must not report a silent rc=0 empty vault. Incident 715558 (BUG
 * b76e2d56-38bf-468e-a6f9-90ea107e1b0e): an agent in a non-systemd shell
 * misdiagnosed ALL hosted credentials as missing because the CLI read the
 * unselected local vault and said "Vault is empty."
 *
 * The emission is one machine-readable JSON line on stderr (stdout stays pure
 * for parsers), naming WHERE the read went and WHAT the local vault held:
 * the fallback path, the local secret count, and the fact that hosted secrets
 * are NOT visible. A picked store (a mode variable set) is no longer possible —
 * retired storage-mode variables are a hard error, never a selector.
 */
function emitLocalFallbackNotice(store: Store, resolution: ClientTransportResolution): void {
  if (resolution.transport !== "local" || resolution.misconfigured) {
    return;
  }
  const keys = clientTransportEnvKeys("secrets");
  const localVaultPath = store.describe().location;
  const localSecretCount = store instanceof LocalStore ? store.countSecretsSync() : 0;
  const notice = {
    event: "secrets-local-fallback",
    transport: "local",
    checked: {
      retiredModeKeys: keys.modeKeys,
      apiUrlKeys: keys.apiUrlKeys,
      apiKeyKeys: keys.apiKeyKeys,
    },
    apiUrlPresent: Boolean(resolution.apiUrlSource),
    apiKeyPresent: resolution.apiKeyPresent,
    localVaultPath,
    localSecretCount,
    hostedSecretsVisible: false,
    notice:
      `No hosted API config (${keys.apiUrlKeys[0]} + ${keys.apiKeyKeys[0]}) is present; ` +
      `reading the LOCAL vault at ${localVaultPath} (${localSecretCount} secret(s)). ` +
      "Hosted secrets are NOT visible in this output.",
  };
  console.error(JSON.stringify(notice));
}

switch (command) {
  case "docs":
  case "guide": {
    docs();
    break;
  }

  case "set": {
    const [key, argvValue] = positional;
    const useStdin = flags.stdin === "true";
    if (!key || (!argvValue && !useStdin)) {
      console.error("Usage: secrets set <key> <value>  |  secrets set <key> --stdin");
      process.exit(1);
    }
    // An argv value is visible in `ps` output and shell history for as long as the
    // process runs; --stdin is the leak-free path. Refuse the ambiguous combination
    // instead of silently picking one.
    if (argvValue && useStdin) {
      console.error("Pass the value either as an argument or via --stdin, not both.");
      process.exit(1);
    }
    let value = argvValue;
    if (useStdin) {
      // Strip the trailing line-ending run (the echo/heredoc/pipe convention
      // appends one or more `\n`/`\r\n`; a file or heredoc with a trailing
      // blank line appends two). Every other byte is stored verbatim. A
      // credential that genuinely ends in a line ending is pathological — a
      // byte-exact consumer (a site gate is the measured case) 401s on it.
      value = (await Bun.stdin.text()).replace(/[\r\n]+$/, "");
      if (!value) {
        console.error("No value on stdin. Usage: secrets set <key> --stdin < value-file");
        process.exit(1);
      }
    }
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
    const rotation = flags.rotation === "true";
    if (rotation && !flags.reason) {
      console.error("Usage: secrets set <key> --stdin --rotation --reason <text>. A reason is required for a rotation.");
      process.exit(1);
    }
    try {
      const entry = await store().setSecret(key, value, type, flags.label, expiresAt, {
        ...(flags.reason ? { reason: flags.reason } : {}),
        ...(rotation ? { changeKind: "rotation" as const } : {}),
      });
      const versionNote = typeof entry.version === "number" ? ` (version ${entry.version})` : "";
      const unchangedNote = entry.unchanged ? " — unchanged, no new version" : "";
      console.log(`✓ ${entry.unchanged ? "Unchanged" : "Stored"}: ${entry.key} [${entry.type}]${versionNote}${unchangedNote}${expiresAt ? ` (expires ${new Date(expiresAt).toLocaleDateString()})` : ""}`);
    } catch (e: any) {
      console.error(e.message);
      process.exit(1);
    }
    break;
  }

  case "copy": {
    // Value-safe copy: read <old> IN-PROCESS through the Store and write <new>
    // with the same bytes in the same call. The value never renders to stdout,
    // stderr, a transcript, a log, or a child environment — the migration
    // primitive behind the taxonomy ruling (Fable, 2026-08-20). See src/copy.ts.
    // Metadata (type/label/expiry) defaults to the source entry and is
    // overridden per flag; the provenance reason auto-carries the source path.
    const [oldKey, newKey] = positional;
    if (!oldKey || !newKey || oldKey === newKey) {
      console.error("Usage: secrets copy <old> <new> [--type <t>] [--label <l>] [--ttl <ttl>] [--reason <text>] [--verify] [--json]");
      console.error("Source and destination must differ.");
      process.exit(1);
    }
    const type = flags.type ? (flags.type as SecretEntry["type"]) : undefined;
    if (type !== undefined && !SECRET_TYPES.includes(type)) {
      console.error(`Invalid type "${type}". Valid: ${SECRET_TYPES.join(", ")}`);
      process.exit(1);
    }
    const expiresAt = flags.ttl ? parseTtl(flags.ttl) : undefined;
    try {
      const result = await copySecret(store(), oldKey, newKey, {
        ...(type ? { type } : {}),
        ...(flags.label !== undefined ? { label: flags.label } : {}),
        ...(expiresAt ? { expiresAt } : {}),
        ...(flags.reason !== undefined ? { reason: flags.reason } : {}),
      });
      const wantVerify = flags.verify === "true";
      let verified:
        | { match: boolean; length: number | null }
        | undefined;
      if (wantVerify) {
        verified = await verifyCopy(store(), oldKey, newKey);
      }
      if ("json" in flags) {
        console.log(JSON.stringify({
          old_key: result.oldKey,
          new_key: result.newKey,
          type: result.type,
          reason: result.reason,
          ...(result.label ? { label: result.label } : {}),
          ...(result.expiresAt ? { expires_at: result.expiresAt } : {}),
          unchanged: result.unchanged,
          ...(verified !== undefined ? { verified: { match: verified.match, length: verified.length } } : {}),
        }, null, 2));
        if (verified !== undefined && !verified.match) process.exit(1);
        break;
      }
      const meta = [`✓ Copied: ${result.oldKey} → ${result.newKey} [${result.type}]`];
      if (result.label) meta.push(`label: ${result.label}`);
      if (result.expiresAt) meta.push(`expires: ${new Date(result.expiresAt).toLocaleDateString()}`);
      meta.push(`reason: ${result.reason}`);
      if (verified !== undefined) {
        if (verified.match) {
          console.log([...meta, `verified (length=${verified.length}, sha256 match)`].join(" · "));
        } else {
          console.log(meta.join(" · "));
          console.error(
            `✗ Copy verification FAILED: ${result.newKey} does not match ${result.oldKey} ` +
              "(length or content hash differ). The destination key was written but NOT verified. " +
              `Inspect with: secrets get ${result.newKey} --check`,
          );
          process.exit(1);
        }
        break;
      }
      console.log(meta.join(" · "));
    } catch (e: any) {
      if (e instanceof CopySourceEqualsDestinationError) {
        console.error(e.message);
      } else if (e instanceof CopySourceNotFoundError) {
        console.error(e.message);
      } else {
        // Clean one-line surface; the message is value-free (method/path/status).
        console.error(`Unable to copy "${oldKey}" → "${newKey}": ${e?.message ?? String(e)}`);
      }
      process.exit(1);
    }
    break;
  }

  case "versions": {
    const [key] = positional;
    if (!key) { console.error("Usage: secrets versions <key> [--limit <n>] | secrets versions <key> --version <N> --check [--json]"); process.exit(1); }
    if (flags.check === "true") {
      const version = flags.version ? Number(flags.version) : Number.NaN;
      if (!Number.isInteger(version) || version < 1) {
        console.error("Usage: secrets versions <key> --version <N> --check. N must be a positive integer.");
        process.exit(1);
      }
      try {
        const check = await store().checkVersion(key, version);
        if ("json" in flags) {
          console.log(JSON.stringify(check, null, 2));
          break;
        }
        console.log(`key=${key} version=${check.version} length=${check.value_length} sha256=${check.hash}${check.current ? " (current)" : ""}`);
      } catch (e: any) {
        console.error(e.message);
        process.exit(1);
      }
      break;
    }
    const limit = flags.limit ? parseInt(flags.limit, 10) : 20;
    if (!Number.isInteger(limit) || limit < 1) {
      console.error(`Invalid --limit: ${flags.limit}. Use a positive integer.`);
      process.exit(1);
    }
    try {
      const versions = await store().listVersions(key, limit);
      if ("json" in flags) {
        console.log(JSON.stringify(versions, null, 2));
        break;
      }
      if (versions.length === 0) {
        console.log(`No versions for: ${key}`);
        break;
      }
      for (const v of versions) {
        const kind = v.change_kind;
        const reason = v.reason ? ` · ${v.reason}` : "";
        const label = v.label ? ` · ${v.label}` : "";
        const source = v.source_version ? ` · from v${v.source_version}` : "";
        const marker = v.current ? "  (current)" : "";
        console.log(
          `v${v.version} [${kind}] ${v.created_at} by ${v.created_by}${reason}${label}${source} len=${v.value_length} fp=${v.fingerprint}${marker}`,
        );
      }
    } catch (e: any) {
      console.error(e.message);
      process.exit(1);
    }
    break;
  }

  case "restore": {
    const [key] = positional;
    if (!key || !flags.version || !flags.reason) {
      console.error("Usage: secrets restore <key> --version <N> --reason <text> [--expect-current <N>]");
      process.exit(1);
    }
    const version = Number(flags.version);
    if (!Number.isInteger(version) || version < 1) {
      console.error(`Invalid --version: ${flags.version}. Use a positive integer.`);
      process.exit(1);
    }
    let expectCurrent: number | undefined;
    if (flags["expect-current"] !== undefined) {
      expectCurrent = Number(flags["expect-current"]);
      if (!Number.isInteger(expectCurrent!) || expectCurrent! < 1) {
        console.error(`Invalid --expect-current: ${flags["expect-current"]}. Use a positive integer.`);
        process.exit(1);
      }
    } else if (!process.stdout.isTTY) {
      // Non-interactive restore must not blind-overwrite a newer rotation: the
      // caller has to state which current version they expect.
      console.error("Usage: secrets restore <key> --version <N> --reason <text> --expect-current <N>");
      console.error("Non-interactive restores require --expect-current to avoid overwriting a newer rotation.");
      process.exit(1);
    }
    try {
      if (expectCurrent === undefined) {
        // Interactive convenience: fetch the current version first, then CAS on it.
        const versions = await store().listVersions(key, 1);
        expectCurrent = versions[0]?.version ?? 0;
      }
      const restored = await store().restoreVersion(key, version, { reason: flags.reason, expectCurrent });
      console.log(`✓ Restored ${key} to version ${version} — created version ${restored.version}${restored.current ? " (current)" : ""}`);
      console.error(
        "Note: restoring a vault value cannot reactivate a credential that was revoked at its provider " +
          "(npm, AWS, Stripe, GitHub, etc.). Verify the consumer/provider path before relying on it.",
      );
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

    // DEFAULT-DENY (todos da0ef2ed, 2026-07-30 leak): `get` printed plaintext to
    // stdout, agent tool output is persisted verbatim to session transcripts, and
    // four credentials leaked. No code path may write a vault value to stdout
    // without an explicit --show/--plaintext.
    const showPlaintext = flags.show === "true" || flags.plaintext === "true";
    if (flags.check === "true") {
      if (showPlaintext) {
        console.error("Usage: secrets get <key> [--show|--plaintext|--check]. --check excludes plaintext flags.");
        process.exit(1);
      }
      // Existence/equality proof: length + sha256, never the value. Enough to
      // compare two secrets or verify a rotation landed, useless to an attacker.
      const digest = (await import("node:crypto")).createHash("sha256").update(entry.value).digest("hex");
      console.log(`key=${entry.key} length=${entry.value.length} sha256=${digest}`);
      break;
    }
    if (showPlaintext) {
      if (process.stdout.isTTY) {
        console.log(formatEntry(entry, true));
      } else {
        process.stdout.write(entry.value);
      }
      break;
    }
    if (process.stdout.isTTY) {
      // Interactive terminal: show metadata, keep the value redacted.
      console.log(formatEntry(entry, false));
      console.error("Value redacted. Use --show to print it, --check for length+sha256, or `secrets exec` to consume it without printing.");
      break;
    }
    // Captured (non-TTY) output is exactly the transcript-leak context. Fail LOUDLY
    // instead of substituting a redaction marker: `VAR=$(secrets get k)` must break
    // visibly here, never poison VAR with "***" and fail mysteriously downstream.
    console.error(
      `Refusing to print the value of "${key}" to captured output. ` +
        "Use `secrets exec <key> [--as VAR] -- <cmd>` to consume it via a child environment, " +
        "`secrets get <key> --check` for length+sha256, or `secrets get <key> --show` to explicitly print plaintext.",
    );
    process.exit(1);
  }

  case "exec": {
    // Consume a secret WITHOUT it ever existing on this process's stdout: the value
    // goes into the child's environment and nowhere else. This is the strong
    // primitive behind the `get` default-deny above — it removes the value from the
    // calling agent's reach entirely instead of trusting it not to print.
    //
    // Parse from the RAW arg list, not `flags`/`positional`: everything after the
    // first bare `--` belongs to the child verbatim.
    const execUsage =
      "Usage: secrets exec (<key> [--as <VAR>] | --provider <PROFILE> --account <12-DIGIT-ID> --env <VAR>) -- <cmd> [args...]";
    const sepIndex = rest.indexOf("--");
    if (sepIndex === -1) { console.error(`Missing "--" separator. ${execUsage}`); process.exit(1); }
    const childCmd = rest.slice(sepIndex + 1);
    const { flags: execFlags, positional: execPositional } = parseArgs(rest.slice(0, sepIndex));
    const [execKey] = execPositional;
    const scopedFields = [execFlags.provider, execFlags.account, execFlags.env];
    const scopedExec = scopedFields.some(Boolean);
    if (childCmd.length === 0 ||
      (scopedExec && (scopedFields.some((value) => !value) || execPositional.length > 0 || Boolean(execFlags.as))) ||
      (!scopedExec && !execKey)) {
      console.error(execUsage);
      process.exit(1);
    }

    // Default env var name mirrors the vault path per the secrets naming standard:
    // example/anthropic/test/api_key → EXAMPLE_ANTHROPIC_TEST_API_KEY.
    const envName = scopedExec
      ? execFlags.env
      : execFlags.as ?? execKey.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(envName)) {
      console.error(`Invalid env var name "${envName}". Use --as/--env with letters, digits, and underscores.`);
      process.exit(1);
    }

    let execValue: string;
    if (scopedExec) {
      try {
        const { getAwsSecretValueForEnv, loadAwsProfiles, resolveAwsAccountProfile } = await import("./aws.js");
        const target = resolveAwsAccountProfile(
          execFlags.provider,
          execFlags.account,
          await loadAwsProfiles(),
        );
        execValue = await getAwsSecretValueForEnv(execFlags.provider, execFlags.env, {
          credentialMode: "profile",
          profile: target.profile,
          ...(target.region ? { region: target.region } : {}),
        });
      } catch (e: any) {
        console.error(`Unable to read account-scoped secret "${execFlags.env}": ${e?.message ?? String(e)}`);
        process.exit(1);
      }
    } else {
      let execEntry;
      try {
        execEntry = await store().getSecret(execKey);
      } catch (e: any) {
        // Same clean one-line surface as `get`; the message is value-free.
        console.error(`Unable to read secret "${execKey}": ${e?.message ?? String(e)}`);
        process.exit(1);
      }
      if (!execEntry) { console.error(`Not found: ${execKey}`); process.exit(1); }
      execValue = execEntry.value;
    }

    const child = Bun.spawn({
      cmd: childCmd,
      env: { ...process.env, [envName]: execValue },
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    process.exit(await child.exited);
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
    const [rawTarget = "workspace", ...paths] = positional;
    // `stdin` and `text` are the two names an agent reaches for when it wants
    // to scan a stream. Both previously exited 1 on a usage error while the
    // capability was simply absent, so they resolve to the input mode rather
    // than teaching a second name for it.
    const target = rawTarget === "stdin" || rawTarget === "text" ? "input" : rawTarget;
    // The first path locates the repo or tree for workspace/history/staged;
    // input mode scans EVERY named path (see the `input` case below).
    const root = paths[0];
    const scanUsage =
      "Usage: secrets scan workspace|history|staged|input [path ...] [--limit <n>] [--cursor <cursor>] [--max-bytes <n>] [--max-files <n>] [--max-scan-bytes <n>] [--max-commits <n>] [--timeout-ms <n>] [--subtree] [--pretty] [--json]";
    const allowedFlags = {
      workspace: new Set(["cursor", "limit", "max-bytes", "max-files", "max-scan-bytes", "timeout-ms", "pretty", "json"]),
      history: new Set(["cursor", "limit", "max-commits", "timeout-ms", "pretty", "json"]),
      staged: new Set(["limit", "max-bytes", "max-files", "max-scan-bytes", "timeout-ms", "subtree", "pretty", "json"]),
      input: new Set(["limit", "max-bytes", "timeout-ms", "pretty", "json"]),
    }[target];
    if (allowedFlags) {
      const unsupportedFlags = Object.keys(flags).filter((flag) => !allowedFlags.has(flag));
      if (unsupportedFlags.length > 0) {
        console.error(`Unsupported option for secrets scan: ${unsupportedFlags.map((flag) => `--${flag}`).join(", ")}`);
        console.error(scanUsage);
        process.exit(1);
      }
    }
    const {
      scanWorkspaceExposures,
      scanHistoryExposures,
      scanStagedExposures,
      scanInputExposures,
      stagedScanExitCode,
    } = await import("./scanner.js");
    const common = {
      root,
      cursor: flags.cursor,
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
        if (result.stats.errors.length > 0) process.exitCode = 2;
        break;
      }
      case "history": {
        const result = scanHistoryExposures({
          ...common,
          maxCommits: positiveIntegerFlag(flags, "max-commits"),
          timeoutMs: positiveIntegerFlag(flags, "timeout-ms"),
        });
        console.log(formatJson(result, flags.pretty === "true"));
        if (result.stats.errors.length > 0) process.exitCode = 2;
        break;
      }
      case "staged": {
        // Commit-gate mode: the exit code is the answer, the JSON is the
        // evidence. No --cursor — a gate returns a verdict on the whole staged
        // set, and a paginated verdict is not one. [path] LOCATES the repo and
        // does not narrow it, so running from a subdirectory still covers every
        // staged blob that `git commit` would write; --subtree opts out.
        const result = scanStagedExposures({
          root,
          subtree: flags.subtree === "true",
          limit: common.limit,
          maxFileBytes: positiveIntegerFlag(flags, "max-bytes"),
          maxFiles: positiveIntegerFlag(flags, "max-files"),
          maxBytesScanned: positiveIntegerFlag(flags, "max-scan-bytes"),
          timeoutMs: positiveIntegerFlag(flags, "timeout-ms"),
        });
        console.log(formatJson(result, flags.pretty === "true" || flags.json === "true"));
        process.exitCode = stagedScanExitCode(result);
        break;
      }
      case "input": {
        // Output-gate mode: scan text before it is persisted. Same three-way
        // verdict as the staged gate — the exit code is the answer and 2 means
        // "could not look", never "looked and it was clean".
        //
        // With no path and a terminal on stdin there is nothing to read, and a
        // blocking read would hang. That is the refusal code rather than the
        // usage code on purpose: a caller keying on 2 to mean "unverified" is
        // then correct without having to parse the message.
        //
        // This check is a courtesy for an interactive human — it swaps a hang
        // for a usage message — and it is NOT the guard against an unscanned
        // pass. isTTY discriminates human from non-human; the question that
        // matters is connected from empty, and isTTY is false in agent
        // sessions, hooks, CI and cron, i.e. every context this mode targets.
        // The real guard is in scanInputExposures: zero bytes off stdin raises
        // an error and so exits 2.
        const readsStdin = paths.length === 0 || paths.includes("-");
        if (readsStdin && process.stdin.isTTY) {
          console.error("secrets scan input reads stdin: pipe the text in, or name a file.");
          console.error(scanUsage);
          process.exit(2);
        }
        const result = scanInputExposures({
          paths,
          limit: common.limit,
          maxBytes: positiveIntegerFlag(flags, "max-bytes"),
          timeoutMs: positiveIntegerFlag(flags, "timeout-ms"),
        });
        console.log(formatJson(result, flags.pretty === "true" || flags.json === "true"));
        process.exitCode = stagedScanExitCode(result);
        break;
      }
      default:
        console.error(scanUsage);
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
    const [sub, idOrKind] = positional;
    switch (sub) {
      case "list": {
        const kind = idOrKind as VaultItemKind | undefined;
        if (kind && !VAULT_ITEM_KINDS.includes(kind)) {
          console.error(`Invalid kind "${kind}". Valid: ${VAULT_ITEM_KINDS.join(", ")}`);
          process.exit(1);
        }
        const items = await store().listVaultItemMetadata(kind);
        if ("json" in flags) {
          console.log(JSON.stringify(items, null, 2));
          break;
        }
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
        if ("json" in flags) {
          console.log(JSON.stringify(items, null, 2));
          break;
        }
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
        const prefix = await ask("Key prefix (optional, e.g. secrets/prod): ");
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
