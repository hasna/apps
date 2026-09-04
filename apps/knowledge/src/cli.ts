#!/usr/bin/env bun
/**
 * @hasna/knowledge
 * Copyright 2026 Hasna Inc.
 * Licensed under the Apache License, Version 2.0
 */
import { defaultStorePath, ensureStore, importLegacyGlobalStore, itemMatchesSearch, type KnowledgeItem } from './store';
import { resolveItemStore, type ItemListDirection, type ItemListSort, type ItemStore } from './item-store';
import { usesKnowledgeHttpTransport, KnowledgeVersionConflictError } from './http-store';
import { diffEntries, formatEntryDiff, redactEntryDiff, type EntrySnapshot } from './entry-diff';
import {
  KNOWLEDGE_API_KEY_ENV_KEYS,
  KNOWLEDGE_API_URL_ENV_KEYS,
  assertNoRetiredKnowledgeStorageSelector,
  resolveKnowledgeClientTransport,
  type KnowledgeClientTransportReport,
} from './client-transport';
import { openKnowledgeDb } from './knowledge-db';
import { createKnowledgeService } from './service';
import { createKnowledgeProjectPanel, formatKnowledgeProjectPanel } from './project-panel';
import {
  KNOWLEDGE_PROJECT_REGISTRATION_ROUTE,
  KnowledgeProjectLinksError,
  createLocalKnowledgeProjectLinksAuthority,
  digestKnowledgeProjectLinksValue,
  type KnowledgeProjectLinksAuthority,
  type KnowledgeProjectReceiptAction,
  type KnowledgeProjectRegistrationDirection,
  type KnowledgeProjectResourceKind,
} from './project-links';
import {
  runKnowledgeGuardedCliDescriptorWorker,
  runKnowledgeGuardedCliIpcWorker,
} from './guarded-cli';
import { getStorageStatus as getDatabaseStorageStatus } from './storage';
import { assertProviderCredentials, parseModelRef, resolveModelRef, type AiProviderId } from './providers';
import { approvalStatus, assertS3ReadAllowed, assertWebSearchAllowed, createApprovalGate, recordAuditEvent, recordRedactionFindings, redactSecrets, redactVersionHistory } from './safety';
import { Command } from 'commander';
import { registerEventsCommands } from '@hasna/events/commander';
import { basename, dirname, join } from 'node:path';
import pkg from '../package.json' with { type: 'json' };
import { resolveCredential as resolveClientCredential } from '@hasna/contracts/client';

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
  tag?: string[];
  /**
   * Every `-t` value exactly as given, before comma-splitting. `untag` and `list -t` both
   * need it to match a stored tag whole: legacy items damaged by the multi-tag defect
   * carry a single literal `"a,b,c"` tag, which none of the split names can match. The two
   * commands then apply it differently on purpose — `untag` stops at a whole-value hit,
   * `list` unions the two shapes; see each site for why.
   */
  tagRaw?: string[];
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
  to?: string;
  /** Entry version for `diff`. Named --rev because -v/--version is taken. */
  rev?: number;
  /**
   * Optimistic-concurrency guard for `update`: reject the write (exit 2,
   * nothing written) unless the stored item is still at exactly this
   * version. Pass the version a caller read via a PRIOR, separate `get` —
   * never re-derive it from a fresh read taken at write time, which is
   * exactly the gap this flag closes: `update` already re-reads the item for
   * its own internal patch, and using THAT freshly-read version as the guard
   * only protects the instant inside one command invocation, not a decision
   * an agent made from an earlier read.
   */
  ifVersion?: number;
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
  operationId?: string;
  stepId?: string;
  idempotencyKey?: string;
  collectionId?: string;
  itemId?: string;
  receiptId?: string;
  cursor?: string;
  kind?: string[];
  all?: boolean;
  slug?: string;
  name?: string;
  collectionSlug?: string;
  collectionName?: string;
  requestFd?: number;
  resultFd?: number;
  ipc?: boolean;
}

interface ParseResult {
  positional: string[];
  flags: Flags;
}

const EVENTS_COMMANDS = ['events', 'webhooks'];
const COMMANDS = ['add', 'list', 'get', 'delete', 'update', 'archive', 'restore', 'upsert', 'untag', 'versions', 'diff', 'export', 'prune', 'dedupe', 'stats', 'inventory', 'project-panel', 'project-registration', 'project-membership', 'project-resources', 'project-resource', 'paths', 'transport', 'guarded', 'setup', 'auth', 'storage', 'machines', 'sync', 'db', 'wiki', 'app-wiki', 'source', 'ingest', 'reindex', 'search', 'context', 'proposals', 'web', 'ask', 'build', 'embeddings', 'providers', 'safety', 'help', ...EVENTS_COMMANDS];
const COMMAND_ALIASES: Record<string, string> = {
  ls: 'list',
  rm: 'delete',
  edit: 'update',
  unarchive: 'restore',
};
const KNOWLEDGE_ITEM_ID_PATTERN = /^k_[A-Za-z0-9][A-Za-z0-9_-]*$/;

/**
 * Decide whether an unknown top-level token is the documented free-form prompt
 * shorthand or a command-shaped invocation that must fail closed.
 *
 * Quoted prompts are one positional containing whitespace, while ordinary
 * free-form prompts contain multiple word-like positionals. An unknown token
 * followed by any stored item reference as its first operand is materially
 * different: it has the shape of a CLI command plus operand (`show <id>`).
 * ItemStore — not an id regex — owns that identity contract because callers
 * can read by a generated full id, a short id, or a caller-supplied custom id.
 * Treating any of those as prose can run the ask path and spend model tokens.
 * Callers that intentionally want to ask about an id can use the unambiguous
 * `knowledge ask ...` command or quote the whole prompt.
 */
async function looksLikeNaturalLanguagePrompt(
  positional: string[],
  rawCommand: string,
  itemStore: ItemStore,
): Promise<boolean> {
  if (/\s/.test(rawCommand)) return true;
  if (positional.length <= 1) return false;
  const firstOperand = positional[1] ?? '';
  if (KNOWLEDGE_ITEM_ID_PATTERN.test(firstOperand)) return false;
  return (await itemStore.get(firstOperand)) === null;
}

/** Case-insensitive dedupe that preserves first-seen casing and order. */
function dedupeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const tag of tags) {
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(tag);
  }
  return unique;
}

/** Requested tags an item does not already carry (case-insensitive), in request order. */
function tagsToAppend(existing: string[] | undefined, requested: string[]): string[] {
  const known = new Set((existing ?? []).map((tag) => tag.toLowerCase()));
  return requested.filter((tag) => !known.has(tag.toLowerCase()));
}

/**
 * Attach an `added` tag count to an `update`/`upsert` result, in `message` as well as in
 * JSON. `added` is present exactly when the caller passed `-t`, so a consumer never has
 * to branch on created-versus-updated to know the field is meaningful, and 0 added is
 * reported as plainly as 3 instead of hiding behind an unqualified `Updated <id>`.
 */
function tagCountResult(base: Record<string, unknown>, message: string, added: string[] | undefined): Record<string, unknown> {
  if (added === undefined) return { ...base, message };
  return { ...base, added: added.length, message: `${message} (added ${added.length} tag${added.length === 1 ? '' : 's'})` };
}

/**
 * `-t/--tag` is repeatable AND accepts a comma-separated list, matching the
 * `todos` CLI (`-t, --tags <tags>` / "Comma-separated tags") and the array-typed
 * `tag`/`tags` inputs the MCP tools already expose. Every occurrence accumulates;
 * nothing is ever dropped or stored as a literal comma string.
 *
 * A missing or separator-only value throws rather than storing nothing, so `-t ""`
 * from an empty shell expansion fails at exit 1 instead of exiting 0 with the tag
 * dropped. That is a deliberate exit-code change on input that previously "worked";
 * see README for the contract.
 */
function collectTagFlag(current: string[] | undefined, raw: string | undefined): string[] {
  if (raw === undefined) throw new Error('Missing value for --tag. Example: knowledge add <title> <content> -t <tag> -t <tag>');
  const parsed = raw.split(',').map((tag) => tag.trim()).filter((tag) => tag.length > 0);
  if (parsed.length === 0) throw new Error(`Invalid --tag value ${JSON.stringify(raw)}: no tag name found. Example: knowledge add <title> <content> -t <tag> -t <tag>`);
  return dedupeTags([...(current ?? []), ...parsed]);
}

