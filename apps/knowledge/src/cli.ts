#!/usr/bin/env bun
/**
 * @hasna/knowledge
 * Copyright 2026 Hasna Inc.
 * Licensed under the Apache License, Version 2.0
 */
import { defaultStorePath, ensureStore, importLegacyGlobalStore, type KnowledgeItem } from './store';
import { resolveItemStore, type ItemStore } from './item-store';
import { isKnowledgeApiMode } from './cloud-store';
import { openKnowledgeDb } from './knowledge-db';
import { createKnowledgeService } from './service';
import { createKnowledgeProjectPanel, formatKnowledgeProjectPanel } from './project-panel';
import { getStorageStatus as getDatabaseStorageStatus } from './storage';
import { assertProviderCredentials, parseModelRef, resolveModelRef, type AiProviderId } from './providers';
import { approvalStatus, assertS3ReadAllowed, assertWebSearchAllowed, createApprovalGate, recordAuditEvent, recordRedactionFindings, redactSecrets } from './safety';
import { Command } from 'commander';
import { registerEventsCommands } from '@hasna/events/commander';
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
  verbose?: boolean;
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
  maxTokens?: number;
  maxItems?: number;
  from?: string;
  since?: string;
  topic?: string;
  dedupe?: boolean;
  generate?: boolean;
  approveWrite?: boolean;
  provider?: string;
  mode?: string;
  machine?: string;
  workspace?: string;
  apiUrl?: string;
  canonicalExample?: boolean;
  apiKey?: string;
  email?: string;
  org?: string;
  orgId?: string;
  userId?: string;
  owner?: string;
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
  project?: string;
  contract?: boolean;
  sourceRef?: string[];
  allowGlobal?: boolean;
}

interface ParseResult {
  positional: string[];
  flags: Flags;
}

const EVENTS_COMMANDS = ['events', 'webhooks'];
const COMMANDS = ['add', 'list', 'get', 'delete', 'update', 'archive', 'restore', 'upsert', 'untag', 'export', 'prune', 'dedupe', 'stats', 'inventory', 'project-panel', 'paths', 'setup', 'auth', 'storage', 'machines', 'sync', 'db', 'wiki', 'app-wiki', 'source', 'ingest', 'reindex', 'search', 'context', 'proposals', 'web', 'ask', 'build', 'embeddings', 'providers', 'safety', 'help', ...EVENTS_COMMANDS];
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
      case '--verbose': flags.verbose = true; break;
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
      case '--max-tokens': flags.maxTokens = Number(argv[i + 1]); i += 1; break;
      case '--max-items': flags.maxItems = Number(argv[i + 1]); i += 1; break;
      case '--from': flags.from = argv[i + 1]; i += 1; break;
      case '--since': flags.since = argv[i + 1]; i += 1; break;
      case '--topic': flags.topic = argv[i + 1]; i += 1; break;
      case '--dedupe': flags.dedupe = true; break;
      case '--generate': flags.generate = true; break;
      case '--approve-write': flags.approveWrite = true; break;
      case '--provider': flags.provider = argv[i + 1]; i += 1; break;
      case '--mode': flags.mode = argv[i + 1]; i += 1; break;
      case '--machine': flags.machine = argv[i + 1]; i += 1; break;
      case '--workspace': flags.workspace = argv[i + 1]; i += 1; break;
      case '--api-url': flags.apiUrl = argv[i + 1]; i += 1; break;
      case '--canonical-example': flags.canonicalExample = true; break;
      case '--api-key': flags.apiKey = argv[i + 1]; i += 1; break;
      case '--email': flags.email = argv[i + 1]; i += 1; break;
      case '--org': flags.org = argv[i + 1]; i += 1; break;
      case '--org-id': flags.orgId = argv[i + 1]; i += 1; break;
      case '--user-id': flags.userId = argv[i + 1]; i += 1; break;
      case '--owner': flags.owner = argv[i + 1]; i += 1; break;
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
      case '--project': flags.project = argv[i + 1]; i += 1; break;
      case '--contract': flags.contract = true; break;
      case '--source-ref': flags.sourceRef = [...(flags.sourceRef ?? []), argv[i + 1]]; i += 1; break;
      case '--allow-global': flags.allowGlobal = true; break;
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

