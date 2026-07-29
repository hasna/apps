import type { SecretEntry } from "../types.js";

export const SECRET_TYPES: SecretEntry["type"][] = [
  "api_key",
  "password",
  "token",
  "credential",
  "other",
];

export function usage(): void {
  console.log(`
secrets — local secrets vault for AI agents

Commands:
  docs                        show a practical usage guide
  set <key> <value> [--type <type>] [--label <label>] [--ttl <ttl>]
  get <key>
  delete <key>               (aliases: remove, rm, uninstall)
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
  scan workspace [path] [--limit <n>] [--max-bytes <n>] [--max-files <n>] [--max-scan-bytes <n>] [--timeout-ms <n>] [--pretty]
  scan history [path] [--limit <n>] [--max-commits <n>] [--timeout-ms <n>] [--pretty]
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

export function docs(): void {
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