function parseArgs(argv: string[]): ParseResult {
  const positional: string[] = [];
  const flags: Flags = {};
  const guardedIndex = argv.indexOf('guarded');
  const guardedDescriptorInvocation = guardedIndex >= 0
    && argv.indexOf('execute-descriptor', guardedIndex + 1) >= 0;
  let optionsTerminated = false;
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (optionsTerminated) {
      positional.push(token);
      continue;
    }
    if (token === '--') {
      optionsTerminated = true;
      continue;
    }
    // Markdown with YAML frontmatter is a supported `add` body. The body is one
    // argv token, so once the command and title are present a leading `---`
    // identifies the content slot rather than a CLI option. Other dash-prefixed
    // values remain errors unless the caller uses the conventional `--` marker.
    if (!token.startsWith('-') || (positional[0] === 'add' && positional.length === 2 && token.startsWith('---'))) {
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
      case '--tag': case '-t': flags.tag = collectTagFlag(flags.tag, argv[i + 1]); flags.tagRaw = [...(flags.tagRaw ?? []), argv[i + 1] as string]; i += 1; break;
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
      case '--to': flags.to = argv[i + 1]; i += 1; break;
      // `--rev`, not the design's `-v`: `-v` is already the global alias for
      // --version (print the package version), and re-pointing it at an entry
      // version would silently break every existing `knowledge -v` invocation.
      case '--rev': flags.rev = Number(argv[i + 1]); i += 1; break;
      case '--if-version': flags.ifVersion = Number(argv[i + 1]); i += 1; break;
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
      case '--operation-id': flags.operationId = argv[i + 1]; i += 1; break;
      case '--step-id': flags.stepId = argv[i + 1]; i += 1; break;
      case '--idempotency-key': flags.idempotencyKey = argv[i + 1]; i += 1; break;
      case '--collection-id': flags.collectionId = argv[i + 1]; i += 1; break;
      case '--item-id': flags.itemId = argv[i + 1]; i += 1; break;
      case '--receipt-id': flags.receiptId = argv[i + 1]; i += 1; break;
      case '--cursor': flags.cursor = argv[i + 1]; i += 1; break;
      case '--kind': flags.kind = [...(flags.kind ?? []), argv[i + 1] as string]; i += 1; break;
      case '--all': flags.all = true; break;
      case '--slug': flags.slug = argv[i + 1]; i += 1; break;
      case '--name': flags.name = argv[i + 1]; i += 1; break;
      case '--collection-slug': flags.collectionSlug = argv[i + 1]; i += 1; break;
      case '--collection-name': flags.collectionName = argv[i + 1]; i += 1; break;
      case '--request-fd': flags.requestFd = Number(argv[i + 1]); i += 1; break;
      case '--result-fd': flags.resultFd = Number(argv[i + 1]); i += 1; break;
      case '--ipc': flags.ipc = true; break;
      default:
        if (guardedDescriptorInvocation) {
          throw new Error('guarded_descriptor_public_input_refused');
        }
        throw new Error(`Unknown flag: ${token}. Run 'knowledge --help' for valid options.`);
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
  untag --id <id> -t <tag>    Remove tag(s) from an item (-t repeatable; exits 1 if nothing removed)
  versions --id <id>          Show retained prior versions of an item (newest first)
  diff --id <id>              Diff two versions of an item (--rev N, or --from A --to B)
  delete (alias: rm) --id <id> Delete item (requires --yes)
  export                       Export all items (--format jsonl)
  prune                        Remove old/empty items (requires --yes)
  dedupe                       Remove duplicate items by title+content (requires --yes)
  stats                        Show knowledge base statistics
  inventory                    Show all local knowledge layers and previews
  project-panel                Emit Projects dashboard project-panel contract
  project-registration         Register/read/compensate a project collection with immutable receipts
  project-membership           Bind/read/compensate exact item membership
  project-resources            Enumerate complete project/collection/item/taxonomy resources
  project-resource             Read one exact project resource
  paths                        Show resolved workspace/store paths
  transport                    Report the selected client transport and why
  guarded capabilities         Report FCAME-1 private transport capability
  guarded execute-descriptor   Execute an opaque descriptor over inherited process IPC
  setup                        Initialize config or canonical example S3 storage
  auth login|whoami|logout     Manage HTTP API credentials
  storage status|validate|repair-artifact-keys|migrate-legacy-path|migrate-project-path|merge-legacy-path|import-legacy
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
  --mode deterministic|ai      Sync-conflict resolution strategy
  --machine <id>               Machine id/SSH alias for preflight or peer sync
  --workspace <path>           Repo workspace path for machine preflight
  --api-url <url>              API origin to record for auth setup
  --api-key <key>              HTTP API key for auth login
  --email <email>              SaaS account email metadata
  --org <slug>                 SaaS organization slug metadata
  --org-id <id>                SaaS organization id metadata
  --user-id <id>               SaaS user id metadata
  --owner <name>               Provenance owner for repository rule docs
  --domain <domain>            Restrict provider web search to a domain
  --file-results               File web snippets as web source refs
  --full                       Force full embedding index rebuild
  --dry-run                   Preview sync writes without changing target state
  --fake                       Use deterministic fake embeddings for local tests
  --no-tailscale               Skip local Tailscale topology probing
  --no-artifact-content        Export sync bundles without embedded artifact bodies
  --scope local|global|project  Store scope (default: global — legacy ~/.hasna/knowledge, resolved through @hasna/paths to the XDG data home once adopted)
  --tables <names>             Comma-separated knowledge.db sync tables
  --peer-workspace <path>      Peer repo root or .hasna/knowledge path for local sync or remote override
  --project <id>               Project id/name/slug for project-panel output
  --operation-id <id>          Stable Projects registration operation id
  --step-id <id>               Stable Projects registration step id
  --idempotency-key <key>      Caller-owned idempotency key
  --collection-id <uuid>       Exact Knowledge collection id
  --item-id <id>               Exact existing Knowledge item id
  --receipt-id <uuid>          Exact accepted receipt id for compensation
  --cursor <cursor>            Revision-bound project-resource cursor
  --kind <kind>                Resource kind filter; repeatable
  --all                        Read project resources to complete exhaustion
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
  -s, --search <text>         Filter by id/title/content (case-insensitive substring; use 'knowledge search' for semantic)
  -t, --tag <tag>             Filter by tag; repeatable/comma-separated, item must match ALL
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
  --if-version <n>             Reject the write (exit 2) unless the stored item is still at version <n>

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
  if (command === 'add') { console.log('Usage: knowledge add <title> <content> [--url <url>] [-t <tag>]... [--json]\n  -t/--tag is repeatable and accepts comma-separated values: -t a -t b  ==  -t "a,b"'); return; }
  if (command === 'list' || command === 'ls') { console.log('Usage: knowledge list|ls [--format table|json] [-p <page>] [-l <limit>] [-s <search>] [-t <tag>]... [--sort created|title] [--desc] [--archived] [--include-archived] [--verbose] [--json]\n  -s/--search is a CASE-INSENSITIVE LITERAL SUBSTRING filter over id, title and content — not a\n  tokenised or semantic search, so a word order that never appears verbatim matches nothing. It\n  resolves an item by its slug because the id is included. For meaning-based lookup use `knowledge\n  search <query>`, which is a different index and will find items this filter cannot.\n  -t/--tag is repeatable and accepts comma-separated values; repeated -t narrows (an item must carry every tag).\n  Each value matches an item carrying the whole value OR all of its comma-split names — a union, so\n  `-t "a,b,c"` finds items carrying a legacy literal "a,b,c" tag as well as items carrying the three\n  names separately. (`untag` differs on purpose: it stops at the whole-value match.)\n  Use --json to tell those two shapes apart; the table renders them near-identically.\n  Archived items are excluded by default; add --include-archived to sweep both.\n  If both --archived and --include-archived are passed, --archived wins (archived items only).'); return; }
  if (command === 'get') { console.log('Usage: knowledge get --id <id> [--json]'); return; }
  if (command === 'update' || command === 'edit') { console.log('Usage: knowledge update|edit --id <id> [--title <title>] [--content <content>] [--url <url>] [-t <tag>]... [--if-version <n>] [--json]\n  -t/--tag is repeatable and accepts comma-separated values; tags are added, never replaced.\n  With -t the output reports how many tags were actually added, so 0 added is not read as 3.\n  --if-version <n> is an explicit optimistic-concurrency guard: pass the "version" a prior\n  `knowledge get` returned, and the write is REJECTED (exit 2, nothing written) if the stored\n  item has moved to a different version since. Without it, the version used is whatever THIS\n  command itself just re-read, which only guards the instant inside one invocation — it cannot\n  catch a decision made from an earlier, separate `get`. On conflict, stderr and --json both\n  name the expected and the actual (current) version; there is no automatic retry.'); return; }
  if (command === 'archive') { console.log('Usage: knowledge archive --id <id> [--json]'); return; }
  if (command === 'restore' || command === 'unarchive') { console.log('Usage: knowledge restore|unarchive --id <id> [--json]'); return; }
  if (command === 'upsert') { console.log('Usage: knowledge upsert [title] [content] [--id <id>] [--title <title>] [--content <content>] [--url <url>] [-t <tag>]... [--json]\n  -t/--tag is repeatable and accepts comma-separated values; tags are added, never replaced.\n  With -t the output reports how many tags were actually added, on both the create and update paths.'); return; }
  if (command === 'untag') { console.log('Usage: knowledge untag --id <id> -t <tag>... [--json]\n  -t/--tag is repeatable and accepts comma-separated values.\n  Each value is matched whole first, and only split on commas if no stored tag equals it,\n  so a legacy literal "a,b,c" tag can still be removed.\n  Removing nothing exits 1; unmatched names are reported in not_found.'); return; }
  if (command === 'versions') { console.log('Usage: knowledge versions --id <id> [-l <limit>] [--json]\n  Lists the retained prior versions of an item, newest first, with the version the item is at now.\n  An item that exists but was never edited prints an EMPTY history, which is not the same answer as\n  "no such item" (that exits 1) or "this store keeps no history" (also exits 1, naming the store).\n  Entry history lives in the Postgres-backed store; the local JSON store has no version line.\n  Sub-action — purge retained versions (secret hygiene):\n    knowledge versions purge --id <id> [--rev <n>] --yes\n    Permanently deletes retained prior versions so a credential-shaped value in history stops being\n    reachable. Without --rev, deletes EVERY retained prior version; with --rev <n>, deletes only\n    retained version n. The live row is never a target, and the operation never reads or returns the\n    retained body. Purging the live/current version is refused.'); return; }
  if (command === 'diff') { console.log('Usage: knowledge diff --id <id> [--rev <n>] [--from <a> --to <b>] [--json]\n  Default: the latest retained version vs the item as it stands now.\n  --rev <n>: version n vs version n-1.  --from <a> --to <b>: two explicit versions, where\n  either side may be "current" to mean the live item.\n  --rev is spelled out because -v is the global --version flag.\n  Reports changed fields (title/url/tags/metadata/archived) as well as a line diff of the body,\n  so an edit that moved only the tags is not rendered as "no changes".'); return; }
  if (command === 'delete' || command === 'rm') { console.log('Usage: knowledge delete|rm --id <id> -y [--json]'); return; }
  if (command === 'export') { console.log('Usage: knowledge export [--verbose] [--json] [--format json|jsonl]'); return; }
  if (command === 'prune') { console.log('Usage: knowledge prune --yes [--older-than <days>] [--empty] [--json]'); return; }
  if (command === 'dedupe') { console.log('Usage: knowledge dedupe --yes [--json]'); return; }
  if (command === 'stats') { console.log('Usage: knowledge stats [--json]'); return; }
  if (command === 'inventory') { console.log('Usage: knowledge inventory [--scope local|global|project] [--limit <n>] [--include-archived] [--verbose] [--json]'); return; }
  if (command === 'project-panel') { console.log('Usage: knowledge project-panel --project <id|name|slug> [--scope project|local|global] [--limit <n>] [--include-archived] [--json|--contract]'); return; }
  if (command === 'project-registration') { console.log('Usage: knowledge project-registration capability|create|read-exact|receipt|compensate|verify-inverse [--operation-id <id>] [--step-id <id>] [--idempotency-key <key>] [--project <id>] [--slug <slug>] [--name <name>] [--collection-id <uuid>] [--collection-slug <slug>] [--collection-name <name>] [--receipt-id <uuid>] [--json]'); return; }
  if (command === 'project-membership') { console.log('Usage: knowledge project-membership bind|read-exact|compensate|verify-inverse [--operation-id <id>] [--step-id <id>] [--idempotency-key <key>] [--collection-id <uuid>] [--item-id <id>] [--receipt-id <uuid>] [--json]'); return; }
  if (command === 'project-resources') { console.log('Usage: knowledge project-resources <project-id> [--kind <project|collection|item|taxonomy>]... [--limit <n>] [--cursor <cursor>] [--all] [--json]'); return; }
  if (command === 'project-resource') { console.log('Usage: knowledge project-resource <project-id> <project|collection|item|taxonomy> <resource-id> [--json]'); return; }
  if (command === 'paths') { console.log('Usage: knowledge paths [--scope local|global|project] [--verbose] [--json]'); return; }
  if (command === 'transport') { console.log(`Usage: knowledge transport [--json]\n  Reports whether this process uses the on-box SQLite store or the server HTTP API.\n  ${KNOWLEDGE_API_URL_ENV_KEYS[0]} presence selects HTTP and requires ${KNOWLEDGE_API_KEY_ENV_KEYS[0]}.\n  Reads environment names and presence only; it never prints credential values.`); return; }
  if (command === 'guarded') { console.log('Usage:\n  knowledge guarded capabilities [--json]\n  knowledge guarded execute-descriptor --ipc [--json]\n\n  execute-descriptor is an internal package-owned worker. Private requests and results use the\n  runtime-owned child-process IPC channel, never argv, stdin, environment variables, files, stdout,\n  or stderr. Direct shell invocation has no IPC channel and fails closed. Use the exported opaque-\n  descriptor helpers rather than invoking this worker directly from a shell.'); return; }
  if (command === 'setup') { console.log('Usage: knowledge setup [--canonical-example] [--scope local|global|project] [--json]\nClient routing is controlled only by HASNA_KNOWLEDGE_API_URL presence.'); return; }
  if (command === 'auth') { console.log('Usage: knowledge auth login|whoami|logout [--api-key <key>] [--email <email>] [--org <slug>] [--api-url https://...] [--scope local|global|project] [--json]'); return; }
  if (command === 'storage') { console.log('Usage: knowledge storage status|validate|repair-artifact-keys|migrate-legacy-path|migrate-project-path|merge-legacy-path [--approve-write --approved-by <name>] [--scope local|global|project] [--json]\n       knowledge storage import-legacy [--dry-run] [--scope global] [--json]\n       migrate-project-path moves <cwd>/.hasna/knowledge into ~/.hasna/knowledge/projects/<key> (canonical); dry-run by default'); return; }
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

/**
 * Human rendering of `knowledge transport`. Values are never included.
 */
function formatTransport(report: KnowledgeClientTransportReport): string {
  const target = report.transport === 'http' ? 'HTTP /v1 API' : 'on-box SQLite';
  const chose = report.source === 'default'
    ? 'HASNA_KNOWLEDGE_API_URL is absent'
    : 'selected by HASNA_KNOWLEDGE_API_URL presence';
  const lines = [`Knowledge transport: ${report.transport} (${target})`, `  ${chose}`];
  if (report.network_guard_active) {
    lines.push('  Outbound guard: ACTIVE (NODE_ENV=test) — non-loopback requests are refused.');
  }
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

function sortItems(items: KnowledgeItem[], flags: Flags): { sorted: KnowledgeItem[]; sort: ItemListSort; direction: ItemListDirection } {
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

/**
 * True when the invocation only reads metadata — version, completions, or help —
 * and never touches storage or transport resolution. The retired-storage-selector
 * ratchet must not make the CLI unreadable for an operator with a stale
 * provisioning fragment in the environment: a retired selector is rejected the
 * moment a command would actually select a store, but --version, --completions
 * and help/--help can safely run regardless.
 */
function isMetadataOnlyInvocation(argv: string[]): boolean {
  if (argv.includes('--version') || argv.includes('-v')) return true;
  if (argv.includes('--completions')) return true;
  if (argv.includes('--help') || argv.includes('-h')) return true;
  return argv[0] === 'help';
}

async function run(argv: string[]): Promise<void> {
  if (!isMetadataOnlyInvocation(argv)) {
    assertNoRetiredKnowledgeStorageSelector(process.env);
  }
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
    console.log(`_knowledge() { local cur; cur="${"$"}{COMP_WORDS[COMP_CWORD]}"; COMPREPLY=($(compgen -W "${COMMANDS.join(' ')} --json --verbose --yes --help --version --desc --page --limit --search --sort --id --store --title --content --url --tag --rev --to --format --completions --purpose --model --dimensions --semantic --context --max-tokens --max-items --from --since --topic --dedupe --generate --approve-write --provider --mode --machine --workspace --peer-workspace --api-url --canonical-example --api-key --email --org --org-id --user-id --owner --domain --file-results --full --dry-run --fake --no-tailscale --no-artifact-content --no-color --scope --tables --archived --include-archived --project --operation-id --step-id --idempotency-key --slug --name --collection-id --collection-slug --collection-name --item-id --receipt-id --cursor --kind --all --contract --source-ref --allow-global" -- "$cur")); }; complete -F _knowledge knowledge`);
    } else if (shell === 'zsh') {
      console.log(`#compdef knowledge\n_knowledge() { _arguments -C "1: :(${COMMANDS.join(' ')})" "(--json)--json" "(--verbose)--verbose" "(--yes)-y" "(--help)--help" "(--version)--version" "(--desc)--desc" "(--archived)--archived" "(--include-archived)--include-archived" "(--semantic)--semantic" "(--context)--context" "(--dedupe)--dedupe" "(--generate)--generate" "(--approve-write)--approve-write" "(--canonical-example)--canonical-example" "(--file-results)--file-results" "(--full)--full" "(--dry-run)--dry-run" "(--fake)--fake" "(--no-tailscale)--no-tailscale" "(--no-artifact-content)--no-artifact-content" "(--all)--all" "(--contract)--contract" "(--allow-global)--allow-global" "(-p --page)"{-p,--page}"[page number]:number:" "(-l --limit)"{-l,--limit}"[items per page]:number:" "(--search)--search[search text]:text:" "(--sort)--sort"\{created,title\}:" "(--id)--id[item id]:id:" "(--store)--store[store path]:path:" "(--title)--title[new title]:" "(--content)--content[new content]:" "(--url)--url[source url]:" "(-t --tag)"{-t,--tag}"[tag]:tag:" "(--format)--format[json|jsonl]:" "(--completions)--completions[output completions]:shell:(bash zsh fish):" "(--purpose)--purpose[purpose]:" "(--model)--model[model ref]:" "(--dimensions)--dimensions[embedding dimensions]:number:" "(--max-tokens)--max-tokens[token budget]:number:" "(--max-items)--max-items[item budget]:number:" "(--from)--from"\{search,loops,runs\}:" "(--to)--to[diff target: version number or current]:" "(--rev)--rev[entry version for diff]:number:" "(--since)--since[duration or ISO time]:" "(--topic)--topic[topic text]:" "(--provider)--provider[provider]:" "(--mode)--mode"\{deterministic,ai\}:" "(--machine)--machine[machine id or SSH alias]:" "(--workspace)--workspace[repo workspace path]:path:" "(--peer-workspace)--peer-workspace[peer repo or knowledge home path]:path:" "(--api-url)--api-url[HTTP API URL]:" "(--api-key)--api-key[HTTP API key]:" "(--email)--email[email]:" "(--org)--org[org slug]:" "(--org-id)--org-id[org id]:" "(--user-id)--user-id[user id]:" "(--owner)--owner[provenance owner]:" "(--domain)--domain[domain]:" "(--project)--project[project id/name/slug]:" "(--operation-id)--operation-id[registration operation id]:" "(--step-id)--step-id[registration step id]:" "(--idempotency-key)--idempotency-key[caller idempotency key]:" "(--slug)--slug[project slug]:" "(--name)--name[project name]:" "(--collection-id)--collection-id[exact collection id]:" "(--collection-slug)--collection-slug[collection slug]:" "(--collection-name)--collection-name[collection name]:" "(--item-id)--item-id[exact item id]:" "(--receipt-id)--receipt-id[exact receipt id]:" "(--cursor)--cursor[resource cursor]:" "(--kind)--kind[resource kind]:(project collection item taxonomy):" "(--source-ref)--source-ref[source ref]:" "(--no-color)--no-color[disable color]" "(--scope)--scope"\{local,global,project\}:" "(--tables)--tables[comma-separated DB sync tables]:" }; _knowledge`);
    } else if (shell === 'fish') {
      const fishOptions = [
        'json', 'verbose', 'yes', 'help', 'version', 'desc', 'archived', 'include-archived',
        'semantic', 'context', 'max-tokens', 'max-items', 'from', 'to', 'rev', 'since', 'topic',
        'dedupe', 'generate', 'approve-write', 'allow-global', 'canonical-example', 'provider',
        'mode', 'machine', 'workspace', 'peer-workspace', 'api-url', 'api-key', 'email', 'org',
        'org-id', 'user-id', 'owner', 'domain', 'project', 'operation-id', 'step-id',
        'idempotency-key', 'slug', 'name', 'collection-id', 'collection-slug', 'collection-name',
        'item-id', 'receipt-id', 'cursor', 'kind', 'all', 'contract', 'source-ref', 'file-results',
        'full', 'dry-run', 'fake', 'no-tailscale', 'no-artifact-content', 'page', 'limit', 'search',
        'sort', 'id', 'store', 'title', 'content', 'url', 'tag', 'format', 'completions', 'purpose',
        'model', 'dimensions', 'no-color', 'scope', 'tables',
      ];
      console.log(`complete -c knowledge -f; complete -c knowledge -a "${COMMANDS.join(' ')}"; ${fishOptions.map((option) => `complete -c knowledge -l ${option}`).join('; ')}`);
    } else {
      throw new Error("Invalid --completions value. Use 'bash', 'zsh', or 'fish'.");
    }
    return;
  }

  let command = resolveCommand(positional[0]);
  let commandArgOffset = 1;
  // Defer the shorthand decision until the unified item Store is available.
  // Regex-only dispatch cannot recognize short ids or caller-supplied ids.
  const promptShorthandCandidate = invokedAsKnowledge() && command && !COMMANDS.includes(command);

  if (!command || flags.help || command === 'help') {
    // `help <sub>` names its target as positional[1]; `<sub> --help` / `<sub> -h`
    // names it as the resolved command itself. Bare `--help`/`help` (no command)
    // falls through to the global help.
    const helpTarget = command === 'help' ? positional[1] : (command || positional[1]);
    printCommandHelp(helpTarget);
    return;
  }

  // Answered BEFORE the service is constructed, and deliberately so. The point
  // of this command is to tell an operator which transport the CLI resolved
  // without changing anything on the way to the answer, and a diagnostic that
  // creates the store it is reporting on is worse than no diagnostic: in the
  // sibling mementos fix the equivalent command created a 720 KB database via a
  // pre-command hook, which then made an isolation assertion unfalsifiable
  // because the file it checked for already existed. Keep this above every
  // store, config, and db touch.
  if (command === 'transport') {
    const report = resolveKnowledgeClientTransport(process.env);
    output(flags.json || flags.verbose ? { ok: true, ...report } : formatTransport(report), flags.json, flags);
    return;
  }

  if (command === 'guarded') {
    const action = positional[1] ?? 'capabilities';
    if (action === 'capabilities') {
      output({
        ok: true,
        contract: 'FCAME-1',
        private_input: true,
        private_result: true,
        exact_title_lookup: true,
        private_transport_body_output: false,
        private_cli_descriptor_transport: true,
        private_cli_transport: 'process_ipc',
        guarded_actions: ['create', 'update', 'query', 'readback'],
      }, flags.json, flags);
      return;
    }
    if (action !== 'execute-descriptor') {
      throw new Error('Usage: knowledge guarded capabilities|execute-descriptor [--json]');
    }
    const publicBodyFlagsPresent = [
      flags.title,
      flags.content,
      flags.url,
      flags.tag,
      flags.tagRaw,
      flags.id,
      flags.itemId,
      flags.operationId,
      flags.stepId,
      flags.idempotencyKey,
      flags.sourceRef,
      flags.search,
      flags.topic,
      flags.project,
      flags.collectionId,
      flags.collectionSlug,
      flags.collectionName,
    ].some((value) => value !== undefined);
    if (positional.length !== 2 || publicBodyFlagsPresent) {
      throw new Error('guarded_descriptor_public_input_refused');
    }
    if (flags.ipc) {
      if (flags.requestFd !== undefined || flags.resultFd !== undefined) {
        throw new Error('guarded_descriptor_private_transport_ambiguous');
      }
      output({
        ok: true,
        ...(await runKnowledgeGuardedCliIpcWorker(process.env)),
      }, flags.json, flags);
      return;
    }
    if (
      !Number.isInteger(flags.requestFd)
      || !Number.isInteger(flags.resultFd)
      || (flags.requestFd as number) < 3
      || (flags.resultFd as number) < 3
    ) {
      throw new Error('guarded_descriptor_private_fds_required');
    }
    output({
      ok: true,
      ...(await runKnowledgeGuardedCliDescriptorWorker(
        flags.requestFd as number,
        flags.resultFd as number,
        process.env,
      )),
    }, flags.json, flags);
    return;
  }

  const serviceScope = command === 'project-panel' || command === 'app-wiki' ? (flags.scope ?? 'project') : flags.scope;
  const service = createKnowledgeService({ scope: serviceScope });
  let standaloneProjectLinksAuthority: KnowledgeProjectLinksAuthority | undefined;
  try {
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
    if (storageAction === 'migrate-project-path') {
      const migration = service.migrateProjectPath({
        approveWrite: flags.approveWrite,
        approvedBy: flags.approvedBy,
      });
      output(migration, flags.json);
      if (!migration.ok && !flags.json) process.exitCode = 1;
      return;
    }
    if (storageAction === 'merge-legacy-path' || storageAction === 'merge-legacy' || storageAction === 'merge-path') {
      const merge = service.mergeLegacyPath({
        approveWrite: flags.approveWrite,
        approvedBy: flags.approvedBy,
      });
      output(merge, flags.json);
      if (!merge.ok && !flags.json) process.exitCode = 1;
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
  // Single knowledge-item Store abstraction. The canonical API URL and key
  // select the server HTTP API; without the URL the on-box JSON store is used.
  // An explicit --store override pins to the on-box store. Every item command
  // below routes through `itemStore` — never the JSON file or HTTP client directly.
  const itemStore: ItemStore = resolveItemStore({ storePath, storePathOverridden });

  // Natural-language shorthand: when invoked as the `knowledge` bin, a prompt is
  // treated as `knowledge ask <prompt>`. A first operand that resolves through the
  // same Store contract as `get --id` keeps the unknown command on its fail-closed
  // path, including short ids and custom ids that no syntax-only regex can identify.
  if (promptShorthandCandidate && await looksLikeNaturalLanguagePrompt(positional, command, itemStore)) {
    command = 'ask';
    commandArgOffset = 0;
  }

  // ask/build seed a local JSON store only for the on-box transport. With the
  // HTTP API the prompt flow runs over the shared item corpus, so touching a local file
  // here would be an unnecessary local-side write while the flip is active. This
  // follows shorthand resolution so the read-only item identity check itself never
  // creates a store while deciding whether an unknown command should fail.
  if (!storePathOverridden && (command === 'ask' || command === 'build') && !usesKnowledgeHttpTransport()) {
    ensureStore(storePath);
  }

  const projectLinksAuthority = () => {
    if (!storePathOverridden || usesKnowledgeHttpTransport()) return service.projectLinksAuthority();
    standaloneProjectLinksAuthority ??= createLocalKnowledgeProjectLinksAuthority({
      databasePath: join(dirname(storePath), 'knowledge.db'),
      itemStore,
      options: {
        packageVersion: pkg.version,
        authorityId: process.env.HASNA_KNOWLEDGE_PROJECT_AUTHORITY_ID ?? 'knowledge',
        tenantId: process.env.HASNA_KNOWLEDGE_PROJECT_TENANT_ID ?? 'local',
        corpusId: process.env.HASNA_KNOWLEDGE_PROJECT_CORPUS_ID ?? 'knowledge',
      },
    });
    return standaloneProjectLinksAuthority;
  };

  if (command === 'project-registration') {
    const action = positional[1] ?? 'capability';
    const authority = projectLinksAuthority();
    if (action === 'capability') {
      output({ ok: true, capability: await authority.capability() }, flags.json, flags);
      return;
    }
    if (action === 'create') {
      const capability = await authority.capability();
      const projectId = flags.project;
      const projectSlug = flags.slug;
      const projectName = flags.name;
      if (!flags.operationId || !flags.stepId || !flags.idempotencyKey || !projectId || !projectSlug || !projectName) {
        throw new Error(
          'Usage: knowledge project-registration create --operation-id <id> --step-id <id> '
          + '--idempotency-key <key> --project <id> --slug <slug> --name <name> '
          + '[--collection-slug <slug>] [--collection-name <name>] [--json]',
        );
      }
      const desired = {
        collection_slug: flags.collectionSlug ?? `${projectSlug}-knowledge`,
        collection_name: flags.collectionName ?? `${projectName} Knowledge`,
      };
      const requestDigest = digestKnowledgeProjectLinksValue({
        action: 'register_collection',
        source_project_id: projectId,
        project_slug: projectSlug,
        project_name: projectName,
        collection_slug: desired.collection_slug,
        collection_name: desired.collection_name,
        membership_rule: 'explicit_collection_binding',
      });
      const receipt = await authority.registerCollection({
        operation_id: flags.operationId,
        step_id: flags.stepId,
        resource_kind: 'collection',
        direction: 'forward',
        authority_route: KNOWLEDGE_PROJECT_REGISTRATION_ROUTE,
        package_version: capability.package_version,
        authority_id: capability.authority_id,
        tenant_id: capability.tenant_id,
        corpus_id: capability.corpus_id,
        target_selector: projectId,
        idempotency_key: flags.idempotencyKey,
        request_digest: requestDigest,
        precondition_digest: digestKnowledgeProjectLinksValue({
          source_project_id: projectId,
          expected: 'absent_or_exact_match',
        }),
        project_id: projectId,
        project_slug: projectSlug,
        project_name: projectName,
        desired,
      });
      output({ ok: receipt.outcome === 'accepted', receipt }, flags.json, flags);
      return;
    }
    if (action === 'read-exact') {
      if (!flags.collectionId) {
        throw new Error('Usage: knowledge project-registration read-exact --collection-id <uuid> [--json]');
      }
      output({ ok: true, record: await authority.readCollection(flags.collectionId) }, flags.json, flags);
      return;
    }
    if (action === 'receipt') {
      const receiptAction = positional[2] as KnowledgeProjectReceiptAction | undefined;
      const direction = positional[3] as KnowledgeProjectRegistrationDirection | undefined;
      if (
        !flags.operationId
        || !flags.stepId
        || !flags.idempotencyKey
        || !receiptAction
        || !direction
      ) {
        throw new Error(
          'Usage: knowledge project-registration receipt <register_collection|bind_item> <forward|inverse> '
          + '--operation-id <id> --step-id <id> --idempotency-key <key> [--json]',
        );
      }
      const capability = await authority.capability();
      const receipt = await authority.lookupReceipt({
        authority_id: capability.authority_id,
        tenant_id: capability.tenant_id,
        corpus_id: capability.corpus_id,
        operation_id: flags.operationId,
        step_id: flags.stepId,
        action: receiptAction,
        direction,
        idempotency_key: flags.idempotencyKey,
        max_items: 1,
      });
      output({ ok: true, receipt }, flags.json, flags);
      return;
    }
    if (action === 'compensate' || action === 'verify-inverse') {
      if (!flags.operationId || !flags.stepId || !flags.idempotencyKey || !flags.receiptId) {
        throw new Error(
          `Usage: knowledge project-registration ${action} --operation-id <id> --step-id <id> `
          + '--idempotency-key <key> --receipt-id <accepted-receipt-id> [--json]',
        );
      }
      const capability = await authority.capability();
      const request = {
        operation_id: flags.operationId,
        step_id: flags.stepId,
        authority_route: KNOWLEDGE_PROJECT_REGISTRATION_ROUTE,
        package_version: capability.package_version,
        authority_id: capability.authority_id,
        tenant_id: capability.tenant_id,
        corpus_id: capability.corpus_id,
        idempotency_key: flags.idempotencyKey,
        accepted_receipt_id: flags.receiptId,
      };
      const result = action === 'compensate'
        ? { receipt: await authority.compensateRegistration(request) }
        : { verification: await authority.verifyRegistrationInverse(request) };
      output({ ok: true, ...result }, flags.json, flags);
      return;
    }
    throw new Error(
      'Invalid project-registration action. Use capability, create, read-exact, receipt, compensate, or verify-inverse.',
    );
  }

  if (command === 'project-membership') {
    const action = positional[1] ?? 'read-exact';
    const authority = projectLinksAuthority();
    if (action === 'bind') {
      if (!flags.operationId || !flags.stepId || !flags.idempotencyKey || !flags.collectionId || !flags.itemId) {
        throw new Error(
          'Usage: knowledge project-membership bind --operation-id <id> --step-id <id> '
          + '--idempotency-key <key> --collection-id <uuid> --item-id <id> [--json]',
        );
      }
      const capability = await authority.capability();
      const receipt = await authority.bindItem({
        operation_id: flags.operationId,
        step_id: flags.stepId,
        direction: 'forward',
        authority_route: KNOWLEDGE_PROJECT_REGISTRATION_ROUTE,
        package_version: capability.package_version,
        authority_id: capability.authority_id,
        tenant_id: capability.tenant_id,
        corpus_id: capability.corpus_id,
        idempotency_key: flags.idempotencyKey,
        request_digest: digestKnowledgeProjectLinksValue({
          action: 'bind_item',
          collection_id: flags.collectionId,
          item_id: flags.itemId,
        }),
        precondition_digest: digestKnowledgeProjectLinksValue({
          collection_id: flags.collectionId,
          item_id: flags.itemId,
          expected: 'unbound_or_exact_membership',
        }),
        collection_id: flags.collectionId,
        item_id: flags.itemId,
      });
      output({ ok: receipt.outcome === 'accepted', receipt }, flags.json, flags);
      return;
    }
    if (action === 'read-exact') {
      if (!flags.collectionId || !flags.itemId) {
        throw new Error(
          'Usage: knowledge project-membership read-exact --collection-id <uuid> --item-id <id> [--json]',
        );
      }
      output({
        ok: true,
        record: await authority.readItemBinding(flags.collectionId, flags.itemId),
      }, flags.json, flags);
      return;
    }
    if (action === 'compensate' || action === 'verify-inverse') {
      if (!flags.operationId || !flags.stepId || !flags.idempotencyKey || !flags.receiptId) {
        throw new Error(
          `Usage: knowledge project-membership ${action} --operation-id <id> --step-id <id> `
          + '--idempotency-key <key> --receipt-id <accepted-receipt-id> [--json]',
        );
      }
      const capability = await authority.capability();
      const request = {
        operation_id: flags.operationId,
        step_id: flags.stepId,
        authority_route: KNOWLEDGE_PROJECT_REGISTRATION_ROUTE,
        package_version: capability.package_version,
        authority_id: capability.authority_id,
        tenant_id: capability.tenant_id,
        corpus_id: capability.corpus_id,
        idempotency_key: flags.idempotencyKey,
        accepted_receipt_id: flags.receiptId,
      };
      const result = action === 'compensate'
        ? { receipt: await authority.compensateItemBinding(request) }
        : { verification: await authority.verifyItemBindingInverse(request) };
      output({ ok: true, ...result }, flags.json, flags);
      return;
    }
    throw new Error(
      'Invalid project-membership action. Use bind, read-exact, compensate, or verify-inverse.',
    );
  }

  if (command === 'project-resources') {
    const projectId = flags.project ?? positional[1];
    if (!projectId) {
      throw new Error(
        'Usage: knowledge project-resources <project-id> [--kind <kind>]... [--limit <n>] [--cursor <cursor>] [--all] [--json]',
      );
    }
    const authority = projectLinksAuthority();
    const kinds = flags.kind as KnowledgeProjectResourceKind[] | undefined;
    const result = flags.all
      ? {
        resources: await authority.readAllProjectResources(projectId, {
          limit: flags.limit,
          kinds,
        }),
      }
      : await authority.listProjectResources(projectId, {
        limit: flags.limit,
        cursor: flags.cursor,
        kinds,
      });
    output({ ok: true, ...result }, flags.json, flags);
    return;
  }

  if (command === 'project-resource') {
    const projectId = flags.project ?? positional[1];
    const kind = positional[2] as KnowledgeProjectResourceKind | undefined;
    const resourceId = positional[3];
    if (!projectId || !kind || !resourceId) {
      throw new Error(
        'Usage: knowledge project-resource <project-id> <project|collection|item|taxonomy> <resource-id> [--json]',
      );
    }
    output({
      ok: true,
      resource: await projectLinksAuthority().readProjectResource(projectId, kind, resourceId),
    }, flags.json, flags);
    return;
  }

  if (command === 'inventory') {
    // Single dispatch shared with the MCP + SDK: the shared item corpus through
    // HTTP when selected, otherwise the full on-box
    // inventory across json + sqlite. No surface reads a divergent store.
    const inventory = await service.resolveInventory({
      limit: flags.limit,
      includeArchived: flags.includeArchived || flags.archived,
      storePath: usesKnowledgeHttpTransport() ? undefined : storePath,
    });
    output(flags.json || flags.verbose ? inventory : formatInventory(inventory), flags.json, flags);
    return;
  }

  if (command === 'project-panel') {
    const projectRef = flags.project ?? positional[1];
    if (!projectRef) throw new Error('Usage: knowledge project-panel --project <id|name|slug> [--json|--contract]');
    // Only resolve the project's registered collection over the hosted route.
    // In local mode the cwd-derived inventory is the intended source and the
    // local project-links authority would create a knowledge.db as a side effect.
    const panel = await createKnowledgeProjectPanel(projectRef, {
      service,
      projectLinksAuthority: usesKnowledgeHttpTransport() ? projectLinksAuthority() : undefined,
      // Over the hosted route a project-links NOT_FOUND must be a loud error:
      // falling back to the cwd-derived inventory would answer about the wrong
      // project (the authority resolves exact source project ids only).
      allowLegacyFallback: !usesKnowledgeHttpTransport(),
      limit: flags.limit,
      storePath: usesKnowledgeHttpTransport() ? undefined : storePath,
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
    const result = service.setup({ canonicalExample: flags.canonicalExample });
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
      const apiKey = flags.apiKey ?? resolveClientCredential('knowledge', process.env)?.apiKey;
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
        message: `Saved API credentials for ${auth.email ?? 'API key'}`,
      }, flags.json, flags);
      return;
    }
    if (action === 'logout') {
      const removed = service.clearAuth(process.env);
      output({ ok: true, removed, message: removed ? 'Removed API credentials' : 'No API credentials found' }, flags.json, flags);
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
    if (action === 'migrate-project-path') {
      const migration = service.migrateProjectPath({
        approveWrite: flags.approveWrite,
        approvedBy: flags.approvedBy,
      });
      output(migration, flags.json);
      if (!migration.ok && !flags.json) process.exitCode = 1;
      return;
    }
    if (action === 'merge-legacy-path' || action === 'merge-legacy' || action === 'merge-path') {
      const merge = service.mergeLegacyPath({
        approveWrite: flags.approveWrite,
        approvedBy: flags.approvedBy,
      });
      output(merge, flags.json);
      if (!merge.ok && !flags.json) process.exitCode = 1;
      return;
    }
    throw new Error("Invalid storage action. Use 'status', 'validate', 'repair-artifact-keys', 'migrate-legacy-path', 'migrate-project-path', 'merge-legacy-path', or 'import-legacy'.");
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
          // 5213a51 dropped the DATABASE_URL reporting fields (configured/env/activeEnv)
          // from StorageStatus — a raw DB DSN is never a client concept — but missed this
          // call site, which kept reading `status.activeEnv` (always undefined, so the
          // ` via …` suffix had been dead since then). Message output is unchanged.
          message: `knowledge.db backend ${status.backend}`,
        }, flags.json, flags);
        return;
      }
      // The client-side Postgres sync engine (push/pull/sync) was removed: it was
      // a forbidden DSN-on-client path. The shared store is reached through the
      // HTTP ApiStore (knowledge items) — not by syncing local sqlite to RDS.
      throw new Error(
        "Invalid db storage action. Only 'status' is supported. The 'push'/'pull'/'sync' "
          + 'Postgres sync commands were removed (DSN-on-client is forbidden); configure the canonical HTTP API URL and key instead.',
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
          tags: flags.tag,
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
          workspace: resolvedWorkspace.home,
          allow_write_roots: policy.allowWriteRoots,
          read_only_source_access: policy.readOnlySourceAccess,
          network: policy.network,
          redaction: policy.redaction,
          approvals: policy.approvals,
          message: 'Safety policy loaded',
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
    const item = await itemStore.create({ title, content, url: flags.url ?? null, tags: flags.tag ?? [] });
    log('info', 'Item added', { id: item.id, title: item.title, tags: item.tags?.length ?? 0, transport: itemStore.kind });
    output({ ok: true, item, message: `Added ${item.id}` }, flags.json, flags);
    return;
  }

  if (command === 'list') {
    if (flags.format !== undefined && flags.format !== 'table' && flags.format !== 'json') {
      throw new Error("Invalid --format value for list. Use 'table' or 'json'.");
    }
    if (
      flags.page !== undefined
      && (!Number.isFinite(flags.page) || !Number.isInteger(flags.page) || flags.page < 1)
    ) {
      throw new Error('--page must be a positive integer.');
    }
    if (
      flags.limit !== undefined
      && (!Number.isFinite(flags.limit) || !Number.isInteger(flags.limit) || flags.limit < 1 || flags.limit > 200)
    ) {
      throw new Error('--limit must be an integer between 1 and 200.');
    }
    const page = flags.page ?? 1;
    const limit = flags.limit ?? 20;
    const search = flags.search ? String(flags.search).toLowerCase() : '';
    // Repeated -t narrows: an item must match EVERY requested value, matching the
    // `ok_list` MCP tool ("item must match all tags").
    //
    // A raw value matches an item when the stored tags contain the WHOLE value OR all of
    // its comma-split names — a UNION. This is deliberately NOT the rule `untag` uses:
    // there a whole-value hit short-circuits (`continue`), so the two shapes are mutually
    // exclusive per RAW -t VALUE — not per run, since `untag` still accumulates across
    // repeated -t. (Repeated -t here in `list` NARROWS instead: 3 -> 2 -> 1 matches as
    // values are added. Do not read "accumulates" as describing this command.)
    //
    // Each rule is right for its own command. `untag` mutates, so it must take one shape
    // per -t value — that exclusivity is exactly what makes its documented "re-run to clear
    // the split names" behaviour true, and a test pins it. `list` only reads, so matching both
    // shapes destroys nothing, while narrowing to one would hide items. An item damaged by
    // the multi-tag defect carries one literal `"a,b,c"` tag that none of the split names
    // equals, so a split-only filter never matches it — and what it returns INSTEAD depends
    // on the rest of the corpus, silently either way. Measured with the whole-value branch
    // removed from the predicate below: total: 0 at exit 0 when the glued item is the only
    // candidate, and total: 1 at exit 0 naming a DIFFERENT item once some other item carries
    // the three names separately. Which one you get is a property of the corpus, not of the
    // query, so neither is usable as a signal. The union lets one query find both shapes,
    // which is the one job `list -t` is needed for here.
    //
    // So do not "align" the two: making this an exclusive match would break `list`, and
    // dropping `untag`'s `continue` would break its re-run contract.
    const tagFilters = flags.tagRaw ?? flags.tag ?? [];
    const tagLabel = flags.tag?.length ? flags.tag.map((entry) => entry.toLowerCase()).join(',') : 'none';
    const useTable = flags.format === 'table' || (!flags.json && !flags.format && useColor(flags));
    const useJson = flags.json || flags.format === 'json';
    // Flag precedence, documented because it is not the intuitive one: --archived WINS over
    // --include-archived when both are passed (the `else if` never reaches the wider flag),
    // in either argument order. `--archived --include-archived` therefore returns archived
    // items ONLY, not a widened sweep. A reader would reasonably expect the wider flag to
    // win, so this is documented rather than changed — flipping it would alter behaviour.
    const archive = flags.archived ? 'archived' : (flags.includeArchived ? 'all' : 'active');
    const { sort, direction } = sortItems([], flags);
    const start = (page - 1) * limit;
    if (start > 10_000) throw new Error('The requested page exceeds the maximum bounded offset of 10000.');
    const db = await itemStore.list({
      search,
      tags: tagFilters,
      archive,
      sort,
      direction,
      limit,
      offset: start,
    });
    const rows = db.items;
    const totalPages = Math.max(1, Math.ceil(db.total / limit));
    const result = { ok: true, page, limit, total: db.total, total_pages: totalPages, sort, direction, items: rows, store_exists: db.exists };

    if (useJson) { output(result, true); return; }
    if (flags.verbose) { output(result, false, flags); return; }
    if (rows.length === 0) { output(`No items found (search=${search || 'none'}, tag=${tagLabel})`, false); return; }
    if (useTable) {
      const col = (v: string) => v;
      const header = `${col('ID')}\t${col('TITLE')}\t${col('CREATED')}\t${col('URL')}\t${col('TAGS')}`;
      console.log(header);
      for (const row of rows) {
        console.log(`${row.id}\t${col(truncate(row.title, 80))}\t${row.created_at}\t${row.url ? col(truncate(row.url, 90)) : ''}\t${row.tags?.length ? col(truncate(`[${row.tags.join(', ')}]`, 80)) : ''}`);
      }
      console.log(`Page ${page}/${totalPages} | showing ${rows.length} of ${db.total} | sort=${sort} ${direction} | search=${search || 'none'} | tag=${tagLabel}`);
      console.log('Hint: use `knowledge get --id <id> --json` for full item content.');
    } else {
      for (const row of rows) {
        console.log(`${row.id}\t${truncate(row.title, 80)}\t${row.created_at}${row.url ? `\t${truncate(row.url, 90)}` : ''}${row.tags?.length ? `\t${truncate(`[${row.tags.join(', ')}]`, 80)}` : ''}`);
      }
      console.log(`Page ${page}/${totalPages} | showing ${rows.length} of ${db.total} | sort=${sort} ${direction} | search=${search || 'none'} | tag=${tagLabel}`);
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

  if (command === 'versions') {
    // `versions purge` — the secret-hygiene capability: permanently delete
    // retained prior versions so a credential-shaped value in history stops
    // being reachable. Deletes by id/version and never reads the retained body.
    if (positional[1] === 'purge') {
      requireId(flags);
      if (!flags.yes) {
        throw new Error('Refusing to purge retained versions without --yes. Re-run with: knowledge versions purge --id <id> [--rev <n>] --yes');
      }
      let purgeVersion: number | undefined;
      if (flags.rev !== undefined) {
        if (!Number.isInteger(flags.rev) || (flags.rev as number) < 1) {
          throw new Error('--rev must be a positive retained version number.');
        }
        purgeVersion = flags.rev as number;
      }
      const purged = await itemStore.purgeVersions(flags.id!, purgeVersion === undefined ? {} : { version: purgeVersion });
      if (!purged) throw new Error(`Item not found: ${flags.id}`);
      if (purgeVersion !== undefined && purged.purged === 0) {
        throw new Error(`No retained version ${purgeVersion} of ${flags.id} (the item is at version ${purged.current_version})`);
      }
      const message = purgeVersion === undefined
        ? `${flags.id} purged ${purged.purged} retained version(s); live content at version ${purged.current_version} untouched`
        : `${flags.id} purged retained version ${purgeVersion}; live content at version ${purged.current_version} untouched`;
      const purgeResult = {
        ok: true,
        id: flags.id,
        purged: purged.purged,
        current_version: purged.current_version,
        message,
      };
      if (flags.json || flags.verbose) { output(purgeResult, flags.json, flags); return; }
      console.log(message);
      return;
    }

    requireId(flags);
    const versionsPage = Number.isFinite(flags.page) && (flags.page as number) > 0 ? (flags.page as number) : 1;
    const versionsLimit = Number.isFinite(flags.limit) && (flags.limit as number) > 0 ? (flags.limit as number) : undefined;
    // The server caps a page at 200. Without an offset an entry past that
    // many retained versions has history it reports in `total` but cannot
    // return, which is a retrieval hole rather than a display one.
    const history = await itemStore.listVersions(flags.id!, {
      limit: versionsLimit,
      offset: (versionsPage - 1) * (versionsLimit ?? 50),
    });
    // null is NO SUCH ITEM. It is reported as an error, never as an empty
    // history — "never edited" and "does not exist" must not print the same
    // line, which is precisely how the sibling implementation's empty result
    // became unreadable as evidence.
    if (!history) throw new Error(`Item not found: ${flags.id}`);
    // Retained snapshots keep bodies verbatim (purge is the only destructive
    // verb), so a credential-shaped value in history must not re-enter a
    // transcript through this read — apply the redaction path at the rendering
    // boundary, exactly as `safety redact` does (incident 731221).
    const versions = redactVersionHistory(history.items, service.safetyPolicy());
    const result = {
      ok: true,
      id: history.item_id,
      current_version: history.current_version,
      total: history.total,
      page: versionsPage,
      store: itemStore.location,
      versions,
      message: history.total === 0
        ? `${history.item_id} is at version ${history.current_version} with no retained prior versions`
        : `${history.item_id} is at version ${history.current_version}; ${history.total} prior version(s) retained`,
    };
    if (flags.json || flags.verbose) { output(result, flags.json, flags); return; }
    console.log(result.message);
    for (const version of history.items) {
      const who = version.actor ? ` by ${version.actor}` : '';
      const why = version.reason ? ` (${version.reason})` : '';
      console.log(`v${version.version}\t${version.valid_to}${who}${why}\t${version.content_bytes} bytes\t${version.content_hash.slice(0, 12)}`);
    }
    if (history.items.length > 0) console.log('Hint: `knowledge diff --id <id> --rev <n>` shows what changed.');
    return;
  }

  if (command === 'diff') {
    requireId(flags);
    const current = await itemStore.get(flags.id!);
    if (!current) throw new Error(`Item not found: ${flags.id}`);
    if (flags.rev !== undefined && (flags.from !== undefined || flags.to !== undefined)) {
      throw new Error('Use either --rev <n> or --from <a> --to <b>, not both.');
    }

    // Snapshots exist only for versions the entry has LEFT: the state of the
    // version it is at now is the live row, not a history row. So resolving a
    // side means "history row if there is one, live row if the number is the
    // current version" — otherwise `--rev <current>` would report "no such
    // version" for the version the entry is demonstrably at.
    const liveSnapshot = (): EntrySnapshot => ({
      title: current.title,
      content: current.content,
      url: current.url,
      tags: current.tags ?? [],
      metadata: current.metadata ?? {},
      archived: current.archived ?? false,
    });
    const liveLabel = `v${current.version ?? '?'} (current)`;

    const resolveSide = async (ref: string): Promise<{ label: string; snapshot: EntrySnapshot }> => {
      if (ref === 'current') return { label: liveLabel, snapshot: liveSnapshot() };
      const wanted = Number(ref);
      if (!Number.isInteger(wanted) || wanted < 1) throw new Error(`Not a version number: ${ref}`);
      if (current.version !== undefined && wanted === current.version) {
        return { label: liveLabel, snapshot: liveSnapshot() };
      }
      const snapshot = await itemStore.getVersion(current.id, wanted);
      if (!snapshot) {
        throw new Error(
          `No version ${wanted} retained for ${current.id} (it is at version ${current.version ?? '?'}). `
          + 'Run `knowledge versions --id <id>` to see what is retained.',
        );
      }
      return {
        label: `v${snapshot.version}`,
        snapshot: {
          title: snapshot.title,
          content: snapshot.content,
          url: snapshot.url,
          tags: snapshot.tags,
          metadata: snapshot.metadata,
          archived: snapshot.archived,
        },
      };
    };

    let fromRef: string;
    let toRef: string;
    if (flags.rev !== undefined) {
      // mementos semantics: --rev N compares N with N-1.
      if (!Number.isInteger(flags.rev) || flags.rev < 1) throw new Error('--rev must be a positive version number.');
      if (flags.rev === 1) throw new Error('Version 1 has no predecessor to diff against.');
      fromRef = String(flags.rev - 1);
      toRef = String(flags.rev);
    } else if (flags.from !== undefined || flags.to !== undefined) {
      if (flags.from === undefined || flags.to === undefined) throw new Error('--from and --to must be given together.');
      fromRef = flags.from;
      toRef = flags.to;
    } else {
      // Default: the newest retained version vs the live item — "what did the
      // last edit change".
      const history = await itemStore.listVersions(current.id, { limit: 1 });
      if (!history) throw new Error(`Item not found: ${flags.id}`);
      if (history.items.length === 0) {
        throw new Error(`${current.id} is at version ${history.current_version} with no retained prior versions to diff against.`);
      }
      fromRef = String(history.items[0]!.version);
      toRef = 'current';
    }

    const left = await resolveSide(fromRef);
    const right = await resolveSide(toRef);
    const diff = diffEntries(left.snapshot, right.snapshot);
    // The diff renders retained snapshot bodies line by line; a credential-
    // shaped value in history must not re-enter a transcript through that
    // rendering either (same incident class as the versions read, 731221).
    // Comparison stays on the true bodies; only the rendered text is masked.
    const renderedDiff = redactEntryDiff(diff, service.safetyPolicy());
    if (flags.json || flags.verbose) {
      output({ ok: true, id: current.id, from: left.label, to: right.label, ...renderedDiff }, flags.json, flags);
      return;
    }
    console.log(formatEntryDiff(renderedDiff, `${current.id} ${left.label}`, `${current.id} ${right.label}`));
    return;
  }

  if (command === 'update') {
    requireId(flags);
    const current = await itemStore.get(flags.id!);
    if (!current) throw new Error(`Item not found: ${flags.id}`);
    // `--if-version` must be a real positive integer, checked before it ever
    // reaches the store — a NaN/zero/negative guard value can never equal a
    // stored version, so a mistyped flag would otherwise ALWAYS read as a
    // conflict, and someone would eventually "fix" that by removing the
    // flag instead of their typo.
    if (flags.ifVersion !== undefined && (!Number.isInteger(flags.ifVersion) || flags.ifVersion < 1)) {
      throw new Error(`Invalid --if-version ${JSON.stringify(String(flags.ifVersion))}: must be a positive integer version number, e.g. the "version" field from a prior 'knowledge get'.`);
    }
    const patch: Record<string, unknown> = {};
    if (flags.title !== undefined) patch.title = flags.title;
    if (flags.content !== undefined) patch.content = flags.content;
    if (flags.url !== undefined) patch.url = flags.url;
    let added: string[] | undefined;
    if (flags.tag !== undefined) {
      added = tagsToAppend(current.tags, flags.tag);
      if (added.length > 0) patch.tags = [...(current.tags ?? []), ...added];
    }
    // This command is already read-then-write, so ABSENT an explicit
    // --if-version it sends the version it just read as the concurrency
    // guard for free — the agent never types a version number. That only
    // guards the instant inside THIS invocation, though: it re-reads `current`
    // above and hands back exactly that version, so it can never catch a
    // decision an agent made from an EARLIER separate `get` — by the time this
    // command re-reads the item, any intervening write is already reflected in
    // `current.version`, and the guard trivially "passes" against itself.
    // `--if-version <n>` is the fix: it lets the caller assert the version IT
    // actually saw, rather than the version this command happens to see right
    // now. A conflict surfaces as a non-zero exit naming both versions; there
    // is deliberately NO automatic retry, because re-applying without
    // comparing the fields that moved is how you overwrite a colleague while
    // believing you handled the conflict.
    const expectedVersion = flags.ifVersion !== undefined ? flags.ifVersion : current.version;
    const item = await itemStore.update(current.id, patch, { expectedVersion });
    // When -t was asked for, report how many tags were actually added. Without this,
    // "added 3" and "added none, they were all already there" both print `Updated <id>`
    // at exit 0 and carry the count nowhere — not in `message`, not in JSON — the same
    // untruthful-success class as untag's `removed: 0`. Adding an existing tag is
    // idempotent, so unlike untag this stays exit 0; it just stops claiming nothing.
    output(tagCountResult({ ok: true, item }, `Updated ${item?.id ?? current.id}`, added), flags.json, flags);
    return;
  }

  if (command === 'archive' || command === 'restore') {
    requireId(flags);
    const current = await itemStore.get(flags.id!);
    if (!current) throw new Error(`Item not found: ${flags.id}`);
    const item = await itemStore.update(current.id, { archived: command === 'archive' }, { expectedVersion: current.version });
    output({ ok: true, item, message: `${command === 'archive' ? 'Archived' : 'Restored'} ${item?.id ?? current.id}` }, flags.json, flags);
    return;
  }

  if (command === 'untag') {
    requireId(flags);
    if (!flags.tag?.length) throw new Error('Missing required --tag. Example: knowledge untag --id <id> -t <tag>');
    const current = await itemStore.get(flags.id!);
    if (!current) throw new Error(`Item not found: ${flags.id}`);
    const before = current.tags ?? [];
    const stored = new Set(before.map((tag) => tag.toLowerCase()));
    // Repeated -t removes every named tag in one pass, matching the `ok_untag` MCP tool.
    //
    // Each raw value is matched WHOLE and, only when no stored tag equals it, split on
    // commas — an EXCLUSIVE rule, enforced by the `continue` below. An item damaged by the
    // multi-tag defect carries one literal `"a,b,c"` tag, and none of the split names
    // equals it, so splitting first would remove nothing at exit 0 — the very failure
    // this change exists to prevent. Whole-value-first keeps `untag -t "a,b,c"` able to
    // clear those items, and `ok_untag` (which never split) stays in parity.
    //
    // The `continue` is load-bearing, not an optimisation: it is what keeps the two shapes
    // mutually exclusive PER RAW -t VALUE, and therefore what makes the documented "re-run
    // to clear the split names" behaviour true. Drop it and one `-t "a,b,c"` against an item
    // carrying both shapes goes from removed: 1 to removed: 4.
    //
    // Note the scope precisely: the `continue` sits INSIDE this loop, so it bounds one raw
    // value, not the whole invocation. Repeated -t still accumulates, so `-t "a,b,c" -t a`
    // removes 2 and `-t "a,b,c" -t a -t b -t c` removes 4 in a single run. That is intended —
    // naming the split names is how a caller asks for both shapes. The narrower guarantee is
    // the one the re-run contract needs: a lone `-t "a,b,c"` takes the glued tag and leaves
    // the split names, so re-running the same command is meaningful (1, then 3, then exit 1).
    //
    // `list -t` matches the two shapes as a UNION instead — correct there, because a filter
    // has nothing to destroy and suppressing a shape would defeat the search it exists for.
    // Same inputs, two different rules, both deliberate.
    const remove = new Set<string>();
    for (const raw of flags.tagRaw ?? flags.tag) {
      const whole = raw.trim().toLowerCase();
      if (whole.length > 0 && stored.has(whole)) { remove.add(whole); continue; }
      for (const name of raw.split(',').map((tag) => tag.trim().toLowerCase()).filter((tag) => tag.length > 0)) remove.add(name);
    }
    const tags = before.filter((tag) => !remove.has(tag.toLowerCase()));
    const removed = before.length - tags.length;
    const notFound = [...remove].filter((tag) => !stored.has(tag));
    // `Removed tag from <id>` at exit 0 on removed:0 is the same defect as the original
    // bug: a success signal that cannot distinguish 1 removed from 0. An absent target
    // is an error here, as a missing --id already is.
    //
    // Both sides of this message are quoted. Joining the stored tags raw renders one
    // glued `"a,b,c"` tag identically to three separate tags, so on exactly the damaged
    // items this fallback exists for the message read `"a" not in [a,b,c]` — denying
    // something plainly present. Quoting each stored tag makes the glued-versus-split
    // distinction visible, and the same for stored tags differing only in whitespace.
    if (removed === 0) {
      throw new Error(`No matching tag on ${current.id}: ${notFound.map((tag) => JSON.stringify(tag)).join(', ')} not in [${before.map((tag) => JSON.stringify(tag)).join(', ')}]`);
    }
    const item = await itemStore.update(current.id, { tags }, { expectedVersion: current.version });
    // A partial miss must be visible too, not just the all-miss case — and it has to be
    // in `message`, because non-JSON output prints nothing else.
    //
    // Quoted, but NOT for the comma reason the failure message above has: `notFound` can
    // never hold a comma. A comma-bearing value only reaches `remove` through the
    // whole-value branch, which requires `stored.has(whole)`, so it is found by definition
    // and filtered out of `notFound`; every other entry is a comma-split part. ONE tag
    // literally named `p, q` is therefore unreachable here — and since every entry is
    // comma-free, joining on ', ' is injective, so a plain space is a legibility problem
    // rather than a collision (`["p","q"]` -> `p, q`, `["p q"]` -> `p q`, distinct strings).
    //
    // What makes the quoting load-bearing is whitespace the parser does NOT strip: `trim()`
    // only touches the ends, so `-t $'p\nq'` yields `notFound: ["p\nq"]` and joining raw
    // would break this single-line message in two, with the tail reading as separate output.
    // Tab is the same. JSON.stringify escapes both, and a test pins it. Quoting also keeps
    // the two messages symmetric, so no reader has to work out which line happens to be
    // collision-proof. `not_found` in the JSON was already unambiguous; this is the human
    // line catching up.
    const missed = notFound.length > 0 ? ` (not found: ${notFound.map((tag) => JSON.stringify(tag)).join(', ')})` : '';
    const result: Record<string, unknown> = { ok: true, item, removed, message: `Removed ${removed} tag${removed === 1 ? '' : 's'} from ${item?.id ?? current.id}${missed}` };
    if (notFound.length > 0) result.not_found = notFound;
    output(result, flags.json, flags);
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
        tags: flags.tag ?? [],
      });
      output(tagCountResult({ ok: true, created: true, item }, `Upserted ${item.id}`, flags.tag), flags.json, flags);
      return;
    }
    const patch: Record<string, unknown> = {};
    if (title !== undefined) patch.title = title;
    if (content !== undefined) patch.content = content;
    if (flags.url !== undefined) patch.url = flags.url;
    let added: string[] | undefined;
    if (flags.tag !== undefined) {
      added = tagsToAppend(existing.tags, flags.tag);
      if (added.length > 0) patch.tags = [...(existing.tags ?? []), ...added];
    }
    const item = await itemStore.update(existing.id, patch, { expectedVersion: existing.version });
    output(tagCountResult({ ok: true, created: false, item }, `Upserted ${item?.id ?? existing.id}`, added), flags.json, flags);
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
      const key = `${x.title}\u0000${x.content}`;
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
  } finally {
    await standaloneProjectLinksAuthority?.close();
    await service.close();
  }
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
 *
 * A version-conflict rejection (from `--if-version`, or from the automatic
 * guard every read-then-write item command sends) is a DISTINCT non-zero exit
 * (2) rather than the generic catch-all (1) every other CLI error uses, and
 * carries the two version numbers structurally in `--json` (`code`,
 * `expected`, `current`) as well as in the message — so a caller can tell
 * "the concurrency guard fired" apart from "something else went wrong"
 * without parsing prose.
 */
function emitCliError(error: unknown, argv: string[]): void {
  const message = error instanceof Error ? error.message : String(error);
  // Keep the internal stack (which includes the bundled bin path and minified
  // function names) behind debug logging. Usage/validation and other expected
  // errors should present a plain message only. Set DEBUG=1 or LOG_LEVEL=debug
  // to surface the full diagnostic for troubleshooting.
  log('debug', 'CLI error', { message, stack: error instanceof Error ? error.stack : undefined });
  console.error(`Error: ${message}`);
  const conflict = error instanceof KnowledgeVersionConflictError ? error : null;
  const projectLinksError = error instanceof KnowledgeProjectLinksError ? error : null;
  if (argv.includes('--json')) {
    output({
      ok: false,
      error: message,
      message,
      ...(conflict
        ? { code: 'version_conflict', expected: conflict.expected, current: conflict.current }
        : projectLinksError
          ? { code: projectLinksError.code, details: projectLinksError.details }
          : {}),
    }, true);
  }
  process.exitCode = conflict ? 2 : 1;
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  run(argv).catch((error) => emitCliError(error, argv));
}

export { run, parseArgs, suggestCommand, sortItems, emitCliError };
