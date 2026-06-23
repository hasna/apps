#!/usr/bin/env bun
/**
 * @hasna/knowledge
 * Copyright 2026 Hasna Inc.
 * Licensed under the Apache License, Version 2.0
 */
import { defaultStorePath, loadStore, saveStore, withLock, makeId, makeShortId, ensureStore, type KnowledgeItem } from './store';
import { openKnowledgeDb } from './knowledge-db';
import { createKnowledgeService } from './service';
import {
  getStorageStatus as getDatabaseStorageStatus,
  parseStorageTables,
  storagePull as databaseStoragePull,
  storagePush as databaseStoragePush,
  storageSync as databaseStorageSync,
  type SyncResult,
} from './storage';
import { assertProviderCredentials, parseModelRef, resolveModelRef, type AiProviderId } from './providers';
import { approvalStatus, assertS3ReadAllowed, assertWebSearchAllowed, createApprovalGate, recordAuditEvent, recordRedactionFindings, redactSecrets } from './safety';
import { basename } from 'node:path';
import pkg from '../package.json' with { type: 'json' };

type LogLevel = 'debug' | 'info' | 'warn' | 'error';
const LOG_LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const currentLevel = (): LogLevel => {
  if (process.env.DEBUG) return 'debug';
  if (process.env.LOG_LEVEL === 'debug') return 'debug';
  if (process.env.LOG_LEVEL === 'warn') return 'warn';
  if (process.env.LOG_LEVEL === 'error') return 'error';
  return 'info';
};
function log(level: LogLevel, msg: string, data?: Record<string, unknown>): void {
  if (LOG_LEVELS[level] < LOG_LEVELS[currentLevel()]) return;
  const prefix = { debug: '[DEBUG]', info: '[INFO]', warn: '[WARN]', error: '[ERROR]' }[level];
  const entry = data ? `${prefix} ${msg} ${JSON.stringify(data)}` : `${prefix} ${msg}`;
  if (level === 'error') console.error(entry);
  else console.error(entry);
}

interface Flags {
  json?: boolean;
  yes?: boolean;
  help?: boolean;
  version?: boolean;
  desc?: boolean;
  page?: number;
  limit?: number;
  search?: string;
  sort?: string;
  id?: string;
  store?: string;
  title?: string;
  content?: string;
  url?: string;
  tag?: string;
  format?: string;
  completions?: string;
  purpose?: string;
  model?: string;
  strategy?: string;
  dimensions?: number;
  semantic?: boolean;
  context?: boolean;
  generate?: boolean;
  approveWrite?: boolean;
  provider?: string;
  mode?: string;
  machine?: string;
  workspace?: string;
  apiUrl?: string;
  canonicalHasnaXyz?: boolean;
  apiKey?: string;
  email?: string;
  org?: string;
  orgId?: string;
  userId?: string;
  approvedBy?: string;
  patchUri?: string;
  domain?: string[];
  fileResults?: boolean;
  full?: boolean;
  dryRun?: boolean;
  noColor?: boolean;
  scope?: string;
  tables?: string;
  peerWorkspace?: string;
  olderThan?: number;
  empty?: boolean;
  fake?: boolean;
  tailscale?: boolean;
  artifactContent?: boolean;
  archived?: boolean;
  includeArchived?: boolean;
}

interface ParseResult {
  positional: string[];
  flags: Flags;
}

const COMMANDS = ['add', 'list', 'get', 'delete', 'update', 'archive', 'restore', 'upsert', 'untag', 'export', 'prune', 'dedupe', 'stats', 'inventory', 'paths', 'setup', 'auth', 'remote', 'storage', 'machines', 'sync', 'db', 'wiki', 'source', 'ingest', 'reindex', 'search', 'web', 'ask', 'build', 'embeddings', 'providers', 'safety', 'help'];
const COMMAND_ALIASES: Record<string, string> = {
  ls: 'list',
  rm: 'delete',
  edit: 'update',
  unarchive: 'restore',
};

function parseArgs(argv: string[]): ParseResult {
  const positional: string[] = [];
  const flags: Flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('-')) {
      positional.push(token);
      continue;
    }
    switch (token) {
      case '--json': flags.json = true; break;
      case '--yes': case '-y': flags.yes = true; break;
      case '--help': case '-h': flags.help = true; break;
      case '--version': case '-v': flags.version = true; break;
      case '--desc': flags.desc = true; break;
      case '--page': case '-p': flags.page = Number(argv[i + 1]); i += 1; break;
      case '--limit': case '-l': flags.limit = Number(argv[i + 1]); i += 1; break;
      case '--search': case '-s': flags.search = argv[i + 1]; i += 1; break;
      case '--sort': flags.sort = argv[i + 1]; i += 1; break;
      case '--id': flags.id = argv[i + 1]; i += 1; break;
      case '--store': flags.store = argv[i + 1]; i += 1; break;
      case '--title': flags.title = argv[i + 1]; i += 1; break;
      case '--content': flags.content = argv[i + 1]; i += 1; break;
      case '--url': flags.url = argv[i + 1]; i += 1; break;
      case '--tag': case '-t': flags.tag = argv[i + 1]; i += 1; break;
      case '--format': flags.format = argv[i + 1]; i += 1; break;
      case '--completions': flags.completions = argv[i + 1]; i += 1; break;
      case '--purpose': flags.purpose = argv[i + 1]; i += 1; break;
      case '--model': flags.model = argv[i + 1]; i += 1; break;
      case '--strategy': flags.strategy = argv[i + 1]; i += 1; break;
      case '--dimensions': flags.dimensions = Number(argv[i + 1]); i += 1; break;
      case '--semantic': flags.semantic = true; break;
      case '--context': flags.context = true; break;
      case '--generate': flags.generate = true; break;
      case '--approve-write': flags.approveWrite = true; break;
      case '--provider': flags.provider = argv[i + 1]; i += 1; break;
      case '--mode': flags.mode = argv[i + 1]; i += 1; break;
      case '--machine': flags.machine = argv[i + 1]; i += 1; break;
      case '--workspace': flags.workspace = argv[i + 1]; i += 1; break;
      case '--api-url': flags.apiUrl = argv[i + 1]; i += 1; break;
      case '--canonical-hasna-xyz': flags.canonicalHasnaXyz = true; break;
      case '--api-key': flags.apiKey = argv[i + 1]; i += 1; break;
      case '--email': flags.email = argv[i + 1]; i += 1; break;
      case '--org': flags.org = argv[i + 1]; i += 1; break;
      case '--org-id': flags.orgId = argv[i + 1]; i += 1; break;
      case '--user-id': flags.userId = argv[i + 1]; i += 1; break;
      case '--approved-by': flags.approvedBy = argv[i + 1]; i += 1; break;
      case '--patch-uri': flags.patchUri = argv[i + 1]; i += 1; break;
      case '--domain': flags.domain = [...(flags.domain ?? []), argv[i + 1]]; i += 1; break;
      case '--file-results': flags.fileResults = true; break;
      case '--full': flags.full = true; break;
      case '--dry-run': flags.dryRun = true; break;
      case '--fake': flags.fake = true; break;
      case '--no-tailscale': flags.tailscale = false; break;
      case '--no-artifact-content': flags.artifactContent = false; break;
      case '--no-color': flags.noColor = true; break;
      case '--scope': flags.scope = argv[i + 1]; i += 1; break;
      case '--tables': flags.tables = argv[i + 1]; i += 1; break;
      case '--peer-workspace': flags.peerWorkspace = argv[i + 1]; i += 1; break;
      case '--older-than': flags.olderThan = Number(argv[i + 1]); i += 1; break;
      case '--empty': flags.empty = true; break;
      case '--archived': flags.archived = true; break;
      case '--include-archived': flags.includeArchived = true; break;
      default: throw new Error(`Unknown flag: ${token}. Run 'knowledge --help' for valid options.`);
    }
  }
  return { positional, flags };
}

function resolveCommand(raw: string): string {
  if (!raw) return '';
  return COMMAND_ALIASES[raw] ?? raw;
}

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i += 1) dp[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) dp[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[a.length][b.length];
}