async function runEventsCommand(argv: string[]): Promise<boolean> {
  if (!EVENTS_COMMANDS.includes(argv[0] ?? '')) return false;
  const eventsProgram = new Command();
  eventsProgram
    .name('knowledge')
    .description('Agent-friendly local knowledge CLI with JSON output, pagination, and safe destructive actions');
  registerEventsCommands(eventsProgram, { source: 'knowledge' });
  await eventsProgram.parseAsync(argv, { from: 'user' });
  return true;
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
  project-panel                Emit Projects dashboard project-panel contract
  paths                        Show resolved workspace/store paths
  setup                        Configure local, hosted, or canonical example S3 mode
  auth login|whoami|logout     Manage hosted API credentials
  storage status|validate|repair-artifact-keys|migrate-legacy-path|import-legacy
                               Inspect, migrate, or repair local/S3 artifact storage metadata
  machines topology|preflight  Inspect optional machine topology/sync readiness
  sync status|doctor|snapshot|conflicts
                               Inspect machine sync readiness, snapshots, conflicts
  db init|stats|storage        Initialize, inspect, or sync local knowledge.db
  wiki init|compile|file-answer|lint
                               Initialize, compile, file, or lint wiki artifacts
  app-wiki init|note|source|search|query
                               Create scoped app/project wiki notes and source refs
  source resolve <source-ref>  Resolve read-only source content and citation evidence
  ingest manifest <file|s3://> Ingest an open-files manifest into knowledge.db
  ingest source <source-ref>   Ingest a read-only source ref into knowledge.db
  ingest rules                 Dry-run/apply global agent rules with provenance
  reindex status|enqueue|embeddings|outbox Inspect/refresh search indexes
  search <query>               Hybrid search sources, wiki pages, indexes, or context
  context pack <query>         Return compact cited JSON under token/item budgets
  proposals context            Return proposal-ready packs from loop/run evidence
  web search <query>           Provider-native web search with citations
  ask|build <prompt>           Build a read-only citation answer/context pack
  embeddings status|index|search Build/query local vector embeddings
  providers status|models|check Inspect AI SDK provider config and credentials
  safety status|check|approve|audit|redact
  events emit|list|replay        Emit, list, and replay Hasna events
  webhooks add|list|remove|test  Manage Hasna event webhook subscriptions
  help [command]               Show help

Global Options:
  --json                      Output JSON
  --verbose                   Show full human-readable details for object output
  --store <path>              Override store path
  --purpose <name>            Read-only source purpose (default: knowledge_answer)
  --model <provider:model>     AI/embedding model ref
  --dimensions <n>             Embedding dimensions for local/fake providers
  --semantic                   Include vector semantic results in search
  --context                    Return a reranked citation context pack for search
  --max-tokens <n>             Token budget for agent context packs
  --max-items <n>              Item budget for agent context packs
  --from search|loops|runs      Context-pack source
  --since <duration|ISO>       Filter run/loop evidence by age, e.g. 7d or 2026-06-23
  --topic <text>               Topic for proposal/loop context packs
  --dedupe                     Include duplicate candidates in proposal packs
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
  --owner <name>               Provenance owner for repository rule docs
  --domain <domain>            Restrict provider web search to a domain
  --file-results               File web snippets as web source refs
  --full                       Force full embedding index rebuild
  --dry-run                   Preview sync writes without changing target state
  --fake                       Use deterministic fake embeddings for local tests
  --no-tailscale               Skip local Tailscale topology probing
  --no-artifact-content        Export sync bundles without embedded artifact bodies
  --scope local|global|project  Store scope (default: global ~/.hasna/knowledge/)
  --tables <names>             Comma-separated knowledge.db sync tables
  --peer-workspace <path>      Peer repo root or .hasna/knowledge path for local sync or remote override
  --project <id>               Project id/name/slug for project-panel output
  --contract                   Emit contract JSON for project-panel output
  --source-ref <uri>           Attach a source ref to an app-wiki note
  --allow-global               Explicitly allow app-wiki writes to global scope
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
  --format json|jsonl         Export full records as JSON or newline-delimited JSON

Prune Options:
  --older-than <days>          Remove items older than N days
  --empty                     Remove items with empty content`);
}

function printCommandHelp(command: string): void {
  if (command === 'add') { console.log('Usage: knowledge add <title> <content> [--url <url>] [-t <tag>] [--json]'); return; }
  if (command === 'list' || command === 'ls') { console.log('Usage: knowledge list|ls [--format table|json] [-p <page>] [-l <limit>] [-s <search>] [-t <tag>] [--sort created|title] [--desc] [--verbose] [--json]'); return; }
  if (command === 'get') { console.log('Usage: knowledge get --id <id> [--json]'); return; }
  if (command === 'update' || command === 'edit') { console.log('Usage: knowledge update|edit --id <id> [--title <title>] [--content <content>] [--url <url>] [-t <tag>] [--json]'); return; }
  if (command === 'archive') { console.log('Usage: knowledge archive --id <id> [--json]'); return; }
  if (command === 'restore' || command === 'unarchive') { console.log('Usage: knowledge restore|unarchive --id <id> [--json]'); return; }
  if (command === 'upsert') { console.log('Usage: knowledge upsert [title] [content] [--id <id>] [--title <title>] [--content <content>] [--url <url>] [-t <tag>] [--json]'); return; }
  if (command === 'untag') { console.log('Usage: knowledge untag --id <id> -t <tag> [--json]'); return; }
  if (command === 'delete' || command === 'rm') { console.log('Usage: knowledge delete|rm --id <id> -y [--json]'); return; }
  if (command === 'export') { console.log('Usage: knowledge export [--verbose] [--json] [--format json|jsonl]'); return; }
  if (command === 'prune') { console.log('Usage: knowledge prune --yes [--older-than <days>] [--empty] [--json]'); return; }
  if (command === 'dedupe') { console.log('Usage: knowledge dedupe --yes [--json]'); return; }
  if (command === 'stats') { console.log('Usage: knowledge stats [--json]'); return; }
  if (command === 'inventory') { console.log('Usage: knowledge inventory [--scope local|global|project] [--limit <n>] [--include-archived] [--verbose] [--json]'); return; }
  if (command === 'project-panel') { console.log('Usage: knowledge project-panel --project <id|name|slug> [--scope project|local|global] [--limit <n>] [--include-archived] [--json|--contract]'); return; }
  if (command === 'paths') { console.log('Usage: knowledge paths [--scope local|global|project] [--verbose] [--json]'); return; }
  if (command === 'setup') { console.log('Usage: knowledge setup --mode local|hosted [--api-url https://...] [--canonical-example] [--scope local|global|project] [--json]'); return; }
  if (command === 'auth') { console.log('Usage: knowledge auth login|whoami|logout [--api-key <key>] [--email <email>] [--org <slug>] [--api-url https://...] [--scope local|global|project] [--json]'); return; }
  if (command === 'storage') { console.log('Usage: knowledge storage status|validate|repair-artifact-keys|migrate-legacy-path [--approve-write --approved-by <name>] [--scope local|global|project] [--json]\n       knowledge storage import-legacy [--dry-run] [--scope global] [--json]'); return; }
  if (command === 'machines') { console.log('Usage: knowledge machines topology [--no-tailscale] | preflight [machine] [--workspace <repo>] [--scope local|global|project] [--verbose] [--json]'); return; }
  if (command === 'sync') { console.log('Usage: knowledge sync status|doctor|readiness|snapshot|machines|conflicts [show|propose|resolve] [id] | dry-run|pull|push|sync|export|import [--peer-workspace <path>] [--machine <ssh-alias>] [--tables <names>] [--dry-run] [--limit <n>] [--approve-write] [--approved-by <name>] [--strategy <name>] [--mode deterministic|ai] [--model <alias|provider:model>] [--fake] [--no-tailscale] [--scope local|global|project] [--verbose] [--json]\n\nRemote machine sync resolves peer paths through @hasna/machines when --peer-workspace is omitted.'); return; }
  if (command === 'db') { console.log('Usage: knowledge db init|stats|storage status [--scope local|global|project] [--json]'); return; }
  if (command === 'wiki') { console.log('Usage: knowledge wiki init|compile|file-answer|lint [query|prompt] [--title <title>] [--content <answer>] [--approve-write] [--limit <n>] [--scope local|global|project] [--json]'); return; }
  if (command === 'app-wiki') { console.log('Usage: knowledge app-wiki init | note add|get|list | source add <source-ref> | search <query> | query <query> [--title <title>] [--content <text>] [--tag <tag>] [--source-ref <uri>] [--scope project|local|global] [--allow-global] [--json]'); return; }
  if (command === 'source') { console.log('Usage: knowledge source resolve <source-ref> [--purpose knowledge_answer|knowledge_index] [--limit <n>] [--scope local|global|project] [--json]'); return; }
  if (command === 'ingest') { console.log('Usage: knowledge ingest manifest <file|s3://bucket/key> | source <source-ref> | rules [--workspace <path>] [--owner <name>] [--dry-run] [--max-items <n>] [--limit <n>] [--purpose knowledge_index] [--scope local|global|project] [--json]'); return; }
  if (command === 'reindex') { console.log('Usage: knowledge reindex status|enqueue|embeddings|outbox [file|s3://bucket/key] [--full] [--fake] [--scope local|global|project] [--json]'); return; }
  if (command === 'search') { console.log('Usage: knowledge search <query> [--context] [--semantic] [--model openai:text-embedding-3-small] [--limit <n>] [--dimensions <n>] [--fake] [--scope local|global|project] [--verbose] [--json]'); return; }
  if (command === 'context') { console.log('Usage: knowledge context pack <query> [--from search|runs|loops] [--max-tokens <n>] [--max-items <n>] [--limit <n>] [--semantic] [--model openai:text-embedding-3-small] [--dimensions <n>] [--fake] [--scope local|global|project] [--verbose] [--json]'); return; }
  if (command === 'proposals') { console.log('Usage: knowledge proposals context --from loops --topic <text> [--since <duration|ISO>] [--dedupe] [--max-tokens <n>] [--max-items <n>] [--scope local|global|project] [--json]'); return; }
  if (command === 'web') { console.log('Usage: knowledge web search <query> [--provider openai|anthropic] [--model provider:model] [--domain <domain>] [--file-results] [--fake] [--scope local|global|project] [--verbose] [--json]'); return; }
  if (command === 'ask' || command === 'build') { console.log('Usage: knowledge ask|build <prompt> [--generate] [--semantic] [--model default|provider:model] [--approve-write] [--scope local|global|project] [--verbose] [--json]'); return; }
  if (command === 'embeddings') { console.log('Usage: knowledge embeddings status|index|search [query] [--model openai:text-embedding-3-small] [--limit <n>] [--dimensions <n>] [--fake] [--scope local|global|project] [--verbose] [--json]'); return; }
  if (command === 'providers') { console.log('Usage: knowledge providers status|models|check [provider|model-alias] [--scope local|global|project] [--json]'); return; }
  if (command === 'safety') { console.log('Usage: knowledge safety status|check|approve|audit|redact [args] [--scope local|global|project] [--json]'); return; }
  if (command === 'events') { console.log('Usage: knowledge events emit|list|replay [args] [--json]'); return; }
  if (command === 'webhooks') { console.log('Usage: knowledge webhooks add|list|remove|test [args] [--json]'); return; }
  printGlobalHelp();
}

function useColor(flags: Flags): boolean {
  if (flags.noColor || process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR) return true;
  return process.stdout.isTTY === true;
}

function output(data: unknown, asJson?: boolean, flags?: Flags): void {
  if (asJson) { console.log(JSON.stringify(data, null, 2)); return; }
  if (typeof data === 'string') { console.log(data); return; }
  if (flags?.verbose) { console.log(JSON.stringify(data, null, 2)); return; }
  const message = (data as { message?: string }).message;
  console.log(message ? `${message}\n${detailHint()}` : compactObjectFallback(data));
}

function detailHint(details = 'full details'): string {
  return `Hint: use --verbose for ${details}, or --json for machine-readable output.`;
}

function truncate(value: unknown, max = 120): string {
  const text = value === null || value === undefined ? '' : String(value).replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 3))}...`;
}

function compactObjectFallback(data: unknown): string {
  if (!data || typeof data !== 'object') return String(data);
  const record = data as Record<string, any>;
  const lines = [record.ok === false ? 'Result: not ok' : 'Result: ok'];
  for (const [key, value] of Object.entries(record).slice(0, 8)) {
    if (key === 'ok' || key === 'message') continue;
    if (Array.isArray(value)) lines.push(`${key}: ${value.length} item(s)`);
    else if (value && typeof value === 'object') lines.push(`${key}: ${Object.keys(value).length} field(s)`);
    else lines.push(`${key}: ${truncate(value, 100)}`);
  }
  lines.push(detailHint());
  return lines.join('\n');
}

function formatPaths(paths: Record<string, any>): string {
  return [
    `Knowledge paths (${paths.scope})`,
    `Home: ${paths.home}`,
    `SQLite: ${paths.knowledge_db_path}`,
    `JSON store: ${paths.json_store_path}`,
    `Wiki: ${paths.wiki_dir}`,
    detailHint('config and all paths'),
  ].join('\n');
}