function suggestCommand(input: string): string {
  if (!input) return '';
  const all = [...COMMANDS, ...Object.keys(COMMAND_ALIASES)];
  let best = '';
  let bestScore = Number.POSITIVE_INFINITY;
  for (const candidate of all) {
    const score = levenshtein(input, candidate);
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return bestScore <= 3 ? best : '';
}

function invokedAsKnowledge(): boolean {
  return basename(process.argv[1] ?? '').replace(/\.(?:js|ts|mjs|cjs)$/, '') === 'knowledge';
}

function printGlobalHelp(): void {
  console.log(`knowledge - local agent knowledge store

Usage:
  knowledge <command> [options]

Commands:
  add <title> <content>       Add an item
  list (alias: ls)             List items (supports pagination/search/sort/tag)
  get --id <id>               Get one item
  update --id <id>            Update an item (--title, --content, --url, --tag)
  archive --id <id>           Archive an item
  restore --id <id>           Restore an archived item
  upsert [title] [content]    Create or update an item by --id
  untag --id <id> -t <tag>    Remove a tag from an item
  delete (alias: rm) --id <id> Delete item (requires --yes)
  export                       Export all items (--format jsonl)
  prune                        Remove old/empty items (requires --yes)
  dedupe                       Remove duplicate items by title+content (requires --yes)
  stats                        Show knowledge base statistics
  inventory                    Show all local knowledge layers and previews
  paths                        Show resolved workspace/store paths
  setup                        Configure local, hosted, or canonical Hasna XYZ S3 mode
  auth login|whoami|logout     Manage hosted API credentials
  remote contracts|status      Inspect hosted client contracts/readiness
  storage status|validate|repair-artifact-keys
                               Inspect or repair local/S3 artifact storage metadata
  machines topology|preflight  Inspect optional machine topology/sync readiness
  sync status|doctor|snapshot|conflicts
                               Inspect machine sync readiness, snapshots, conflicts
  db init|stats|storage        Initialize, inspect, or sync local knowledge.db
  wiki init|compile|file-answer|lint
                               Initialize, compile, file, or lint wiki artifacts
  source resolve <source-ref>  Resolve read-only source content and citation evidence
  ingest manifest <file|s3://> Ingest an open-files manifest into knowledge.db
  ingest source <source-ref>   Ingest a read-only source ref into knowledge.db
  reindex status|enqueue|embeddings|outbox Inspect/refresh search indexes
  search <query>               Hybrid search sources, wiki pages, indexes, or context
  web search <query>           Provider-native web search with citations
  ask|build <prompt>           Build a read-only citation answer/context pack
  embeddings status|index|search Build/query local vector embeddings
  providers status|models|check Inspect AI SDK provider config and credentials
  safety status|check|approve|audit|redact
  help [command]               Show help

Global Options:
  --json                      Output JSON
  --store <path>              Override store path
  --purpose <name>            Read-only source purpose (default: knowledge_answer)
  --model <provider:model>     AI/embedding model ref
  --dimensions <n>             Embedding dimensions for local/fake providers
  --semantic                   Include vector semantic results in search
  --context                    Return a reranked citation context pack for search
  --generate                   Call AI SDK text generation for ask/build
  --approve-write              Approve durable generated writes or sync conflict resolution
  --approved-by <name>         Approver label for approval-gated sync conflict resolution
  --strategy <name>            Resolution strategy for sync conflicts
  --patch-uri <uri>            Proposed patch artifact URI for sync conflicts
  --provider <name>            Provider override for web search
  --mode local|hosted          Configure OSS local or hosted-aware mode
  --machine <id>               Machine id/SSH alias for preflight or peer sync
  --workspace <path>           Repo workspace path for machine preflight
  --api-url <url>              Hosted API origin (or KNOWLEDGE_API_URL)
  --api-key <key>              Hosted API key for auth login
  --email <email>              Hosted account email metadata
  --org <slug>                 Hosted organization slug metadata
  --org-id <id>                Hosted organization id metadata
  --user-id <id>               Hosted user id metadata
  --domain <domain>            Restrict provider web search to a domain
  --file-results               File web snippets as web source refs
  --full                       Force full embedding index rebuild
  --dry-run                   Preview sync writes without changing target state
  --fake                       Use deterministic fake embeddings for local tests
  --no-tailscale               Skip local Tailscale topology probing
  --no-artifact-content        Export sync bundles without embedded artifact bodies
  --scope local|global|project  Store scope (default: global ~/.hasna/apps/knowledge/)
  --tables <names>             Comma-separated knowledge.db sync tables
  --peer-workspace <path>      Peer repo root or .hasna/apps/knowledge path for local sync or remote override
  --no-color                  Disable color output
  --completions <shell>       Output completions for bash|zsh|fish
  -v, --version               Show version
  -h, --help                  Show help

List Options:
  --format table|json         Output format (default: table if TTY, json otherwise)
  -p, --page <n>              Page number (default: 1)
  -l, --limit <n>             Items per page (default: 20)
  -s, --search <text>         Filter by title/content
  -t, --tag <tag>             Filter by tag
  --sort <created|title>       Sort field (default: created)
  --desc                       Sort descending
  --archived                  Show only archived items
  --include-archived          Include archived items

Add/Update Options:
  --url <url>                 Attach source URL

Update Options:
  --id <id>                   Item id
  --title <title>             New title
  --content <content>         New content
  --url <url>                 New source URL
  -t, --tag <tag>             Add a tag

Delete Options:
  --id <id>                   Item id
  -y, --yes                   Confirm destructive action

Export Options:
  --format jsonl              Export as newline-delimited JSON (default: JSON array)

Prune Options:
  --older-than <days>          Remove items older than N days
  --empty                     Remove items with empty content`);
}

function printCommandHelp(command: string): void {
  if (command === 'add') { console.log('Usage: knowledge add <title> <content> [--url <url>] [-t <tag>] [--json]'); return; }
  if (command === 'list' || command === 'ls') { console.log('Usage: knowledge list|ls [--format table|json] [-p <page>] [-l <limit>] [-s <search>] [-t <tag>] [--sort created|title] [--desc] [--json]'); return; }
  if (command === 'get') { console.log('Usage: knowledge get --id <id> [--json]'); return; }
  if (command === 'update' || command === 'edit') { console.log('Usage: knowledge update|edit --id <id> [--title <title>] [--content <content>] [--url <url>] [-t <tag>] [--json]'); return; }
  if (command === 'archive') { console.log('Usage: knowledge archive --id <id> [--json]'); return; }
  if (command === 'restore' || command === 'unarchive') { console.log('Usage: knowledge restore|unarchive --id <id> [--json]'); return; }
  if (command === 'upsert') { console.log('Usage: knowledge upsert [title] [content] [--id <id>] [--title <title>] [--content <content>] [--url <url>] [-t <tag>] [--json]'); return; }
  if (command === 'untag') { console.log('Usage: knowledge untag --id <id> -t <tag> [--json]'); return; }
  if (command === 'delete' || command === 'rm') { console.log('Usage: knowledge delete|rm --id <id> -y [--json]'); return; }
  if (command === 'export') { console.log('Usage: knowledge export [--format jsonl] [--json]'); return; }
  if (command === 'prune') { console.log('Usage: knowledge prune --yes [--older-than <days>] [--empty] [--json]'); return; }
  if (command === 'dedupe') { console.log('Usage: knowledge dedupe --yes [--json]'); return; }
  if (command === 'stats') { console.log('Usage: knowledge stats [--json]'); return; }
  if (command === 'inventory') { console.log('Usage: knowledge inventory [--scope local|global|project] [--limit <n>] [--include-archived] [--json]'); return; }
  if (command === 'paths') { console.log('Usage: knowledge paths [--scope local|global|project] [--json]'); return; }
  if (command === 'setup') { console.log('Usage: knowledge setup --mode local|hosted [--api-url https://...] [--canonical-hasna-xyz] [--scope local|global|project] [--json]'); return; }
  if (command === 'auth') { console.log('Usage: knowledge auth login|whoami|logout [--api-key <key>] [--email <email>] [--org <slug>] [--api-url https://...] [--scope local|global|project] [--json]'); return; }
  if (command === 'remote') { console.log('Usage: knowledge remote contracts|status [--scope local|global|project] [--json]'); return; }
  if (command === 'storage') { console.log('Usage: knowledge storage status|validate|repair-artifact-keys [--approve-write --approved-by <name>] [--scope local|global|project] [--json]'); return; }
  if (command === 'machines') { console.log('Usage: knowledge machines topology [--no-tailscale] | preflight [machine] [--workspace <repo>] [--scope local|global|project] [--json]'); return; }
  if (command === 'sync') { console.log('Usage: knowledge sync status|doctor|readiness|snapshot|machines|conflicts [show|propose|resolve] [id] | dry-run|pull|push|sync|export|import [--peer-workspace <path>] [--machine <ssh-alias>] [--tables <names>] [--dry-run] [--limit <n>] [--approve-write] [--approved-by <name>] [--strategy <name>] [--mode deterministic|ai] [--model <alias|provider:model>] [--fake] [--no-tailscale] [--scope local|global|project] [--json]\n\nRemote machine sync resolves peer paths through @hasna/machines when --peer-workspace is omitted.'); return; }
  if (command === 'db') { console.log('Usage: knowledge db init|stats|storage status|push|pull|sync [--tables sources,chunks] [--scope local|global|project] [--json]'); return; }
  if (command === 'wiki') { console.log('Usage: knowledge wiki init|compile|file-answer|lint [query|prompt] [--title <title>] [--content <answer>] [--approve-write] [--limit <n>] [--scope local|global|project] [--json]'); return; }
  if (command === 'source') { console.log('Usage: knowledge source resolve <source-ref> [--purpose knowledge_answer|knowledge_index] [--limit <n>] [--scope local|global|project] [--json]'); return; }
  if (command === 'ingest') { console.log('Usage: knowledge ingest manifest <file|s3://bucket/key> | source <source-ref> [--purpose knowledge_index] [--scope local|global|project] [--json]'); return; }
  if (command === 'reindex') { console.log('Usage: knowledge reindex status|enqueue|embeddings|outbox [file|s3://bucket/key] [--full] [--fake] [--scope local|global|project] [--json]'); return; }
  if (command === 'search') { console.log('Usage: knowledge search <query> [--context] [--semantic] [--model openai:text-embedding-3-small] [--limit <n>] [--dimensions <n>] [--fake] [--scope local|global|project] [--json]'); return; }
  if (command === 'web') { console.log('Usage: knowledge web search <query> [--provider openai|anthropic] [--model provider:model] [--domain <domain>] [--file-results] [--fake] [--scope local|global|project] [--json]'); return; }
  if (command === 'ask' || command === 'build') { console.log('Usage: knowledge ask|build <prompt> [--generate] [--semantic] [--model default|provider:model] [--approve-write] [--scope local|global|project] [--json]'); return; }
  if (command === 'embeddings') { console.log('Usage: knowledge embeddings status|index|search [query] [--model openai:text-embedding-3-small] [--limit <n>] [--dimensions <n>] [--fake] [--scope local|global|project] [--json]'); return; }
  if (command === 'providers') { console.log('Usage: knowledge providers status|models|check [provider|model-alias] [--scope local|global|project] [--json]'); return; }
  if (command === 'safety') { console.log('Usage: knowledge safety status|check|approve|audit|redact [args] [--scope local|global|project] [--json]'); return; }
  printGlobalHelp();
}

function useColor(flags: Flags): boolean {
  if (flags.noColor || process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR) return true;
  return process.stdout.isTTY === true;
}

function output(data: unknown, asJson?: boolean, _flags?: Flags): void {
  if (asJson) { console.log(JSON.stringify(data, null, 2)); return; }
  if (typeof data === 'string') { console.log(data); return; }
  console.log((data as { message?: string }).message ?? JSON.stringify(data, null, 2));
}

function formatInventory(inventory: ReturnType<ReturnType<typeof createKnowledgeService>['inventory']>): string {
  const summary = inventory.summary;
  const lines = [
    `Knowledge inventory (${inventory.scope})`,
    `Home: ${inventory.home}`,
    `JSON store: ${inventory.paths.json_store_path}${inventory.paths.json_store_exists ? '' : ' (missing)'}`,
    `SQLite catalog: ${inventory.paths.knowledge_db_path}`,
    `Summary: ${summary.legacy_items} item(s), ${summary.sources} source(s), ${summary.chunks} chunk(s), ${summary.wiki_pages} wiki page(s), ${summary.indexes} index(es), ${summary.storage_objects} artifact(s), ${summary.runs} run(s)`,
  ];

  const pushRows = (
    title: string,
    rows: Array<any>,
    render: (row: any) => string,
  ) => {
    if (rows.length === 0) return;
    lines.push('', `${title}:`);
    for (const row of rows.slice(0, inventory.limit)) {
      lines.push(`- ${render(row)}`);
    }
  };

  pushRows('Items', inventory.items, (row) => `${row.id}: ${row.title}`);
  pushRows('Sources', inventory.sources, (row) => `${row.kind ?? 'source'} ${row.uri} (${row.chunks ?? 0} chunk(s))`);
  pushRows('Chunks', inventory.chunks, (row) => `${row.kind ?? 'chunk'} ${row.id}: ${row.text_preview ?? ''}`);
  pushRows('Wiki pages', inventory.wiki_pages, (row) => `${row.path}: ${row.title}`);
  pushRows('Indexes', inventory.indexes, (row) => `${row.kind ?? 'index'} ${row.name}${row.shard_key ? ` (${row.shard_key})` : ''}`);
  pushRows('Artifacts', inventory.storage_objects, (row) => `${row.kind ?? 'artifact'} ${row.artifact_uri}`);
  pushRows('Runs', inventory.runs, (row) => `${row.type ?? 'run'} ${row.id}: ${row.status ?? 'unknown'}`);
  pushRows('Machines', inventory.machines, (row) => `${row.machine_id}${row.workspace_home ? ` ${row.workspace_home}` : ''}`);
  pushRows('Sync conflicts', inventory.sync_conflicts, (row) => `${row.id}: ${row.entity_kind}/${row.entity_id} ${row.status}`);

  return lines.join('\n');
}

function machineIsLocal(machine: string | undefined): boolean {
  return !machine || machine === 'local' || machine === 'localhost';
}

function syncOk(results: SyncResult[]): boolean {
  return results.every((result) => result.errors.length === 0);
}

function syncMessage(results: SyncResult[], label: string): string {
  const written = results.reduce((sum, result) => sum + result.rowsWritten, 0);
  const errors = results.flatMap((result) => result.errors.map((error) => `${result.table}: ${error}`));
  if (errors.length > 0) return `Storage ${label} completed with errors: ${errors.join('; ')}`;
  return `Storage ${label} completed: ${written} rows across ${results.length} tables`;
}

function requireId(flags: Flags): asserts flags is Flags & { id: string } {
  if (!flags.id) throw new Error('Missing required --id. Example: knowledge get --id <id>');
}

function sortItems(items: KnowledgeItem[], flags: Flags): { sorted: KnowledgeItem[]; sort: string; direction: string } {
  const sort = flags.sort ?? 'created';
  if (sort !== 'created' && sort !== 'title') {
    throw new Error("Invalid --sort value. Use 'created' or 'title'.");
  }
  const sorted = [...items].sort((a, b) => {
    if (sort === 'title') return a.title.localeCompare(b.title);
    return a.created_at.localeCompare(b.created_at);
  });
  if (flags.desc) sorted.reverse();
  return { sorted, sort, direction: flags.desc ? 'desc' : 'asc' };
}

async function run(argv: string[]): Promise<void> {
  const { positional, flags } = parseArgs(argv);
  log('debug', 'CLI invoked', { command: positional[0], flags: { json: flags.json, store: flags.store } });

  if (flags.version) {
    console.log(flags.json ? JSON.stringify({ name: pkg.name, version: pkg.version }, null, 2) : `${pkg.name} ${pkg.version}`);
    return;
  }

  if (flags.completions) {
    const shell = flags.completions;
    if (shell === 'bash') {
      console.log(`_knowledge() { local cur; cur="${"$"}{COMP_WORDS[COMP_CWORD]}"; COMPREPLY=($(compgen -W "add list get update archive restore upsert untag delete export prune dedupe stats inventory paths setup auth remote storage machines sync db wiki source ingest reindex search web ask build embeddings providers safety help ls rm edit unarchive --json --yes --help --version --desc --page --limit --search --sort --id --store --title --content --url --tag --format --completions --purpose --model --dimensions --semantic --context --generate --approve-write --provider --mode --machine --workspace --peer-workspace --api-url --canonical-hasna-xyz --api-key --email --org --org-id --user-id --domain --file-results --full --dry-run --fake --no-tailscale --no-artifact-content --no-color --scope --tables --archived --include-archived" -- "$cur")); }; complete -F _knowledge knowledge`);
    } else if (shell === 'zsh') {
      console.log(`#compdef knowledge\n_knowledge() { _arguments -C "1: :(add list get update archive restore upsert untag delete export prune dedupe stats inventory paths setup auth remote storage machines sync db wiki source ingest reindex search web ask build embeddings providers safety help ls rm edit unarchive)" "(--json)--json" "(--yes)-y" "(--help)--help" "(--version)--version" "(--desc)--desc" "(--archived)--archived" "(--include-archived)--include-archived" "(--semantic)--semantic" "(--context)--context" "(--generate)--generate" "(--approve-write)--approve-write" "(--canonical-hasna-xyz)--canonical-hasna-xyz" "(--file-results)--file-results" "(--full)--full" "(--dry-run)--dry-run" "(--fake)--fake" "(--no-tailscale)--no-tailscale" "(--no-artifact-content)--no-artifact-content" "(-p --page)"{-p,--page}"[page number]:number:" "(-l --limit)"{-l,--limit}"[items per page]:number:" "(-s --search)"{-s,--search}"[search text]:text:" "(--sort)--sort"\{created,title\}:" "(--id)--id[item id]:id:" "(--store)--store[store path]:path:" "(--title)--title[new title]:" "(--content)--content[new content]:" "(--url)--url[source url]:" "(-t --tag)"{-t,--tag}"[tag]:tag:" "(--format)--format[json|jsonl]:" "(--completions)--completions[output completions]:shell:(bash zsh fish):" "(--purpose)--purpose[purpose]:" "(--model)--model[model ref]:" "(--dimensions)--dimensions[embedding dimensions]:number:" "(--provider)--provider[provider]:" "(--mode)--mode"\{local,hosted\}:" "(--machine)--machine[machine id or SSH alias]:" "(--workspace)--workspace[repo workspace path]:path:" "(--peer-workspace)--peer-workspace[peer repo or knowledge home path]:path:" "(--api-url)--api-url[hosted API URL]:" "(--api-key)--api-key[hosted API key]:" "(--email)--email[email]:" "(--org)--org[org slug]:" "(--org-id)--org-id[org id]:" "(--user-id)--user-id[user id]:" "(--domain)--domain[domain]:" "(--no-color)--no-color[disable color]" "(--scope)--scope"\{local,global,project\}:" "(--tables)--tables[comma-separated DB sync tables]:" }; _knowledge`);
    } else if (shell === 'fish') {
      console.log(`complete -c knowledge -f; complete -c knowledge -a "add list get update archive restore upsert untag delete export prune dedupe stats inventory paths setup auth remote storage machines sync db wiki source ingest reindex search web ask build embeddings providers safety help ls rm edit unarchive"; complete -c knowledge -l json; complete -c knowledge -l yes -s y; complete -c knowledge -l help -s h; complete -c knowledge -l version -s v; complete -c knowledge -l desc; complete -c knowledge -l archived; complete -c knowledge -l include-archived; complete -c knowledge -l semantic; complete -c knowledge -l context; complete -c knowledge -l generate; complete -c knowledge -l approve-write; complete -c knowledge -l canonical-hasna-xyz; complete -c knowledge -l provider; complete -c knowledge -l mode; complete -c knowledge -l machine; complete -c knowledge -l workspace; complete -c knowledge -l peer-workspace; complete -c knowledge -l api-url; complete -c knowledge -l api-key; complete -c knowledge -l email; complete -c knowledge -l org; complete -c knowledge -l org-id; complete -c knowledge -l user-id; complete -c knowledge -l domain; complete -c knowledge -l file-results; complete -c knowledge -l full; complete -c knowledge -l dry-run; complete -c knowledge -l fake; complete -c knowledge -l no-tailscale; complete -c knowledge -l no-artifact-content; complete -c knowledge -s p -l page; complete -c knowledge -s l -l limit; complete -c knowledge -s s -l search; complete -c knowledge -l sort; complete -c knowledge -l id; complete -c knowledge -l store; complete -c knowledge -l title; complete -c knowledge -l content; complete -c knowledge -l url; complete -c knowledge -s t -l tag; complete -c knowledge -l format; complete -c knowledge -l completions; complete -c knowledge -l purpose; complete -c knowledge -l model; complete -c knowledge -l dimensions; complete -c knowledge -l no-color; complete -c knowledge -l scope -a "local global project"; complete -c knowledge -l tables`);
    } else {
      throw new Error("Invalid --completions value. Use 'bash', 'zsh', or 'fish'.");
    }
    return;
  }

  let command = resolveCommand(positional[0]);
  let commandArgOffset = 1;
  if (invokedAsKnowledge() && command && !COMMANDS.includes(command)) {
    command = 'ask';
    commandArgOffset = 0;
  }

  if (!command || flags.help || command === 'help') { printCommandHelp(positional[1]); return; }

  const service = createKnowledgeService({ scope: flags.scope });
  const storePathOverridden = Boolean(flags.store);
  let storePath = flags.store;
  if (!storePath) {
    if (flags.scope === 'project' || flags.scope === 'local') {
      storePath = service.jsonStorePath();
    } else {
      storePath = defaultStorePath();
    }
  }
  if (!storePathOverridden && (command === 'search' || command === 'ask' || command === 'build')) {
    ensureStore(storePath);
  }

  if (command === 'inventory') {
    const inventory = service.inventory({
      limit: flags.limit,
      includeArchived: flags.includeArchived || flags.archived,
      storePath,
    });
    output(flags.json ? inventory : formatInventory(inventory), flags.json);
    return;
  }

  if (command === 'paths') {
    output(service.paths(), flags.json);
    return;
  }

  if (command === 'setup') {
    const result = service.setup({
      mode: flags.mode,
      apiUrl: flags.apiUrl,
      canonicalHasnaXyz: flags.canonicalHasnaXyz,
    });
    output(result, flags.json);
    return;
  }

  if (command === 'auth') {
    const action = positional[1] ?? 'whoami';
    if (action === 'whoami' || action === 'status') {
      const result = service.authStatus(process.env);
      output({ ok: true, ...result, message: result.authenticated ? `Authenticated via ${result.source}` : 'Not authenticated' }, flags.json);
      return;
    }
    if (action === 'login') {
      const apiKey = flags.apiKey ?? process.env.KNOWLEDGE_API_KEY ?? process.env.HASNA_KNOWLEDGE_API_KEY;
      if (!apiKey) throw new Error('Usage: knowledge auth login --api-key <key> [--email <email>]');
      const auth = service.saveAuth({
        apiKey,
        email: flags.email,
        orgSlug: flags.org,
        orgId: flags.orgId,
        userId: flags.userId,
        apiUrl: flags.apiUrl,
      }, process.env);
      output({
        ok: true,
        authenticated: true,
        email: auth.email ?? null,
        org_slug: auth.org_slug ?? null,
        api_url: auth.api_url ?? service.authStatus(process.env).api_url,
        auth_path: service.authStatus(process.env).auth_path,
        message: `Saved hosted credentials for ${auth.email ?? 'API key'}`,
      }, flags.json);
      return;
    }
    if (action === 'logout') {
      const removed = service.clearAuth(process.env);
      output({ ok: true, removed, message: removed ? 'Removed hosted credentials' : 'No hosted credentials found' }, flags.json);
      return;
    }
    throw new Error("Invalid auth action. Use 'login', 'whoami', or 'logout'.");
  }

  if (command === 'remote') {
    const action = positional[1] ?? 'status';
    if (action === 'contracts' || action === 'contract') {
      const auth = service.authStatus(process.env);
      output({
        ok: true,
        authenticated: auth.authenticated,
        api_url: auth.api_url,
        contract: service.remoteContract(),
        message: `Remote contract v${service.remoteContract().contract_version}`,
      }, flags.json);
      return;
    }
    if (action === 'status') {
      const auth = service.authStatus(process.env);
      const contract = service.remoteContract();
      output({
        ok: true,
        mode: service.config().mode,
        authenticated: auth.authenticated,
        auth_source: auth.source,
        api_url: auth.api_url,
        client_ready: Boolean(service.remoteClient(process.env)),
        contract_version: contract.contract_version,
        capabilities: contract.capabilities,
        message: auth.authenticated ? `Remote client ready for ${auth.api_url}` : 'Remote client not authenticated',
      }, flags.json);
      return;
    }
    throw new Error("Invalid remote action. Use 'contracts' or 'status'.");
  }

  if (command === 'storage') {
    const action = positional[1] ?? 'status';
    if (action === 'status') {
      const contract = service.storageContract();
      const validation = service.validateStorage();
      output({
        ok: validation.ok,
        ...contract,
        validation,
        message: `${contract.storage_type} artifact storage at ${contract.artifact_store.uri_prefix}`,
      }, flags.json);
      return;
    }
    if (action === 'validate') {
      const validation = service.validateStorage();
      output({
        ok: validation.ok,
        validation,
        message: validation.ok ? 'Storage contract valid' : `Storage contract invalid: ${validation.errors.join('; ')}`,
      }, flags.json);
      return;
    }
    if (action === 'repair-artifact-keys' || action === 'repair-keys') {
      const repair = service.repairArtifactManifestKeys({
        approveWrite: flags.approveWrite,
        approvedBy: flags.approvedBy,
        dryRun: flags.dryRun,
      });
      output(repair, flags.json);
      return;
    }
    throw new Error("Invalid storage action. Use 'status', 'validate', or 'repair-artifact-keys'.");
  }

  if (command === 'machines') {
    const action = positional[1] ?? 'topology';
    if (action === 'topology' || action === 'status') {
      const topology = await service.machineTopology({
        includeTailscale: flags.tailscale !== false,
      });
      output(topology, flags.json);
      return;
    }
    if (action === 'preflight' || action === 'check') {
      const machineId = positional[2] ?? flags.machine ?? 'local';
      const workspacePath = flags.workspace ?? process.cwd();
      const preflight = await service.machinePreflight({
        machineId,
        commands: [
          { command: 'bun', required: true },
          { command: 'knowledge', required: true },
        ],
        packages: [
          { name: pkg.name, command: 'knowledge', expectedVersion: pkg.version, required: true },
          { name: '@hasna/machines', command: 'machines', required: false },
        ],
        workspaces: [
          {
            label: 'open-knowledge',
            path: workspacePath,
            expectedPackageName: pkg.name,
            expectedVersion: pkg.version,
            required: true,
          },
        ],
      });
      output(preflight, flags.json);
      if (!preflight.ok && !flags.json) process.exitCode = 1;
      return;
    }
    throw new Error("Invalid machines action. Use 'topology' or 'preflight'.");
  }

  if (command === 'sync') {
    const action = positional[1] ?? 'status';
    const tables = flags.tables ? flags.tables.split(',').map((table) => table.trim()).filter(Boolean) : undefined;
    if (action === 'status') {
      const status = service.syncStatus();
      output(status, flags.json);
      return;
    }
    if (action === 'doctor' || action === 'readiness' || action === 'preflight') {
      const doctor = await service.syncDoctor({
        machine: flags.machine ?? null,
        peerWorkspace: flags.peerWorkspace ?? null,
        includeTailscale: flags.tailscale !== false,
        tables,
      });
      output({
        package: { name: pkg.name, version: pkg.version },
        ...doctor,
      }, flags.json);
      if (!doctor.ok && !flags.json) process.exitCode = 1;
      return;
    }
    if (action === 'snapshot' || action === 'record') {
      const snapshot = await service.createSyncSnapshot({
        includeTailscale: flags.tailscale !== false,
        machineId: flags.machine,
      });
      output(snapshot, flags.json);
      return;
    }
    if (action === 'conflicts' || action === 'conflict') {
      const conflictAction = positional[2];
      if (conflictAction === 'show' || conflictAction === 'get') {
        const id = positional[3] ?? flags.id;
        if (!id) throw new Error('Usage: knowledge sync conflicts show <id>');
        const conflict = service.syncConflict(id);
        output({ ok: true, conflict, message: `Sync conflict ${id}` }, flags.json);
        return;
      }
      if (conflictAction === 'propose' || conflictAction === 'proposal') {
        const id = positional[3] ?? flags.id;
        if (!id) throw new Error('Usage: knowledge sync conflicts propose <id>');
        output(flags.mode === 'ai'
          ? await service.proposeSyncConflictResolutionWithAi({
              id,
              modelRef: flags.model,
              fake: flags.fake,
            })
          : service.proposeSyncConflictResolution(id), flags.json);
        return;
      }
      if (conflictAction === 'resolve') {
        const id = positional[3] ?? flags.id;
        if (!id) throw new Error('Usage: knowledge sync conflicts resolve <id> --approve-write --approved-by <name> [--strategy <name>]');
        const result = service.resolveSyncConflict({
          id,
          strategy: flags.strategy,
          approvedBy: flags.approvedBy,
          approveWrite: flags.approveWrite,
          proposedPatchUri: flags.patchUri,
        });
        output(result, flags.json);
        if (!result.ok && !flags.json) process.exitCode = 1;
        return;
      }
      const conflicts = service.syncConflicts({
        status: conflictAction,
        limit: flags.limit,
      });
      output({
        ok: true,
        conflicts,
        message: `${conflicts.length} sync conflict(s)`,
      }, flags.json);
      return;
    }
    if (action === 'machines' || action === 'registry') {
      const machines = service.syncMachines();
      output({
        ok: true,
        machines,
        message: `${machines.length} registered sync machine(s)`,
      }, flags.json);
      return;
    }
    if (action === 'export') {
      const bundle = service.exportSyncBundle({
        machineId: flags.machine ?? null,
        tables,
        includeArtifactContent: flags.artifactContent !== false,
      });
      output(bundle, true);
      return;
    }
    if (action === 'import') {
      const raw = await Bun.stdin.text();
      if (!raw.trim()) throw new Error('Usage: knowledge sync import < bundle.json');
      const result = await service.importSyncBundle({
        bundle: JSON.parse(raw),
        dryRun: flags.dryRun,
        direction: 'import',
        machineId: flags.machine ?? null,
      });
      output(result, flags.json);
      return;
    }
    if (action === 'dry-run' || action === 'pull' || action === 'push' || action === 'sync') {
      if (!flags.peerWorkspace && machineIsLocal(flags.machine)) throw new Error(`Usage: knowledge sync ${action} --peer-workspace <repo-or-knowledge-home> [--scope project]\nRemote machine sync can omit --peer-workspace when machines path mapping is configured.`);
      const direction = action === 'dry-run'
        ? 'both'
        : action === 'sync'
          ? 'both'
          : action;
      const result = !machineIsLocal(flags.machine)
        ? await service.syncRemotePeer({
            direction,
            machine: flags.machine!,
            peerWorkspace: flags.peerWorkspace,
            tables,
            dryRun: flags.dryRun === true || action === 'dry-run',
            includeArtifactContent: flags.artifactContent !== false,
            includeTailscale: flags.tailscale !== false,
          })
        : await service.syncPeer({
            peerWorkspace: flags.peerWorkspace,
            direction,
            dryRun: flags.dryRun === true || action === 'dry-run',
            tables,
            includeArtifactContent: flags.artifactContent !== false,
            machineId: flags.machine ?? null,
          });
      output(result, flags.json);
      if (!result.ok && !flags.json) process.exitCode = 1;
      return;
    }
    throw new Error("Invalid sync action. Use 'status', 'doctor', 'snapshot', 'conflicts', 'machines', 'dry-run', 'pull', 'push', 'sync', 'export', or 'import'.");
  }

  if (command === 'db') {
    const action = positional[1] ?? 'init';
    if (action === 'init') {
      const result = service.initDb();
      output({ ok: true, ...result, message: `Initialized ${result.path}` }, flags.json);
      return;
    }
    if (action === 'stats') {
      const stats = service.dbStats();
      output({ ok: true, path: service.workspace.knowledgeDbPath, ...stats, message: `knowledge.db schema v${stats.schema_version}` }, flags.json);
      return;
    }
    if (action === 'storage') {
      const storageAction = positional[2] ?? 'status';
      const tables = parseStorageTables(flags.tables);
      if (storageAction === 'status') {
        const status = getDatabaseStorageStatus({ scope: flags.scope });
        output({
          ok: true,
          ...status,
          message: `knowledge.db storage mode ${status.mode}${status.activeEnv ? ` via ${status.activeEnv}` : ''}`,
        }, flags.json);
        return;
      }
      if (storageAction === 'push') {
        const results = await databaseStoragePush({ scope: flags.scope, tables });
        output({ ok: syncOk(results), results, message: syncMessage(results, 'push') }, flags.json);
        return;
      }
      if (storageAction === 'pull') {
        const results = await databaseStoragePull({ scope: flags.scope, tables });
        output({ ok: syncOk(results), results, message: syncMessage(results, 'pull') }, flags.json);
        return;
      }
      if (storageAction === 'sync') {
        const result = await databaseStorageSync({ scope: flags.scope, tables });
        output({
          ok: syncOk(result.pull) && syncOk(result.push),
          ...result,
          message: `${syncMessage(result.pull, 'pull')}; ${syncMessage(result.push, 'push')}`,
        }, flags.json);
        return;
      }
      throw new Error("Invalid db storage action. Use 'status', 'push', 'pull', or 'sync'.");
    }
    throw new Error("Invalid db action. Use 'init', 'stats', or 'storage'.");
  }

  if (command === 'wiki') {
    const action = positional[1] ?? 'init';
    if (action === 'init') {
      const result = await service.initWiki();
      output({ ok: true, ...result, message: `Initialized wiki layout in ${service.workspace.home}` }, flags.json);
      return;
    }
    if (action === 'compile') {
      const args = positional.slice(2);
      const sourceRefs = args.filter((arg) => /^(open-files|file|s3|https?):\/\//.test(arg));
      const query = args.filter((arg) => !/^(open-files|file|s3|https?):\/\//.test(arg)).join(' ');
      const result = await service.compileWiki({
        title: flags.title,
        query: query || flags.search,
        sourceRefs: sourceRefs.length > 0 ? sourceRefs : undefined,
        limit: flags.limit,
      });
      output({ ok: true, ...result, message: `Compiled wiki page ${result.path}` }, flags.json);
      return;
    }
    if (action === 'file-answer' || action === 'answer') {
      const prompt = positional.slice(2).join(' ');
      if (!prompt) throw new Error('Usage: knowledge wiki file-answer <prompt> --content <answer> --approve-write');
      if (!flags.content) throw new Error('Missing --content <answer> for wiki file-answer.');
      const result = await service.fileAnswer({
        prompt,
        answer: flags.content,
        approveWrite: flags.approveWrite,
        limit: flags.limit,
        semantic: flags.semantic,
        modelRef: flags.model,
        dimensions: flags.dimensions,
        fake: flags.fake,
      });
      output({ ok: true, ...result }, flags.json);
      return;
    }
    if (action === 'lint') {
      const result = service.lintWiki();
      output({ ok: result.ok, ...result, message: result.ok ? 'Wiki lint passed' : `Wiki lint found ${result.issue_count} issue(s)` }, flags.json);
      return;
    }
    throw new Error("Invalid wiki action. Use 'init', 'compile', 'file-answer', or 'lint'.");
  }

  if (command === 'safety') {
    const action = positional[1] ?? 'status';
    const resolvedWorkspace = service.ensureWorkspace();
    const policy = service.safetyPolicy();
    service.initDb();
    const db = openKnowledgeDb(resolvedWorkspace.knowledgeDbPath);
    try {
      if (action === 'status') {
        output({
          ok: true,
          mode: policy.mode,
          workspace: resolvedWorkspace.home,
          allow_write_roots: policy.allowWriteRoots,
          read_only_source_access: policy.readOnlySourceAccess,
          network: policy.network,
          redaction: policy.redaction,
          approvals: policy.approvals,
          message: `Safety policy: ${policy.mode}`,
        }, flags.json);
        return;
      }
      if (action === 'check') {
        const checkAction = positional[2] ?? 'generated_write';
        const target = positional[3] ?? null;
        let decision: ReturnType<typeof approvalStatus> | { action: string; target_uri: string | null; approval_required: false; approved: boolean; decision: string };
        try {
          if (checkAction === 'web_search') {
            assertWebSearchAllowed(policy);
            decision = { action: checkAction, target_uri: target, approval_required: false, approved: true, decision: 'allow' };
          } else if (checkAction === 's3_read') {
            if (!target) throw new Error('safety check s3_read requires an s3:// target.');
            assertS3ReadAllowed(target, policy);
            decision = { action: checkAction, target_uri: target, approval_required: false, approved: true, decision: 'allow' };
          } else {
            decision = approvalStatus(db, policy, checkAction, target);
          }
          recordAuditEvent(db, {
            event_type: 'safety_check',
            action: checkAction,
            target_uri: target,
            decision: decision.decision === 'allow' ? 'allow' : 'requires_approval',
            metadata: decision,
          });
          output({ ok: true, ...decision, message: `Safety check ${decision.decision}` }, flags.json);
          return;
        } catch (error) {
          recordAuditEvent(db, {
            event_type: 'safety_check',
            action: checkAction,
            target_uri: target,
            decision: 'deny',
            metadata: { error: error instanceof Error ? error.message : String(error) },
          });
          throw error;
        }
      }
      if (action === 'approve') {
        const approveAction = positional[2] ?? 'generated_write';
        const target = positional[3] ?? null;
        const approval = createApprovalGate(db, {
          action: approveAction,
          target_uri: target,
          reason: 'local-cli approval',
          metadata: { scope: flags.scope ?? 'global' },
        });
        recordAuditEvent(db, {
          event_type: 'approval',
          action: approveAction,
          target_uri: target,
          decision: 'allow',
          metadata: { approval_id: approval.id },
        });
        output({ ok: true, ...approval, action: approveAction, target_uri: target, message: `Approved ${approveAction}` }, flags.json);
        return;
      }
      if (action === 'audit') {
        const rows = db.query<{
          id: string;
          event_type: string;
          action: string;
          target_uri: string | null;
          decision: string;
          metadata_json: string;
          created_at: string;
        }, []>(
          'SELECT id, event_type, action, target_uri, decision, metadata_json, created_at FROM audit_events ORDER BY created_at DESC LIMIT 50',
        ).all().map((row) => ({
          id: row.id,
          event_type: row.event_type,
          action: row.action,
          target_uri: row.target_uri,
          decision: row.decision,
          metadata: JSON.parse(row.metadata_json),
          created_at: row.created_at,
        }));
        output({ ok: true, events: rows, message: `${rows.length} audit event(s)` }, flags.json);
        return;
      }
      if (action === 'redact') {
        const text = positional.slice(2).join(' ');
        if (!text) throw new Error('Usage: knowledge safety redact <text>');
        const result = redactSecrets(text, policy);
        if (result.findings.length > 0) {
          recordRedactionFindings(db, {
            source_uri: 'safety://redact',
            findings: result.findings,
            metadata: { command: 'safety redact' },
          });
        }
        recordAuditEvent(db, {
          event_type: 'redaction',
          action: 'safety_redact',
          target_uri: 'safety://redact',
          decision: result.findings.length > 0 ? 'redacted' : 'allow',
          metadata: { findings: result.findings.length },
        });
        output({ ok: true, text: result.text, findings: result.findings, message: `Redacted ${result.findings.length} finding(s)` }, flags.json);
        return;
      }
      throw new Error("Invalid safety action. Use 'status', 'check', 'approve', 'audit', or 'redact'.");
    } finally {
      db.close();
    }
  }

  if (command === 'source') {
    const action = positional[1] ?? '';
    if (action !== 'resolve') throw new Error("Invalid source action. Use 'resolve'.");
    const sourceRef = positional[2];
    if (!sourceRef) throw new Error('Usage: knowledge source resolve <source-ref>');
    const result = await service.resolveSource(sourceRef, {
      purpose: flags.purpose,
      limit: flags.limit,
    });
    output({
      ok: true,
      ...result,
      message: result.resolved
        ? `Resolved ${result.source_ref} (${result.content.chunks_returned}/${result.content.chunks_total} chunks)`
        : `Source not indexed: ${sourceRef}`,
    }, flags.json);
    return;
  }

  if (command === 'ingest') {
    const action = positional[1] ?? '';
    if (action === 'manifest') {
      const input = positional[2];
      if (!input) throw new Error('Usage: knowledge ingest manifest <file|s3://bucket/key>');
      const result = await service.ingestManifest(input);
      output({ ok: true, ...result, message: `Ingested ${result.items_seen} manifest item(s)` }, flags.json);
      return;
    }
    if (action === 'source') {
      const sourceRef = positional[2];
      if (!sourceRef) throw new Error('Usage: knowledge ingest source <source-ref>');
      const result = await service.ingestSource(sourceRef, flags.purpose);
      output({ ok: true, ...result, message: `Ingested source ${result.source_ref} (${result.chunks_inserted} chunks)` }, flags.json);
      return;
    }
    throw new Error("Invalid ingest action. Use 'manifest' or 'source'.");
  }

  if (command === 'reindex') {
    const action = positional[1] ?? 'status';
    if (action === 'status') {
      const result = service.reindexHealth({
        modelRef: flags.model,
        dimensions: flags.dimensions,
        fake: flags.fake,
      });
      output({ ok: true, ...result, message: `${result.missing_embeddings} chunk(s) missing embeddings` }, flags.json);
      return;
    }
    if (action === 'enqueue') {
      const result = service.enqueueReindex({
        modelRef: flags.model,
        dimensions: flags.dimensions,
        fake: flags.fake,
      });
      output({ ok: true, ...result, message: `Queued ${result.enqueued} embedding refresh item(s)` }, flags.json);
      return;
    }
    if (action === 'embeddings') {
      const result = await service.refreshEmbeddings({
        full: flags.full,
        limit: flags.limit,
        modelRef: flags.model,
        dimensions: flags.dimensions,
        fake: flags.fake,
      });
      output({ ok: true, ...result, message: `Embedded ${result.indexed.chunks_embedded} chunk(s)` }, flags.json);
      return;
    }
    if (action === 'outbox') {
      const input = positional[2];
      if (!input) throw new Error('Usage: knowledge reindex outbox <file|s3://bucket/key>');
      const result = await service.consumeOutbox(input);
      output({ ok: true, ...result, message: `Consumed ${result.events_seen} outbox event(s)` }, flags.json);
      return;
    }
    throw new Error("Invalid reindex action. Use 'status', 'enqueue', 'embeddings', or 'outbox'.");
  }

  if (command === 'embeddings') {
    const action = positional[1] ?? 'status';
    if (action === 'status') {
      const result = service.embeddingStatus();
      output({ ok: true, ...result, message: `${result.total_vector_entries} vector index entries` }, flags.json);
      return;
    }
    if (action === 'index') {
      const result = await service.indexEmbeddings({
        limit: flags.limit,
        modelRef: flags.model,
        dimensions: flags.dimensions,
        fake: flags.fake,
      });
      output({ ok: true, ...result, message: `Embedded ${result.chunks_embedded} chunk(s)` }, flags.json);
      return;
    }
    if (action === 'search') {
      const query = positional.slice(2).join(' ');
      if (!query) throw new Error('Usage: knowledge embeddings search <query>');
      const result = await service.semanticSearch({
        query,
        limit: flags.limit,
        modelRef: flags.model,
        dimensions: flags.dimensions,
        fake: flags.fake,
      });
      output({ ok: true, ...result, message: `${result.results.length} semantic result(s)` }, flags.json);
      return;
    }
    throw new Error("Invalid embeddings action. Use 'status', 'index', or 'search'.");
  }

  if (command === 'search') {
    const query = positional.slice(1).join(' ');
    if (!query) throw new Error('Usage: knowledge search <query>');
    if (flags.context) {
      const context = await service.retrieveContext({
        query,
        limit: flags.limit,
        semantic: flags.semantic,
        modelRef: flags.model,
        dimensions: flags.dimensions,
        fake: flags.fake,
        legacyStorePath: storePath,
      });
      output({ ok: true, ...context, message: `${context.excerpts.length} context excerpt(s)` }, flags.json);
      return;
    }
    const result = await service.search({
      query,
      limit: flags.limit,
      semantic: flags.semantic,
      modelRef: flags.model,
      dimensions: flags.dimensions,
      fake: flags.fake,
      legacyStorePath: storePath,
    });
    output({ ok: true, ...result, message: `${result.results.length} search result(s)` }, flags.json);
    return;
  }

  if (command === 'web') {
    const action = positional[1] ?? 'search';
    if (action !== 'search') throw new Error("Invalid web action. Use 'search'.");
    const query = positional.slice(2).join(' ');
    if (!query) throw new Error('Usage: knowledge web search <query>');
    const result = await service.webSearch({
      query,
      limit: flags.limit,
      modelRef: flags.model,
      provider: flags.provider as AiProviderId | undefined,
      domains: flags.domain,
      fake: flags.fake,
      fileResults: flags.fileResults,
    });
    output({ ok: true, ...result, message: `${result.sources.length} web source(s)` }, flags.json);
    return;
  }

  if (command === 'ask' || command === 'build') {
    const prompt = positional.slice(commandArgOffset).join(' ');
    if (!prompt) throw new Error('Usage: knowledge ask <prompt>');
    const result = await service.runPrompt({
      prompt,
      limit: flags.limit,
      semantic: flags.semantic,
      modelRef: flags.model,
      dimensions: flags.dimensions,
      fake: flags.fake,
      generate: flags.generate,
      approveWrite: flags.approveWrite,
      legacyStorePath: storePath,
    });
    output({ ok: true, ...result, message: result.generated ? 'Generated answer with citations' : 'Prepared citation context draft' }, flags.json);
    return;
  }

  if (command === 'providers') {
    const action = positional[1] ?? 'status';
    if (action === 'status') {
      const status = service.providerStatus();
      const configured = status.providers.filter((entry) => entry.configured).length;
      output({ ok: true, ...status, message: `${configured}/${status.providers.length} provider credential(s) configured` }, flags.json);
      return;
    }
    if (action === 'models') {
      const models = service.modelRegistry();
      output({ ok: true, models, message: `${models.length} model alias(es)` }, flags.json);
      return;
    }
    if (action === 'check') {
      const target = positional[2] ?? 'default';
      const modelRef = resolveModelRef(target, service.config());
      const parsed = parseModelRef(modelRef);
      const credential = assertProviderCredentials(parsed.provider as AiProviderId, service.config());
      output({ ok: true, target, model_ref: modelRef, provider: parsed.provider, model: parsed.model, credential, message: `${parsed.provider} credentials configured` }, flags.json);
      return;
    }
    throw new Error("Invalid providers action. Use 'status', 'models', or 'check'.");
  }

  ensureStore(storePath);

  if (command === 'add') {
    const title = positional[1];
    const content = positional[2];
    if (!title || !content) throw new Error('Usage: knowledge add <title> <content>');
    withLock(storePath, () => {
      const db = loadStore(storePath);
      const item: KnowledgeItem = {
        id: makeId(),
        title,
        content,
        url: flags.url ?? null,
        tags: flags.tag ? [flags.tag] : [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      db.items.push(item);
      saveStore(storePath, db);
      log('info', 'Item added', { id: item.id, title: item.title });
      output({ ok: true, item, message: `Added ${item.id}` }, flags.json);
    });
    return;
  }

  if (command === 'list') {
    if (flags.format !== undefined && flags.format !== 'table' && flags.format !== 'json') {
      throw new Error("Invalid --format value for list. Use 'table' or 'json'.");
    }
    withLock(storePath, () => {
      const db = loadStore(storePath);
      const page = Number.isFinite(flags.page) && (flags.page as number) > 0 ? flags.page as number : 1;
      const limit = Number.isFinite(flags.limit) && (flags.limit as number) > 0 ? flags.limit as number : 20;
      const search = flags.search ? String(flags.search).toLowerCase() : '';
      const tag = flags.tag ? String(flags.tag).toLowerCase() : '';
      const useTable = flags.format === 'table' || (!flags.json && !flags.format && useColor(flags));
      const useJson = flags.json || flags.format === 'json';

      let filtered = db.items;
      if (flags.archived) filtered = filtered.filter((x) => x.archived === true);
      else if (!flags.includeArchived) filtered = filtered.filter((x) => !x.archived);
      if (search) filtered = filtered.filter((x) => x.title.toLowerCase().includes(search) || x.content.toLowerCase().includes(search));
      if (tag) filtered = filtered.filter((x) => x.tags && x.tags.map((t) => t.toLowerCase()).includes(tag));

      const { sorted, sort, direction } = sortItems(filtered, flags);
      const start = (page - 1) * limit;
      const rows = sorted.slice(start, start + limit);
      const totalPages = Math.max(1, Math.ceil(sorted.length / limit));

      if (useJson) { output({ ok: true, page, limit, total: sorted.length, total_pages: totalPages, sort, direction, items: rows }, true); return; }
      if (rows.length === 0) { output(`No items found (search=${search || 'none'}, tag=${tag || 'none'})`, false); return; }
      if (useTable) {
        const col = (v: string) => v;
        const header = `${col('ID')}\t${col('TITLE')}\t${col('CREATED')}\t${col('URL')}\t${col('TAGS')}`;
        console.log(header);
        for (const row of rows) {
          console.log(`${row.id}\t${col(row.title)}\t${row.created_at}\t${row.url ? col(row.url) : ''}\t${row.tags?.length ? col(`[${row.tags.join(', ')}]`) : ''}`);
        }
        console.log(`Page ${page}/${totalPages} | showing ${rows.length} of ${sorted.length} | sort=${sort} ${direction} | search=${search || 'none'} | tag=${tag || 'none'}`);
      } else {
        for (const row of rows) {
          console.log(`${row.id}\t${row.title}\t${row.created_at}${row.url ? `\t${row.url}` : ''}${row.tags?.length ? `\t[${row.tags.join(', ')}]` : ''}`);
        }
        console.log(`Page ${page}/${totalPages} | showing ${rows.length} of ${sorted.length} | sort=${sort} ${direction} | search=${search || 'none'} | tag=${tag || 'none'}`);
      }
    });
    return;
  }

  if (command === 'get') {
    requireId(flags);
    withLock(storePath, () => {
      const db = loadStore(storePath);
      const item = db.items.find((x) => x.id === flags.id || x.short_id === flags.id);
      if (!item) throw new Error(`Item not found: ${flags.id}`);
      output({ ok: true, item, message: `${item.id}: ${item.title}` }, flags.json);
    });
    return;
  }

  if (command === 'update') {
    requireId(flags);
    withLock(storePath, () => {
      const db = loadStore(storePath);
      const idx = db.items.findIndex((x) => x.id === flags.id || x.short_id === flags.id);
      if (idx === -1) throw new Error(`Item not found: ${flags.id}`);
      const item = db.items[idx];
      if (flags.title !== undefined) item.title = flags.title;
      if (flags.content !== undefined) item.content = flags.content;
      if (flags.url !== undefined) item.url = flags.url;
      if (flags.tag !== undefined) {
        item.tags = item.tags || [];
        if (!item.tags.map((t) => t.toLowerCase()).includes(flags.tag!.toLowerCase())) {
          item.tags.push(flags.tag!);
        }
      }
      item.updated_at = new Date().toISOString();
      db.items[idx] = item;
      saveStore(storePath, db);
      output({ ok: true, item, message: `Updated ${item.id}` }, flags.json);
    });
    return;
  }

  if (command === 'archive' || command === 'restore') {
    requireId(flags);
    withLock(storePath, () => {
      const db = loadStore(storePath);
      const idx = db.items.findIndex((x) => x.id === flags.id || x.short_id === flags.id);
      if (idx === -1) throw new Error(`Item not found: ${flags.id}`);
      const item = db.items[idx];
      item.archived = command === 'archive';
      item.updated_at = new Date().toISOString();
      db.items[idx] = item;
      saveStore(storePath, db);
      output({ ok: true, item, message: `${command === 'archive' ? 'Archived' : 'Restored'} ${item.id}` }, flags.json);
    });
    return;
  }

  if (command === 'untag') {
    requireId(flags);
    if (!flags.tag) throw new Error('Missing required --tag. Example: knowledge untag --id <id> -t <tag>');
    withLock(storePath, () => {
      const db = loadStore(storePath);
      const idx = db.items.findIndex((x) => x.id === flags.id || x.short_id === flags.id);
      if (idx === -1) throw new Error(`Item not found: ${flags.id}`);
      const item = db.items[idx];
      const before = item.tags?.length ?? 0;
      item.tags = (item.tags ?? []).filter((tag) => tag.toLowerCase() !== flags.tag!.toLowerCase());
      item.updated_at = new Date().toISOString();
      db.items[idx] = item;
      saveStore(storePath, db);
      output({ ok: true, item, removed: before - item.tags.length, message: `Removed tag from ${item.id}` }, flags.json);
    });
    return;
  }

  if (command === 'upsert') {
    const title = flags.title ?? positional[1];
    const content = flags.content ?? positional[2];
    withLock(storePath, () => {
      const db = loadStore(storePath);
      const idx = flags.id ? db.items.findIndex((x) => x.id === flags.id || x.short_id === flags.id) : -1;
      const now = new Date().toISOString();
      if (idx === -1) {
        if (!title || !content) throw new Error('New item requires title and content. Example: knowledge upsert <title> <content> [--id <id>]');
        const id = flags.id ?? makeId();
        const item: KnowledgeItem = {
          id,
          short_id: makeShortId(id),
          title,
          content,
          url: flags.url ?? null,
          tags: flags.tag ? [flags.tag] : [],
          metadata: {},
          archived: false,
          created_at: now,
          updated_at: now,
        };
        db.items.push(item);
        saveStore(storePath, db);
        output({ ok: true, created: true, item, message: `Upserted ${item.id}` }, flags.json);
        return;
      }
      const item = db.items[idx];
      if (title !== undefined) item.title = title;
      if (content !== undefined) item.content = content;
      if (flags.url !== undefined) item.url = flags.url;
      if (flags.tag !== undefined) {
        item.tags = item.tags || [];
        if (!item.tags.map((tag) => tag.toLowerCase()).includes(flags.tag.toLowerCase())) item.tags.push(flags.tag);
      }
      item.updated_at = now;
      db.items[idx] = item;
      saveStore(storePath, db);
      output({ ok: true, created: false, item, message: `Upserted ${item.id}` }, flags.json);
    });
    return;
  }

  if (command === 'delete') {
    requireId(flags);
    if (!flags.yes) throw new Error('Refusing delete without --yes. Re-run with: knowledge delete --id <id> --yes');
    withLock(storePath, () => {
      const db = loadStore(storePath);
      const before = db.items.length;
      db.items = db.items.filter((x) => x.id !== flags.id && x.short_id !== flags.id);
      const deleted = before !== db.items.length;
      saveStore(storePath, db);
      if (!deleted) throw new Error(`Item not found: ${flags.id}`);
      log('info', 'Item deleted', { id: flags.id });
      output({ ok: true, deleted_id: flags.id, message: `Deleted ${flags.id}` }, flags.json);
    });
    return;
  }

  if (command === 'export') {
    const format = flags.format ?? 'json';
    if (format !== 'json' && format !== 'jsonl') throw new Error("Invalid --format. Use 'json' or 'jsonl'.");
    withLock(storePath, () => {
      const db = loadStore(storePath);
      if (format === 'jsonl') {
        for (const item of db.items) console.log(JSON.stringify(item));
      } else {
        output({ ok: true, items: db.items }, flags.json);
      }
    });
    return;
  }

  if (command === 'prune') {
    if (!flags.yes) throw new Error('Refusing prune without --yes. Re-run with: knowledge prune --yes [--older-than <days>] [--empty]');
    withLock(storePath, () => {
      const db = loadStore(storePath);
      const before = db.items.length;
      if (flags.olderThan !== undefined) {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - flags.olderThan);
        db.items = db.items.filter((x) => new Date(x.created_at) >= cutoff);
      }
      if (flags.empty) {
        db.items = db.items.filter((x) => x.content.trim().length > 0);
      }
      const pruned = before - db.items.length;
      saveStore(storePath, db);
      log('info', 'Prune completed', { pruned, remaining: db.items.length });
      output({ ok: true, pruned, remaining: db.items.length, message: `Pruned ${pruned} item(s)` }, flags.json);
    });
    return;
  }

  if (command === 'dedupe') {
    if (!flags.yes) throw new Error('Refusing dedupe without --yes. Re-run with: knowledge dedupe --yes [--json]');
    withLock(storePath, () => {
      const db = loadStore(storePath);
      const seen = new Set<string>();
      const before = db.items.length;
      db.items = db.items.filter((x) => {
        const key = `${x.title}\u0000${x.content}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      const removed = before - db.items.length;
      saveStore(storePath, db);
      log('info', 'Dedupe completed', { removed, remaining: db.items.length });
      output({ ok: true, removed, remaining: db.items.length, message: `Dedupe removed ${removed} duplicate(s)` }, flags.json);
    });
    return;
  }

  if (command === 'stats') {
    withLock(storePath, () => {
      const db = loadStore(storePath);
      const activeItems = db.items.filter((x) => !x.archived);
      const total = activeItems.length;
      const archived = db.items.length - total;
      const withUrl = activeItems.filter((x) => x.url).length;
      const withTags = activeItems.filter((x) => x.tags && x.tags.length > 0).length;
      const oldest = total > 0 ? activeItems.map((x) => x.created_at).sort()[0] : null;
      const newest = total > 0 ? activeItems.map((x) => x.created_at).sort()[total - 1] : null;
      const tagCounts: Record<string, number> = {};
      for (const item of activeItems) {
        for (const tag of item.tags || []) {
          tagCounts[tag] = (tagCounts[tag] || 0) + 1;
        }
      }
      const topTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([tag, count]) => ({ tag, count }));
      output({
        ok: true,
        total,
        archived,
        with_url: withUrl,
        with_tags: withTags,
        oldest,
        newest,
        top_tags: topTags,
        message: `${total} items | ${withUrl} with URL | ${withTags} with tags`,
      }, flags.json);
    });
    return;
  }

  const suggestion = suggestCommand(positional[0]);
  const hint = suggestion ? ` Did you mean '${suggestion}'?` : '';
  log('warn', 'Unknown command', { input: positional[0], suggestion });
  throw new Error(`Unknown command: ${positional[0]}.${hint} Run 'knowledge --help' for available commands.`);
}

if (import.meta.main) {
  run(process.argv.slice(2)).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    log('error', 'CLI error', { message, stack: error instanceof Error ? error.stack : undefined });
    console.error(`Error: ${message}`);
    process.exitCode = 1;
  });
}

export { run, parseArgs, suggestCommand, sortItems };