function outputCompactJson(data: unknown): void {
  console.log(JSON.stringify(data));
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

function formatSearchResults(result: Record<string, any>): string {
  const rows = Array.isArray(result.results) ? result.results : [];
  const lines = [
    `${rows.length} search result(s) for "${truncate(result.query, 80)}"${result.mode?.semantic ? ' (semantic enabled)' : ''}`,
  ];
  for (const row of rows.slice(0, result.limit ?? 10)) {
    const source = row.source?.uri ?? row.provenance?.source_uri ?? row.artifact?.path ?? row.artifact?.uri ?? row.id;
    const score = typeof row.score === 'number' ? ` score=${row.score.toFixed(3)}` : '';
    lines.push(`- ${row.kind ?? 'result'} ${truncate(row.title ?? row.id, 80)}${score}`);
    if (source) lines.push(`  source: ${truncate(source, 120)}`);
    if (row.text) lines.push(`  text: ${truncate(row.text, 180)}`);
  }
  if (rows.length === 0) lines.push('- No matches. Try a broader query or run `knowledge inventory --scope project`.');
  lines.push(detailHint('scores, provenance, and full result objects'));
  if (!result.context) lines.push('Next: use --context for an agent-ready citation pack, or --limit <n> to change the result count.');
  return lines.join('\n');
}

function formatContextPack(context: Record<string, any>): string {
  const excerpts = Array.isArray(context.excerpts) ? context.excerpts : [];
  const citations = Array.isArray(context.citations) ? context.citations : [];
  const lines = [
    `${excerpts.length} context excerpt(s) for "${truncate(context.query ?? context.normalized_query, 80)}"`,
  ];
  for (const excerpt of excerpts.slice(0, 10)) {
    const citation = citations.find((entry: any) => entry.id === excerpt.citation_id || entry.result_id === excerpt.result_id);
    const source = citation?.source_uri ?? citation?.artifact_path ?? excerpt.result_id;
    const score = typeof excerpt.score === 'number' ? ` score=${excerpt.score.toFixed(3)}` : '';
    lines.push(`- ${excerpt.kind ?? 'excerpt'} ${truncate(excerpt.id, 44)}${score}`);
    if (source) lines.push(`  source: ${truncate(source, 120)}`);
    lines.push(`  text: ${truncate(excerpt.text, 220)}`);
  }
  lines.push(`Citations: ${citations.length}`);
  lines.push(detailHint('citations, graph, notes, and full excerpts'));
  return lines.join('\n');
}

function formatSemanticResults(result: Record<string, any>): string {
  const rows = Array.isArray(result.results) ? result.results : [];
  const lines = [
    `${rows.length} semantic result(s) for "${truncate(result.query, 80)}"`,
    `Index: ${result.provider ?? 'unknown'}:${result.model ?? 'unknown'} (${result.dimensions ?? '?'} dimensions)`,
  ];
  for (const row of rows.slice(0, result.limit ?? 10)) {
    const score = typeof row.score === 'number' ? ` score=${row.score.toFixed(3)}` : '';
    lines.push(`- ${truncate(row.chunk_id, 44)}${score}`);
    if (row.source_uri) lines.push(`  source: ${truncate(row.source_uri, 120)}`);
    if (row.text) lines.push(`  text: ${truncate(row.text, 180)}`);
  }
  lines.push(detailHint('provenance and full vector result objects'));
  return lines.join('\n');
}

function formatWebSearch(result: Record<string, any>): string {
  const sources = Array.isArray(result.sources) ? result.sources : [];
  const lines = [
    `${sources.length} web source(s) for "${truncate(result.query, 80)}"`,
    `Provider: ${result.provider ?? 'unknown'}${result.model ? ` (${result.model})` : ''}`,
  ];
  for (const source of sources.slice(0, result.limit ?? 10)) {
    lines.push(`- ${truncate(source.title ?? source.url ?? source.uri ?? 'source', 100)}`);
    const uri = source.url ?? source.uri ?? source.source_ref;
    if (uri) lines.push(`  url: ${truncate(uri, 140)}`);
    if (source.snippet) lines.push(`  snippet: ${truncate(source.snippet, 180)}`);
  }
  lines.push(detailHint('provider payloads and filed source refs'));
  return lines.join('\n');
}

function formatMachineTopology(topology: Record<string, any>): string {
  const machines = Array.isArray(topology.machines) ? topology.machines : [];
  const lines = [
    `${machines.length} machine(s) discovered via ${topology.source ?? 'unknown'}`,
    `Adapter: ${topology.adapter?.package ?? '@hasna/machines'} ${topology.adapter?.available ? 'available' : 'unavailable'}`,
  ];
  for (const machine of machines.slice(0, 10)) {
    const local = machine.local ? ' local' : '';
    const target = machine.tailscale_dns ?? machine.ssh_target ?? machine.hostname ?? '';
    lines.push(`- ${truncate(machine.machine_id ?? machine.id ?? 'unknown', 48)}${local}${target ? ` -> ${truncate(target, 80)}` : ''}`);
  }
  if (machines.length > 10) lines.push(`... ${machines.length - 10} more machine(s).`);
  if (Array.isArray(topology.warnings) && topology.warnings.length > 0) lines.push(`Warnings: ${topology.warnings.slice(0, 3).join('; ')}`);
  lines.push(detailHint('full topology, route hints, and adapter evidence'));
  return lines.join('\n');
}

function formatMachinePreflight(preflight: Record<string, any>): string {
  const checks = Array.isArray(preflight.checks) ? preflight.checks : [];
  const failed = checks.filter((check: any) => check.status === 'fail' || check.severity === 'fail');
  const warnings = checks.filter((check: any) => check.status === 'warn' || check.severity === 'warn');
  const lines = [
    `Machine preflight ${preflight.ok ? 'passed' : 'needs attention'} for ${preflight.machine_id ?? preflight.requested_machine_id ?? 'local'}`,
    `Checks: ${checks.length} total, ${failed.length} failed, ${warnings.length} warning(s)`,
  ];
  for (const check of [...failed, ...warnings].slice(0, 8)) {
    lines.push(`- ${check.status ?? check.severity ?? 'check'} ${truncate(check.id ?? check.kind ?? 'check', 72)}: ${truncate(check.message ?? check.detail ?? '', 140)}`);
  }
  lines.push(detailHint('all checks and repair hints'));
  return lines.join('\n');
}

function formatSyncStatus(status: Record<string, any>): string {
  const lines = [
    `Sync status (${status.scope ?? 'scope'})`,
    `Schema: v${status.sqlite_schema_version ?? 'unknown'}`,
    `Machines: ${status.machines?.total ?? 0}; snapshots: ${status.snapshots?.total ?? 0}; open conflicts: ${status.conflicts?.open ?? 0}`,
    `Tables: ${Object.entries(status.table_counts ?? {}).slice(0, 8).map(([table, count]) => `${table}=${count}`).join(', ') || 'none'}`,
    detailHint('registry rows, clocks, snapshots, imports, and conflicts'),
  ];
  return lines.join('\n');
}

function formatSyncDoctor(doctor: Record<string, any>): string {
  const warnings = Array.isArray(doctor.warnings) ? doctor.warnings : [];
  const commands = Array.isArray(doctor.recommended_commands) ? doctor.recommended_commands : [];
  const lines = [
    doctor.message ?? `Sync readiness ${doctor.ok ? 'ok' : 'needs attention'}`,
    `Storage: ${doctor.storage?.validation?.ok ? 'ok' : 'needs attention'}; open-files: ${doctor.open_files?.ok ? 'ok' : 'needs attention'}; open conflicts: ${doctor.sync?.open_conflicts ?? 0}`,
  ];
  if (warnings.length > 0) lines.push(`Warnings: ${warnings.slice(0, 5).join('; ')}`);
  for (const command of commands.slice(0, 5)) {
    lines.push(`- next: ${truncate(command.shell_command ?? command.command?.join(' ') ?? command.id, 160)}`);
  }
  lines.push(detailHint('diagnostics, route evidence, and all recommended commands'));
  return lines.join('\n');
}

function formatSyncSnapshot(snapshot: Record<string, any>): string {
  const snap = snapshot.snapshot ?? {};
  return [
    `Sync snapshot ${snapshot.ok ? 'recorded' : 'failed'}`,
    `Snapshot: ${truncate(snap.id ?? snap.snapshot_id ?? 'unknown', 80)} ${snap.content_hash ? `(${truncate(snap.content_hash, 80)})` : ''}`,
    `Machines upserted: ${snapshot.machines_upserted ?? 0}; machine: ${snapshot.machine_id ?? snap.machine_id ?? 'unknown'}`,
    detailHint('snapshot payload and topology evidence'),
  ].join('\n');
}

function formatSyncConflicts(result: Record<string, any>): string {
  const conflicts = Array.isArray(result.conflicts) ? result.conflicts : [];
  const lines = [`${conflicts.length} sync conflict(s)`];
  for (const conflict of conflicts.slice(0, 10)) {
    lines.push(`- ${truncate(conflict.id, 48)} ${conflict.status ?? 'unknown'} ${conflict.entity_kind ?? ''}/${truncate(conflict.entity_id, 80)}`);
  }
  lines.push('Next: use `knowledge sync conflicts show <id> --json` for one conflict.');
  lines.push(detailHint('full conflict objects'));
  return lines.join('\n');
}

function formatSyncMachines(result: Record<string, any>): string {
  const machines = Array.isArray(result.machines) ? result.machines : [];
  const lines = [`${machines.length} registered sync machine(s)`];
  for (const machine of machines.slice(0, 10)) {
    lines.push(`- ${truncate(machine.machine_id, 48)} ${truncate(machine.hostname ?? machine.workspace_home ?? '', 100)}`);
  }
  lines.push(detailHint('machine registry rows'));
  return lines.join('\n');
}

function formatSyncOperation(result: Record<string, any>, action: string): string {
  const lines = [
    `Sync ${action} ${result.ok === false ? 'needs attention' : 'completed'}${result.dry_run ? ' (dry run)' : ''}`,
  ];
  const summarizeDirection = (name: string, value: any) => {
    if (!value) return;
    const tables = Array.isArray(value.tables) ? value.tables : [];
    const tableWrites = tables.reduce((sum: number, table: any) => sum + (table.inserted ?? 0) + (table.updated ?? 0) + (table.deleted ?? 0), 0);
    const artifactCopied = value.artifacts?.copied ?? 0;
    const errors = Array.isArray(value.errors) ? value.errors.length : 0;
    lines.push(`${name}: ${tableWrites} table row change(s), ${artifactCopied} artifact(s), ${errors} error(s)`);
  };
  summarizeDirection('pull', result.pull);
  summarizeDirection('push', result.push);
  if (Array.isArray(result.errors) && result.errors.length > 0) lines.push(`Errors: ${result.errors.slice(0, 3).map((error: any) => truncate(error, 120)).join('; ')}`);
  lines.push(detailHint('per-table rows, artifacts, clocks, and errors'));
  return lines.join('\n');
}

function formatPromptResult(result: Record<string, any>): string {
  const citations = Array.isArray(result.citations) ? result.citations : [];
  const excerpts = Array.isArray(result.context?.excerpts) ? result.context.excerpts : Array.isArray(result.excerpts) ? result.excerpts : [];
  const lines = [
    result.generated ? 'Generated answer with citations' : 'Prepared citation context draft',
    `Citations: ${citations.length}; excerpts: ${excerpts.length}`,
  ];
  if (result.answer) lines.push(`Answer: ${truncate(result.answer, 500)}`);
  for (const citation of citations.slice(0, 5)) {
    lines.push(`- ${truncate(citation.source_uri ?? citation.ref ?? citation.id, 120)}`);
  }
  lines.push(detailHint('full answer payload, context, citations, and run ledger'));
  return lines.join('\n');
}

function formatExportSummary(items: KnowledgeItem[], format: string): string {
  return [
    `Export preview: ${items.length} item(s) available`,
    `Default output is compact to avoid terminal/context bloat.`,
    `Use --verbose or --json for a JSON object, or --format jsonl for newline-delimited records.`,
    format !== 'json' ? `Requested format: ${format}` : '',
  ].filter(Boolean).join('\n');
}

function machineIsLocal(machine: string | undefined): boolean {
  return !machine || machine === 'local' || machine === 'localhost';
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
  if (await runEventsCommand(argv)) return;

  const { positional, flags } = parseArgs(argv);
  log('debug', 'CLI invoked', { command: positional[0], flags: { json: flags.json, store: flags.store } });

  if (flags.version) {
    console.log(flags.json ? JSON.stringify({ name: pkg.name, version: pkg.version }, null, 2) : `${pkg.name} ${pkg.version}`);
    return;
  }

  if (flags.completions) {
    const shell = flags.completions;
    if (shell === 'bash') {
    console.log(`_knowledge() { local cur; cur="${"$"}{COMP_WORDS[COMP_CWORD]}"; COMPREPLY=($(compgen -W "add list get update archive restore upsert untag delete export prune dedupe stats inventory project-panel paths setup auth storage machines sync db wiki app-wiki source ingest reindex search context proposals web ask build embeddings providers safety events webhooks help ls rm edit unarchive --json --verbose --yes --help --version --desc --page --limit --search --sort --id --store --title --content --url --tag --format --completions --purpose --model --dimensions --semantic --context --max-tokens --max-items --from --since --topic --dedupe --generate --approve-write --provider --mode --machine --workspace --peer-workspace --api-url --canonical-example --api-key --email --org --org-id --user-id --owner --domain --file-results --full --dry-run --fake --no-tailscale --no-artifact-content --no-color --scope --tables --archived --include-archived --project --contract --source-ref --allow-global" -- "$cur")); }; complete -F _knowledge knowledge`);
    } else if (shell === 'zsh') {
      console.log(`#compdef knowledge\n_knowledge() { _arguments -C "1: :(add list get update archive restore upsert untag delete export prune dedupe stats inventory project-panel paths setup auth storage machines sync db wiki app-wiki source ingest reindex search context proposals web ask build embeddings providers safety events webhooks help ls rm edit unarchive)" "(--json)--json" "(--verbose)--verbose" "(--yes)-y" "(--help)--help" "(--version)--version" "(--desc)--desc" "(--archived)--archived" "(--include-archived)--include-archived" "(--semantic)--semantic" "(--context)--context" "(--dedupe)--dedupe" "(--generate)--generate" "(--approve-write)--approve-write" "(--canonical-example)--canonical-example" "(--file-results)--file-results" "(--full)--full" "(--dry-run)--dry-run" "(--fake)--fake" "(--no-tailscale)--no-tailscale" "(--no-artifact-content)--no-artifact-content" "(--contract)--contract" "(--allow-global)--allow-global" "(-p --page)"{-p,--page}"[page number]:number:" "(-l --limit)"{-l,--limit}"[items per page]:number:" "(-s --search)"{-s,--search}"[search text]:text:" "(--sort)--sort"\{created,title\}:" "(--id)--id[item id]:id:" "(--store)--store[store path]:path:" "(--title)--title[new title]:" "(--content)--content[new content]:" "(--url)--url[source url]:" "(-t --tag)"{-t,--tag}"[tag]:tag:" "(--format)--format[json|jsonl]:" "(--completions)--completions[output completions]:shell:(bash zsh fish):" "(--purpose)--purpose[purpose]:" "(--model)--model[model ref]:" "(--dimensions)--dimensions[embedding dimensions]:number:" "(--max-tokens)--max-tokens[token budget]:number:" "(--max-items)--max-items[item budget]:number:" "(--from)--from"\{search,loops,runs\}:" "(--since)--since[duration or ISO time]:" "(--topic)--topic[topic text]:" "(--provider)--provider[provider]:" "(--mode)--mode"\{local,hosted\}:" "(--machine)--machine[machine id or SSH alias]:" "(--workspace)--workspace[repo workspace path]:path:" "(--peer-workspace)--peer-workspace[peer repo or knowledge home path]:path:" "(--api-url)--api-url[hosted API URL]:" "(--api-key)--api-key[hosted API key]:" "(--email)--email[email]:" "(--org)--org[org slug]:" "(--org-id)--org-id[org id]:" "(--user-id)--user-id[user id]:" "(--owner)--owner[provenance owner]:" "(--domain)--domain[domain]:" "(--project)--project[project id/name/slug]:" "(--source-ref)--source-ref[source ref]:" "(--no-color)--no-color[disable color]" "(--scope)--scope"\{local,global,project\}:" "(--tables)--tables[comma-separated DB sync tables]:" }; _knowledge`);
    } else if (shell === 'fish') {
      console.log(`complete -c knowledge -f; complete -c knowledge -a "add list get update archive restore upsert untag delete export prune dedupe stats inventory project-panel paths setup auth storage machines sync db wiki app-wiki source ingest reindex search context proposals web ask build embeddings providers safety events webhooks help ls rm edit unarchive"; complete -c knowledge -l json; complete -c knowledge -l verbose; complete -c knowledge -l yes -s y; complete -c knowledge -l help -s h; complete -c knowledge -l version -s v; complete -c knowledge -l desc; complete -c knowledge -l archived; complete -c knowledge -l include-archived; complete -c knowledge -l semantic; complete -c knowledge -l context; complete -c knowledge -l max-tokens; complete -c knowledge -l max-items; complete -c knowledge -l from -a "search loops runs"; complete -c knowledge -l since; complete -c knowledge -l topic; complete -c knowledge -l dedupe; complete -c knowledge -l generate; complete -c knowledge -l approve-write; complete -c knowledge -l allow-global; complete -c knowledge -l canonical-example; complete -c knowledge -l provider; complete -c knowledge -l mode; complete -c knowledge -l machine; complete -c knowledge -l workspace; complete -c knowledge -l peer-workspace; complete -c knowledge -l api-url; complete -c knowledge -l api-key; complete -c knowledge -l email; complete -c knowledge -l org; complete -c knowledge -l org-id; complete -c knowledge -l user-id; complete -c knowledge -l owner; complete -c knowledge -l domain; complete -c knowledge -l project; complete -c knowledge -l contract; complete -c knowledge -l source-ref; complete -c knowledge -l file-results; complete -c knowledge -l full; complete -c knowledge -l dry-run; complete -c knowledge -l fake; complete -c knowledge -l no-tailscale; complete -c knowledge -l no-artifact-content; complete -c knowledge -s p -l page; complete -c knowledge -s l -l limit; complete -c knowledge -s s -l search; complete -c knowledge -l sort; complete -c knowledge -l id; complete -c knowledge -l store; complete -c knowledge -l title; complete -c knowledge -l content; complete -c knowledge -l url; complete -c knowledge -s t -l tag; complete -c knowledge -l format; complete -c knowledge -l completions; complete -c knowledge -l purpose; complete -c knowledge -l model; complete -c knowledge -l dimensions; complete -c knowledge -l no-color; complete -c knowledge -l scope -a "local global project"; complete -c knowledge -l tables`);
    } else {
      throw new Error("Invalid --completions value. Use 'bash', 'zsh', or 'fish'.");
    }
    return;
  }

  let command = resolveCommand(positional[0]);
  let commandArgOffset = 1;
  // Natural-language shorthand: when invoked as the `knowledge` bin, a multi-word prompt
  // is treated as `knowledge ask <prompt>` — whether passed as separate words
  // (`knowledge how do I cite the handbook`, multiple positionals) or as a single quoted
  // string (`knowledge "How do we cite the handbook?"`, one positional containing spaces;
  // the canonical documented form). A single bare token with no whitespace is almost always
  // a mistyped command (`knowledge lst`, `knowledge boguscmd`), so it is NOT remapped — it
  // falls through to the unknown-command handler below and exits non-zero, instead of
  // silently running an ask/build search and returning false success to scripts.
  const looksLikeNaturalLanguage = positional.length > 1 || /\s/.test(command);
  if (invokedAsKnowledge() && command && !COMMANDS.includes(command) && looksLikeNaturalLanguage) {
    command = 'ask';
    commandArgOffset = 0;
  }

  if (!command || flags.help || command === 'help') {
    // `help <sub>` names its target as positional[1]; `<sub> --help` / `<sub> -h`
    // names it as the resolved command itself. Bare `--help`/`help` (no command)
    // falls through to the global help.
    const helpTarget = command === 'help' ? positional[1] : (command || positional[1]);
    printCommandHelp(helpTarget);
    return;
  }

  const serviceScope = command === 'project-panel' || command === 'app-wiki' ? (flags.scope ?? 'project') : flags.scope;
  const service = createKnowledgeService({ scope: serviceScope });
  if (command === 'storage') {
    const storageAction = positional[1] ?? 'status';
    if (storageAction === 'import-legacy') {
      if (flags.scope && flags.scope !== 'global') {
        throw new Error('knowledge storage import-legacy only supports --scope global because ~/.open-knowledge is a global legacy store.');
      }
      const migration = importLegacyGlobalStore({ dryRun: flags.dryRun });
      output(migration, flags.json);
      if (!migration.ok) process.exitCode = 1;
      return;
    }
    if (storageAction === 'migrate-legacy-path' || storageAction === 'migrate-legacy' || storageAction === 'migrate-path') {
      const migration = service.migrateLegacyPath({
        approveWrite: flags.approveWrite,
        approvedBy: flags.approvedBy,
      });
      output(migration, flags.json);
      if (!migration.ok && !flags.json) process.exitCode = 1;
      return;
    }
  }
  const storePathOverridden = Boolean(flags.store);
  let storePath = flags.store;
  if (!storePath) {
    if (serviceScope === 'project' || serviceScope === 'local') {
      storePath = service.workspace.jsonStorePath;
    } else {
      storePath = defaultStorePath();
    }
  }
  // ask/build seed a local JSON store only in local mode. In cloud/api mode the
  // prompt flow runs over the shared cloud item corpus, so touching a local file
  // here would be an unnecessary local-side write while the flip is active.
  if (!storePathOverridden && (command === 'ask' || command === 'build') && !isKnowledgeApiMode()) {
    ensureStore(storePath);
  }

  // Single knowledge-item Store abstraction. When the client-flip resolves to
  // the cloud HTTP transport (HASNA_KNOWLEDGE_API_URL + HASNA_KNOWLEDGE_API_KEY,
  // and/or *_STORAGE_MODE) ALL item reads/writes go to the configured API's /v1
  // with the bearer key; otherwise the on-box JSON store. An explicit --store
  // override always pins to the local transport (fully reversible). Every item
  // command below routes through `itemStore` — never the JSON file or HTTP
  // client directly.
  const itemStore: ItemStore = resolveItemStore({ storePath, storePathOverridden });

  if (command === 'inventory') {
    // Single dispatch shared with the MCP + SDK: the shared cloud item corpus in
    // api mode (routes through the cloud transport), otherwise the full local
    // inventory across json + sqlite. No surface reads a divergent store.
    const inventory = await service.resolveInventory({
      limit: flags.limit,
      includeArchived: flags.includeArchived || flags.archived,
      storePath: isKnowledgeApiMode() ? undefined : storePath,
    });
    output(flags.json || flags.verbose ? inventory : formatInventory(inventory), flags.json, flags);
    return;
  }

  if (command === 'project-panel') {
    const projectRef = flags.project ?? positional[1];
    if (!projectRef) throw new Error('Usage: knowledge project-panel --project <id|name|slug> [--json|--contract]');
    const panel = await createKnowledgeProjectPanel(projectRef, {
      service,
      limit: flags.limit,
      storePath: isKnowledgeApiMode() ? undefined : storePath,
      includeArchived: flags.includeArchived || flags.archived,
    });
    output(flags.json || flags.contract ? panel : formatKnowledgeProjectPanel(panel), flags.json || flags.contract);
    return;
  }

  if (command === 'paths') {
    const paths = service.paths();
    output(flags.json || flags.verbose ? paths : formatPaths(paths), flags.json, flags);
    return;
  }

  if (command === 'setup') {
    const result = service.setup({
      mode: flags.mode,
      apiUrl: flags.apiUrl,
      canonicalExample: flags.canonicalExample,
    });
    output(result, flags.json, flags);
    return;
  }

  if (command === 'auth') {
    const action = positional[1] ?? 'whoami';
    if (action === 'whoami' || action === 'status') {
      const result = service.authStatus(process.env);
      output({ ok: true, ...result, message: result.authenticated ? `Authenticated via ${result.source}` : 'Not authenticated' }, flags.json, flags);
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
      }, flags.json, flags);
      return;
    }
    if (action === 'logout') {
      const removed = service.clearAuth(process.env);
      output({ ok: true, removed, message: removed ? 'Removed hosted credentials' : 'No hosted credentials found' }, flags.json, flags);
      return;
    }
    throw new Error("Invalid auth action. Use 'login', 'whoami', or 'logout'.");
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
      }, flags.json, flags);
      return;
    }
    if (action === 'validate') {
      const validation = service.validateStorage();
      output({
        ok: validation.ok,
        validation,
        message: validation.ok ? 'Storage contract valid' : `Storage contract invalid: ${validation.errors.join('; ')}`,
      }, flags.json, flags);
      if (!validation.ok) process.exitCode = 1;
      return;
    }
    if (action === 'repair-artifact-keys' || action === 'repair-keys') {
      const repair = service.repairArtifactManifestKeys({
        approveWrite: flags.approveWrite,
        approvedBy: flags.approvedBy,
        dryRun: flags.dryRun,
      });
      output(repair, flags.json, flags);
      return;
    }
    if (action === 'migrate-legacy-path' || action === 'migrate-legacy' || action === 'migrate-path') {
      const migration = service.migrateLegacyPath({
        approveWrite: flags.approveWrite,
        approvedBy: flags.approvedBy,
      });
      output(migration, flags.json);
      if (!migration.ok && !flags.json) process.exitCode = 1;
      return;
    }
    throw new Error("Invalid storage action. Use 'status', 'validate', 'repair-artifact-keys', 'migrate-legacy-path', or 'import-legacy'.");
  }

  if (command === 'machines') {
    const action = positional[1] ?? 'topology';
    if (action === 'topology' || action === 'status') {
      const topology = await service.machineTopology({
        includeTailscale: flags.tailscale !== false,
      });
      output(flags.json || flags.verbose ? topology : formatMachineTopology(topology), flags.json, flags);
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
      output(flags.json || flags.verbose ? preflight : formatMachinePreflight(preflight), flags.json, flags);
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
      output(flags.json || flags.verbose ? status : formatSyncStatus(status), flags.json, flags);
      return;
    }
    if (action === 'doctor' || action === 'readiness' || action === 'preflight') {
      const doctor = await service.syncDoctor({
        machine: flags.machine ?? null,
        peerWorkspace: flags.peerWorkspace ?? null,
        includeTailscale: flags.tailscale !== false,
        tables,
      });
      const doctorResult = {
        package: { name: pkg.name, version: pkg.version },
        ...doctor,
      };
      output(flags.json || flags.verbose ? doctorResult : formatSyncDoctor(doctorResult), flags.json, flags);
      if (!doctor.ok && !flags.json) process.exitCode = 1;
      return;
    }
    if (action === 'snapshot' || action === 'record') {
      const snapshot = await service.createSyncSnapshot({
        includeTailscale: flags.tailscale !== false,
        machineId: flags.machine,
      });
      output(flags.json || flags.verbose ? snapshot : formatSyncSnapshot(snapshot), flags.json, flags);
      return;
    }
    if (action === 'conflicts' || action === 'conflict') {
      const conflictAction = positional[2];
      if (conflictAction === 'show' || conflictAction === 'get') {
        const id = positional[3] ?? flags.id;
        if (!id) throw new Error('Usage: knowledge sync conflicts show <id>');
        const conflict = service.syncConflict(id);
        output({ ok: true, conflict, message: `Sync conflict ${id}` }, flags.json, flags);
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
          : service.proposeSyncConflictResolution(id), flags.json, flags);
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
        output(result, flags.json, flags);
        if (!result.ok && !flags.json) process.exitCode = 1;
        return;
      }
      const conflicts = service.syncConflicts({
        status: conflictAction,
        limit: flags.limit,
      });
      const conflictsResult = {
        ok: true,
        conflicts,
        message: `${conflicts.length} sync conflict(s)`,
      };
      output(flags.json || flags.verbose ? conflictsResult : formatSyncConflicts(conflictsResult), flags.json, flags);
      return;
    }
    if (action === 'machines' || action === 'registry') {
      const machines = service.syncMachines();
      const machinesResult = {
        ok: true,
        machines,
        message: `${machines.length} registered sync machine(s)`,
      };
      output(flags.json || flags.verbose ? machinesResult : formatSyncMachines(machinesResult), flags.json, flags);
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
      output(flags.json || flags.verbose ? result : formatSyncOperation(result, action), flags.json, flags);
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
      output(flags.json || flags.verbose ? result : formatSyncOperation(result, action), flags.json, flags);
      if (!result.ok && !flags.json) process.exitCode = 1;
      return;
    }
    throw new Error("Invalid sync action. Use 'status', 'doctor', 'snapshot', 'conflicts', 'machines', 'dry-run', 'pull', 'push', 'sync', 'export', or 'import'.");
  }

  if (command === 'db') {
    const action = positional[1] ?? 'init';
    if (action === 'init') {
      const result = service.initDb();
      output({ ok: true, ...result, message: `Initialized ${result.path}` }, flags.json, flags);
      return;
    }
    if (action === 'stats') {
      const stats = service.dbStats();
      output({ ok: true, path: service.workspace.knowledgeDbPath, ...stats, message: `knowledge.db schema v${stats.schema_version}` }, flags.json, flags);
      return;
    }
    if (action === 'storage') {
      const storageAction = positional[2] ?? 'status';
      if (storageAction === 'status') {
        const status = getDatabaseStorageStatus({ scope: flags.scope });
        output({
          ok: true,
          ...status,
          message: `knowledge.db storage mode ${status.mode}${status.activeEnv ? ` via ${status.activeEnv}` : ''}`,
        }, flags.json, flags);
        return;
      }
      // The client-side Postgres sync engine (push/pull/sync) was removed: it was
      // a forbidden DSN-on-client path. The shared store is reached through the
      // HTTP ApiStore (knowledge items) — not by syncing local sqlite to RDS.
      throw new Error(
        "Invalid db storage action. Only 'status' is supported. The 'push'/'pull'/'sync' "
          + 'Postgres sync commands were removed (DSN-on-client is forbidden); use the cloud API flip instead.',
      );
    }
    throw new Error("Invalid db action. Use 'init', 'stats', or 'storage'.");
  }

  if (command === 'app-wiki') {
    const action = positional[1] ?? 'init';
    if (action === 'paths' || action === 'status') {
      output({
        ok: true,
        standard: 'hasna-app-wiki.v1',
        default_scope: 'project',
        global_writes_require: '--allow-global',
        ...service.paths(),
      }, flags.json);
      return;
    }
    if (action === 'init' || action === 'open') {
      const result = await service.initAppWiki({
        allowGlobal: flags.allowGlobal,
      });
      output(result, flags.json);
      return;
    }
    if (action === 'note' || action === 'notes') {
      const noteAction = positional[2] ?? 'list';
      if (noteAction === 'add' || noteAction === 'create') {
        const title = flags.title ?? positional[3];
        const content = flags.content ?? positional.slice(4).join(' ');
        if (!title || !content) throw new Error('Usage: knowledge app-wiki note add --title <title> --content <text> [--source-ref <uri>]');
        const result = await service.addAppWikiNote({
          title,
          content,
          tags: flags.tag ? [flags.tag] : undefined,
          sourceRefs: flags.sourceRef,
          allowGlobal: flags.allowGlobal,
        });
        output(result, flags.json);
        return;
      }
      if (noteAction === 'list' || noteAction === 'ls') {
        const notes = service.listAppWikiNotes({ limit: flags.limit });
        output({
          ok: true,
          scope: service.scope,
          home: service.workspace.home,
          notes,
          message: `${notes.length} app wiki note(s)`,
        }, flags.json);
        return;
      }
      if (noteAction === 'get' || noteAction === 'show') {
        const id = positional[3] ?? flags.id;
        if (!id) throw new Error('Usage: knowledge app-wiki note get <id-or-path>');
        const note = await service.getAppWikiNote(id, { includeContent: true });
        if (!note) throw new Error(`App wiki note not found: ${id}`);
        output(note, flags.json);
        return;
      }
      throw new Error("Invalid app-wiki note action. Use 'add', 'list', or 'get'.");
    }
    if (action === 'source' || action === 'sources') {
      const sourceAction = positional[2] ?? 'add';
      if (sourceAction !== 'add' && sourceAction !== 'ingest') {
        throw new Error("Invalid app-wiki source action. Use 'add'.");
      }
      const sourceRef = positional[3] ?? flags.sourceRef?.[0];
      if (!sourceRef) throw new Error('Usage: knowledge app-wiki source add <source-ref>');
      const result = await service.addAppWikiSourceRef({
        sourceRef,
        purpose: flags.purpose,
        allowGlobal: flags.allowGlobal,
      });
      output({ ok: true, ...result, message: `Added app wiki source ${result.source_ref}` }, flags.json);
      return;
    }
    if (action === 'search') {
      const query = positional.slice(2).join(' ');
      if (!query) throw new Error('Usage: knowledge app-wiki search <query>');
      const result = await service.searchAppWiki({
        query,
        limit: flags.limit,
        semantic: flags.semantic,
        modelRef: flags.model,
        dimensions: flags.dimensions,
        fake: flags.fake,
      });
      output({ ok: true, ...result, message: `${result.results.length} app wiki result(s)` }, flags.json);
      return;
    }
    if (action === 'query' || action === 'context') {
      const query = positional.slice(2).join(' ');
      if (!query) throw new Error('Usage: knowledge app-wiki query <query>');
      const result = await service.queryAppWiki({
        query,
        limit: flags.limit,
        semantic: flags.semantic,
        modelRef: flags.model,
        dimensions: flags.dimensions,
        fake: flags.fake,
      });
      output({ ok: true, ...result, message: `${result.excerpts.length} app wiki excerpt(s)` }, flags.json);
      return;
    }
    throw new Error("Invalid app-wiki action. Use 'init', 'paths', 'note', 'source', 'search', or 'query'.");
  }

  if (command === 'wiki') {
    const action = positional[1] ?? 'init';
    if (action === 'init') {
      const result = await service.initWiki();
      output({ ok: true, ...result, message: `Initialized wiki layout in ${service.workspace.home}` }, flags.json, flags);
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
      output({ ok: true, ...result, message: `Compiled wiki page ${result.path}` }, flags.json, flags);
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
      output({ ok: true, ...result }, flags.json, flags);
      return;
    }
    if (action === 'lint') {
      const result = service.lintWiki();
      output({ ok: result.ok, ...result, message: result.ok ? 'Wiki lint passed' : `Wiki lint found ${result.issue_count} issue(s)` }, flags.json, flags);
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
        }, flags.json, flags);
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
          output({ ok: true, ...decision, message: `Safety check ${decision.decision}` }, flags.json, flags);
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
        output({ ok: true, ...approval, action: approveAction, target_uri: target, message: `Approved ${approveAction}` }, flags.json, flags);
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
        output({ ok: true, events: rows, message: `${rows.length} audit event(s)` }, flags.json, flags);
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
        output({ ok: true, text: result.text, findings: result.findings, message: `Redacted ${result.findings.length} finding(s)` }, flags.json, flags);
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
    }, flags.json, flags);
    return;
  }

  if (command === 'ingest') {
    const action = positional[1] ?? '';
    if (action === 'rules' || action === 'global-rules' || action === 'agent-rules') {
      const result = await service.importRulesProvenance({
        root: flags.workspace ?? process.cwd(),
        owner: flags.owner,
        dryRun: flags.dryRun === true,
        maxItems: flags.maxItems,
        limit: flags.limit,
      });
      output({ ok: true, ...result }, flags.json);
      return;
    }
    if (action === 'manifest') {
      const input = positional[2];
      if (!input) throw new Error('Usage: knowledge ingest manifest <file|s3://bucket/key>');
      const result = await service.ingestManifest(input);
      output({ ok: true, ...result, message: `Ingested ${result.items_seen} manifest item(s)` }, flags.json, flags);
      return;
    }
    if (action === 'source') {
      const sourceRef = positional[2];
      if (!sourceRef) throw new Error('Usage: knowledge ingest source <source-ref>');
      const result = await service.ingestSource(sourceRef, flags.purpose);
      output({ ok: true, ...result, message: `Ingested source ${result.source_ref} (${result.chunks_inserted} chunks)` }, flags.json, flags);
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
      output({ ok: true, ...result, message: `${result.missing_embeddings} chunk(s) missing embeddings` }, flags.json, flags);
      return;
    }
    if (action === 'enqueue') {
      const result = service.enqueueReindex({
        modelRef: flags.model,
        dimensions: flags.dimensions,
        fake: flags.fake,
      });
      output({ ok: true, ...result, message: `Queued ${result.enqueued} embedding refresh item(s)` }, flags.json, flags);
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
      output({ ok: true, ...result, message: `Embedded ${result.indexed.chunks_embedded} chunk(s)` }, flags.json, flags);
      return;
    }
    if (action === 'outbox') {
      const input = positional[2];
      if (!input) throw new Error('Usage: knowledge reindex outbox <file|s3://bucket/key>');
      const result = await service.consumeOutbox(input);
      output({ ok: true, ...result, message: `Consumed ${result.events_seen} outbox event(s)` }, flags.json, flags);
      return;
    }
    throw new Error("Invalid reindex action. Use 'status', 'enqueue', 'embeddings', or 'outbox'.");
  }

  if (command === 'embeddings') {
    const action = positional[1] ?? 'status';
    if (action === 'status') {
      const result = service.embeddingStatus();
      output({ ok: true, ...result, message: `${result.total_vector_entries} vector index entries` }, flags.json, flags);
      return;
    }
    if (action === 'index') {
      const result = await service.indexEmbeddings({
        limit: flags.limit,
        modelRef: flags.model,
        dimensions: flags.dimensions,
        fake: flags.fake,
      });
      output({ ok: true, ...result, message: `Embedded ${result.chunks_embedded} chunk(s)` }, flags.json, flags);
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
      const semanticResult = { ok: true, ...result, message: `${result.results.length} semantic result(s)` };
      output(flags.json || flags.verbose ? semanticResult : formatSemanticResults(semanticResult), flags.json, flags);
      return;
    }
    throw new Error("Invalid embeddings action. Use 'status', 'index', or 'search'.");
  }

  if (command === 'context') {
    const action = positional[1] ?? 'pack';
    if (action !== 'pack') throw new Error("Invalid context action. Use 'pack'.");
    const source = flags.from ?? 'search';
    if (!['search', 'loops', 'runs'].includes(source)) throw new Error("Invalid --from value. Use 'search', 'loops', or 'runs'.");
    const query = positional.slice(2).join(' ') || flags.topic || '';
    const result = await service.contextPack({
      source: source as 'search' | 'loops' | 'runs',
      purpose: source === 'loops' || source === 'runs' ? 'proposal' : 'agent_context',
      query,
      topic: flags.topic,
      since: flags.since,
      dedupe: flags.dedupe,
      maxTokens: flags.maxTokens,
      maxItems: flags.maxItems,
      limit: flags.limit,
      semantic: flags.semantic,
      modelRef: flags.model,
      dimensions: flags.dimensions,
      fake: flags.fake,
      legacyStorePath: storePath,
    });
    outputCompactJson({ ok: true, ...result, message: result.message });
    return;
  }

  if (command === 'proposals') {
    const action = positional[1] ?? 'context';
    if (action !== 'context') throw new Error("Invalid proposals action. Use 'context'.");
    const source = flags.from ?? 'loops';
    if (!['loops', 'runs'].includes(source)) throw new Error("Invalid --from value for proposals. Use 'loops' or 'runs'.");
    const topic = flags.topic ?? positional.slice(2).join(' ');
    if (!topic.trim()) throw new Error('Usage: knowledge proposals context --from loops --topic <text>');
    const result = await service.contextPack({
      source: source as 'loops' | 'runs',
      purpose: 'proposal',
      query: topic,
      topic,
      since: flags.since,
      dedupe: flags.dedupe ?? true,
      maxTokens: flags.maxTokens,
      maxItems: flags.maxItems,
      limit: flags.limit,
    });
    outputCompactJson({ ok: true, ...result, message: result.message });
    return;
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
      const contextResult = { ok: true, ...context, message: `${context.excerpts.length} context excerpt(s)` };
      output(flags.json || flags.verbose ? contextResult : formatContextPack(contextResult), flags.json, flags);
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
    const searchResult = { ok: true, ...result, message: `${result.results.length} search result(s)` };
    output(flags.json || flags.verbose ? searchResult : formatSearchResults(searchResult), flags.json, flags);
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
    const webResult = { ok: true, ...result, message: `${result.sources.length} web source(s)` };
    output(flags.json || flags.verbose ? webResult : formatWebSearch(webResult), flags.json, flags);
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
    const promptResult = { ok: true, ...result, message: result.generated ? 'Generated answer with citations' : 'Prepared citation context draft' };
    output(flags.json || flags.verbose ? promptResult : formatPromptResult(promptResult), flags.json, flags);
    return;
  }

  if (command === 'providers') {
    const action = positional[1] ?? 'status';
    if (action === 'status') {
      const status = service.providerStatus();
      const configured = status.providers.filter((entry) => entry.configured).length;
      output({ ok: true, ...status, message: `${configured}/${status.providers.length} provider credential(s) configured` }, flags.json, flags);
      return;
    }
    if (action === 'models') {
      const models = service.modelRegistry();
      output({ ok: true, models, message: `${models.length} model alias(es)` }, flags.json, flags);
      return;
    }
    if (action === 'check') {
      const target = positional[2] ?? 'default';
      const modelRef = resolveModelRef(target, service.config());
      const parsed = parseModelRef(modelRef);
      const credential = assertProviderCredentials(parsed.provider as AiProviderId, service.config());
      output({ ok: true, target, model_ref: modelRef, provider: parsed.provider, model: parsed.model, credential, message: `${parsed.provider} credentials configured` }, flags.json, flags);
      return;
    }
    throw new Error("Invalid providers action. Use 'status', 'models', or 'check'.");
  }

  if (command === 'add') {
    const title = positional[1];
    const content = positional[2];
    if (!title || !content) throw new Error('Usage: knowledge add <title> <content>');
    const item = await itemStore.create({ title, content, url: flags.url ?? null, tags: flags.tag ? [flags.tag] : [] });
    log('info', 'Item added', { id: item.id, title: item.title, transport: itemStore.kind });
    output({ ok: true, item, message: `Added ${item.id}` }, flags.json, flags);
    return;
  }

  if (command === 'list') {
    if (flags.format !== undefined && flags.format !== 'table' && flags.format !== 'json') {
      throw new Error("Invalid --format value for list. Use 'table' or 'json'.");
    }
    const db = await itemStore.listAll();
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
    const result = { ok: true, page, limit, total: sorted.length, total_pages: totalPages, sort, direction, items: rows, store_exists: db.exists };

    if (useJson) { output(result, true); return; }
    if (flags.verbose) { output(result, false, flags); return; }
    if (rows.length === 0) { output(`No items found (search=${search || 'none'}, tag=${tag || 'none'})`, false); return; }
    if (useTable) {
      const col = (v: string) => v;
      const header = `${col('ID')}\t${col('TITLE')}\t${col('CREATED')}\t${col('URL')}\t${col('TAGS')}`;
      console.log(header);
      for (const row of rows) {
        console.log(`${row.id}\t${col(truncate(row.title, 80))}\t${row.created_at}\t${row.url ? col(truncate(row.url, 90)) : ''}\t${row.tags?.length ? col(truncate(`[${row.tags.join(', ')}]`, 80)) : ''}`);
      }
      console.log(`Page ${page}/${totalPages} | showing ${rows.length} of ${sorted.length} | sort=${sort} ${direction} | search=${search || 'none'} | tag=${tag || 'none'}`);
      console.log('Hint: use `knowledge get --id <id> --json` for full item content.');
    } else {
      for (const row of rows) {
        console.log(`${row.id}\t${truncate(row.title, 80)}\t${row.created_at}${row.url ? `\t${truncate(row.url, 90)}` : ''}${row.tags?.length ? `\t${truncate(`[${row.tags.join(', ')}]`, 80)}` : ''}`);
      }
      console.log(`Page ${page}/${totalPages} | showing ${rows.length} of ${sorted.length} | sort=${sort} ${direction} | search=${search || 'none'} | tag=${tag || 'none'}`);
      console.log('Hint: use `knowledge get --id <id> --json` for full item content.');
    }
    return;
  }

  if (command === 'get') {
    requireId(flags);
    const item = await itemStore.get(flags.id!);
    if (!item) throw new Error(`Item not found: ${flags.id}`);
    output({ ok: true, item, store_exists: itemStore.exists, message: `${item.id}: ${item.title}` }, flags.json, flags);
    return;
  }

  if (command === 'update') {
    requireId(flags);
    const current = await itemStore.get(flags.id!);
    if (!current) throw new Error(`Item not found: ${flags.id}`);
    const patch: Record<string, unknown> = {};
    if (flags.title !== undefined) patch.title = flags.title;
    if (flags.content !== undefined) patch.content = flags.content;
    if (flags.url !== undefined) patch.url = flags.url;
    if (flags.tag !== undefined) {
      const tags = current.tags ?? [];
      if (!tags.map((t) => t.toLowerCase()).includes(flags.tag!.toLowerCase())) patch.tags = [...tags, flags.tag!];
    }
    const item = await itemStore.update(current.id, patch);
    output({ ok: true, item, message: `Updated ${item?.id ?? current.id}` }, flags.json, flags);
    return;
  }

  if (command === 'archive' || command === 'restore') {
    requireId(flags);
    const current = await itemStore.get(flags.id!);
    if (!current) throw new Error(`Item not found: ${flags.id}`);
    const item = await itemStore.update(current.id, { archived: command === 'archive' });
    output({ ok: true, item, message: `${command === 'archive' ? 'Archived' : 'Restored'} ${item?.id ?? current.id}` }, flags.json, flags);
    return;
  }

  if (command === 'untag') {
    requireId(flags);
    if (!flags.tag) throw new Error('Missing required --tag. Example: knowledge untag --id <id> -t <tag>');
    const current = await itemStore.get(flags.id!);
    if (!current) throw new Error(`Item not found: ${flags.id}`);
    const before = current.tags?.length ?? 0;
    const tags = (current.tags ?? []).filter((tag) => tag.toLowerCase() !== flags.tag!.toLowerCase());
    const item = await itemStore.update(current.id, { tags });
    output({ ok: true, item, removed: before - tags.length, message: `Removed tag from ${item?.id ?? current.id}` }, flags.json, flags);
    return;
  }

  if (command === 'upsert') {
    const title = flags.title ?? positional[1];
    const content = flags.content ?? positional[2];
    const existing = flags.id ? await itemStore.get(flags.id) : null;
    if (!existing) {
      if (!title || !content) throw new Error('New item requires title and content. Example: knowledge upsert <title> <content> [--id <id>]');
      const item = await itemStore.create({
        id: flags.id,
        title,
        content,
        url: flags.url ?? null,
        tags: flags.tag ? [flags.tag] : [],
      });
      output({ ok: true, created: true, item, message: `Upserted ${item.id}` }, flags.json, flags);
      return;
    }
    const patch: Record<string, unknown> = {};
    if (title !== undefined) patch.title = title;
    if (content !== undefined) patch.content = content;
    if (flags.url !== undefined) patch.url = flags.url;
    if (flags.tag !== undefined) {
      const tags = existing.tags ?? [];
      if (!tags.map((t) => t.toLowerCase()).includes(flags.tag.toLowerCase())) patch.tags = [...tags, flags.tag];
    }
    const item = await itemStore.update(existing.id, patch);
    output({ ok: true, created: false, item, message: `Upserted ${item?.id ?? existing.id}` }, flags.json, flags);
    return;
  }

  if (command === 'delete') {
    requireId(flags);
    if (!flags.yes) throw new Error('Refusing delete without --yes. Re-run with: knowledge delete --id <id> --yes');
    const deleted = await itemStore.delete(flags.id!);
    if (!deleted) throw new Error(`Item not found: ${flags.id}`);
    log('info', 'Item deleted', { id: flags.id, transport: itemStore.kind });
    output({ ok: true, deleted_id: flags.id, message: `Deleted ${flags.id}` }, flags.json, flags);
    return;
  }

  if (command === 'export') {
    const format = flags.format ?? 'json';
    if (format !== 'json' && format !== 'jsonl') throw new Error("Invalid --format. Use 'json' or 'jsonl'.");
    const db = await itemStore.listAll();
    if (format === 'jsonl') {
      for (const item of db.items) console.log(JSON.stringify(item));
    } else if (flags.json || flags.format === 'json' || flags.verbose) {
      output({ ok: true, items: db.items, store_exists: db.exists }, flags.json || flags.format === 'json', flags);
    } else {
      output(formatExportSummary(db.items, format), false);
    }

    return;
  }

  if (command === 'prune') {
    if (!flags.yes) throw new Error('Refusing prune without --yes. Re-run with: knowledge prune --yes [--older-than <days>] [--empty]');
    const { items } = await itemStore.listAll();
    const cutoff = flags.olderThan !== undefined ? new Date(Date.now() - (flags.olderThan as number) * 86_400_000) : null;
    const toDelete = items.filter((x) =>
      (cutoff !== null && new Date(x.created_at) < cutoff) || (flags.empty && x.content.trim().length === 0));
    const pruned = await itemStore.deleteMany(toDelete.map((x) => x.id));
    const remaining = items.length - pruned;
    log('info', 'Prune completed', { pruned, remaining, transport: itemStore.kind });
    output({ ok: true, pruned, remaining, message: `Pruned ${pruned} item(s)` }, flags.json, flags);
    return;
  }

  if (command === 'dedupe') {
    if (!flags.yes) throw new Error('Refusing dedupe without --yes. Re-run with: knowledge dedupe --yes [--json]');
    const { items } = await itemStore.listAll();
    const seen = new Set<string>();
    const dupes: KnowledgeItem[] = [];
    for (const x of items) {
      const key = `${x.title} ${x.content}`;
      if (seen.has(key)) dupes.push(x); else seen.add(key);
    }
    const removed = await itemStore.deleteMany(dupes.map((x) => x.id));
    const remaining = items.length - removed;
    log('info', 'Dedupe completed', { removed, remaining, transport: itemStore.kind });
    output({ ok: true, removed, remaining, message: `Dedupe removed ${removed} duplicate(s)` }, flags.json, flags);
    return;
  }

  if (command === 'stats') {
    const db = await itemStore.listAll();
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
      store_exists: db.exists,
      message: `${total} items | ${withUrl} with URL | ${withTags} with tags`,
    }, flags.json, flags);
    return;
  }

  const suggestion = suggestCommand(positional[0]);
  const hint = suggestion ? ` Did you mean '${suggestion}'?` : '';
  log('warn', 'Unknown command', { input: positional[0], suggestion });
  throw new Error(`Unknown command: ${positional[0]}.${hint} Run 'knowledge --help' for available commands.`);
}

/**
 * Report a fatal CLI error while honoring the --json output contract.
 *
 * The human-readable diagnostic is always written to stderr (`Error: <msg>`),
 * so tooling that reads stderr keeps working regardless of `--json`. When
 * `--json` is present, a machine-parseable `{ ok: false, error, message }`
 * object is additionally emitted on stdout (mirroring the `{ ok: true, ... }`
 * success contract) so that consumers parsing `<cmd> --json` can detect and
 * read the failure on stdout instead of getting nothing.
 */
function emitCliError(error: unknown, argv: string[]): void {
  const message = error instanceof Error ? error.message : String(error);
  // Keep the internal stack (which includes the bundled bin path and minified
  // function names) behind debug logging. Usage/validation and other expected
  // errors should present a plain message only. Set DEBUG=1 or LOG_LEVEL=debug
  // to surface the full diagnostic for troubleshooting.
  log('debug', 'CLI error', { message, stack: error instanceof Error ? error.stack : undefined });
  console.error(`Error: ${message}`);
  if (argv.includes('--json')) {
    output({ ok: false, error: message, message }, true);
  }
  process.exitCode = 1;
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  run(argv).catch((error) => emitCliError(error, argv));
}

export { run, parseArgs, suggestCommand, sortItems, emitCliError };
