#!/usr/bin/env bun
/**
 * @hasna/knowledge
 * Copyright 2026 Hasna Inc.
 * Licensed under the Apache License, Version 2.0
 */
import { defaultStorePath, loadStore, saveStore, withLock, makeId, makeShortId, ensureStore, type KnowledgeItem } from './store';
import { ensureKnowledgeWorkspace, readKnowledgeConfig, resolveScopedWorkspace } from './workspace';
import { getKnowledgeDbStats, migrateKnowledgeDb, openKnowledgeDb } from './knowledge-db';
import { createArtifactStore } from './artifact-store';
import { initializeWikiLayout } from './wiki-layout';
import { ingestOpenFilesManifest } from './manifest-ingest';
import { consumeOpenFilesOutbox } from './outbox-consume';
import { resolveOpenFilesSource } from './source-resolver';
import { approvalStatus, assertS3ReadAllowed, assertWebSearchAllowed, createApprovalGate, recordAuditEvent, recordRedactionFindings, redactSecrets, resolveSafetyPolicy } from './safety';
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
  noColor?: boolean;
  scope?: string;
  olderThan?: number;
  empty?: boolean;
  archived?: boolean;
  includeArchived?: boolean;
}

interface ParseResult {
  positional: string[];
  flags: Flags;
}

const COMMANDS = ['add', 'list', 'get', 'delete', 'update', 'archive', 'restore', 'upsert', 'untag', 'export', 'prune', 'dedupe', 'stats', 'paths', 'db', 'wiki', 'source', 'ingest', 'reindex', 'safety', 'help'];
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
      case '--no-color': flags.noColor = true; break;
      case '--scope': flags.scope = argv[i + 1]; i += 1; break;
      case '--older-than': flags.olderThan = Number(argv[i + 1]); i += 1; break;
      case '--empty': flags.empty = true; break;
      case '--archived': flags.archived = true; break;
      case '--include-archived': flags.includeArchived = true; break;
      default: throw new Error(`Unknown flag: ${token}. Run 'open-knowledge --help' for valid options.`);
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

function printGlobalHelp(): void {
  console.log(`open-knowledge - local agent knowledge store

Usage:
  open-knowledge <command> [options]

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
  paths                        Show resolved workspace/store paths
  db init|stats                Initialize or inspect local knowledge.db
  wiki init                    Initialize scalable wiki/schema/index/log artifacts
  source resolve <source-ref>  Resolve read-only source content and citation evidence
  ingest manifest <file|s3://> Ingest an open-files manifest into knowledge.db
  reindex outbox <file|s3://>  Consume open-files change events and invalidate chunks
  safety status|check|approve|audit|redact
  help [command]               Show help

Global Options:
  --json                      Output JSON
  --store <path>              Override store path
  --purpose <name>            Read-only source purpose (default: knowledge_answer)
  --scope local|global|project  Store scope (default: global ~/.hasna/apps/knowledge/)
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
  if (command === 'add') { console.log('Usage: open-knowledge add <title> <content> [--url <url>] [-t <tag>] [--json]'); return; }
  if (command === 'list' || command === 'ls') { console.log('Usage: open-knowledge list|ls [--format table|json] [-p <page>] [-l <limit>] [-s <search>] [-t <tag>] [--sort created|title] [--desc] [--json]'); return; }
  if (command === 'get') { console.log('Usage: open-knowledge get --id <id> [--json]'); return; }
  if (command === 'update' || command === 'edit') { console.log('Usage: open-knowledge update|edit --id <id> [--title <title>] [--content <content>] [--url <url>] [-t <tag>] [--json]'); return; }
  if (command === 'archive') { console.log('Usage: open-knowledge archive --id <id> [--json]'); return; }
  if (command === 'restore' || command === 'unarchive') { console.log('Usage: open-knowledge restore|unarchive --id <id> [--json]'); return; }
  if (command === 'upsert') { console.log('Usage: open-knowledge upsert [title] [content] [--id <id>] [--title <title>] [--content <content>] [--url <url>] [-t <tag>] [--json]'); return; }
  if (command === 'untag') { console.log('Usage: open-knowledge untag --id <id> -t <tag> [--json]'); return; }
  if (command === 'delete' || command === 'rm') { console.log('Usage: open-knowledge delete|rm --id <id> -y [--json]'); return; }
  if (command === 'export') { console.log('Usage: open-knowledge export [--format jsonl] [--json]'); return; }
  if (command === 'prune') { console.log('Usage: open-knowledge prune --yes [--older-than <days>] [--empty] [--json]'); return; }
  if (command === 'dedupe') { console.log('Usage: open-knowledge dedupe --yes [--json]'); return; }
  if (command === 'stats') { console.log('Usage: open-knowledge stats [--json]'); return; }
  if (command === 'paths') { console.log('Usage: open-knowledge paths [--scope local|global|project] [--json]'); return; }
  if (command === 'db') { console.log('Usage: open-knowledge db init|stats [--scope local|global|project] [--json]'); return; }
  if (command === 'wiki') { console.log('Usage: open-knowledge wiki init [--scope local|global|project] [--json]'); return; }
  if (command === 'source') { console.log('Usage: open-knowledge source resolve <source-ref> [--purpose knowledge_answer|knowledge_index] [--limit <n>] [--scope local|global|project] [--json]'); return; }
  if (command === 'ingest') { console.log('Usage: open-knowledge ingest manifest <file|s3://bucket/key> [--scope local|global|project] [--json]'); return; }
  if (command === 'reindex') { console.log('Usage: open-knowledge reindex outbox <file|s3://bucket/key> [--scope local|global|project] [--json]'); return; }
  if (command === 'safety') { console.log('Usage: open-knowledge safety status|check|approve|audit|redact [args] [--scope local|global|project] [--json]'); return; }
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

function requireId(flags: Flags): asserts flags is Flags & { id: string } {
  if (!flags.id) throw new Error('Missing required --id. Example: open-knowledge get --id <id>');
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
      console.log(`_open_knowledge() { local cur; cur="${"$"}{COMP_WORDS[COMP_CWORD]}"; COMPREPLY=($(compgen -W "add list get update archive restore upsert untag delete export prune dedupe stats paths db wiki source ingest reindex safety help ls rm edit unarchive --json --yes --help --version --desc --page --limit --search --sort --id --store --title --content --url --tag --format --completions --purpose --no-color --scope --archived --include-archived" -- "$cur")); }; complete -F _open_knowledge open-knowledge`);
    } else if (shell === 'zsh') {
      console.log(`#compdef open-knowledge\n_open_knowledge() { _arguments -C "1: :(add list get update archive restore upsert untag delete export prune dedupe stats paths db wiki source ingest reindex safety help ls rm edit unarchive)" "(--json)--json" "(--yes)-y" "(--help)--help" "(--version)--version" "(--desc)--desc" "(--archived)--archived" "(--include-archived)--include-archived" "(-p --page)"{-p,--page}"[page number]:number:" "(-l --limit)"{-l,--limit}"[items per page]:number:" "(-s --search)"{-s,--search}"[search text]:text:" "(--sort)--sort"\{created,title\}:" "(--id)--id[item id]:id:" "(--store)--store[store path]:path:" "(--title)--title[new title]:" "(--content)--content[new content]:" "(--url)--url[source url]:" "(-t --tag)"{-t,--tag}"[tag]:tag:" "(--format)--format[json|jsonl]:" "(--completions)--completions[output completions]:shell:(bash zsh fish):" "(--purpose)--purpose[purpose]:" "(--no-color)--no-color[disable color]" "(--scope)--scope"\{local,global,project\}:" }; _open_knowledge`);
    } else if (shell === 'fish') {
      console.log(`complete -c open-knowledge -f; complete -c open-knowledge -a "add list get update archive restore upsert untag delete export prune dedupe stats paths db wiki source ingest reindex safety help ls rm edit unarchive"; complete -c open-knowledge -l json; complete -c open-knowledge -l yes -s y; complete -c open-knowledge -l help -s h; complete -c open-knowledge -l version -s v; complete -c open-knowledge -l desc; complete -c open-knowledge -l archived; complete -c open-knowledge -l include-archived; complete -c open-knowledge -s p -l page; complete -c open-knowledge -s l -l limit; complete -c open-knowledge -s s -l search; complete -c open-knowledge -l sort; complete -c open-knowledge -l id; complete -c open-knowledge -l store; complete -c open-knowledge -l title; complete -c open-knowledge -l content; complete -c open-knowledge -l url; complete -c open-knowledge -s t -l tag; complete -c open-knowledge -l format; complete -c open-knowledge -l completions; complete -c open-knowledge -l purpose; complete -c open-knowledge -l no-color; complete -c open-knowledge -l scope -a "local global project"`);
    } else {
      throw new Error("Invalid --completions value. Use 'bash', 'zsh', or 'fish'.");
    }
    return;
  }

  const command = resolveCommand(positional[0]);

  if (!command || flags.help || command === 'help') { printCommandHelp(positional[1]); return; }

  const workspace = resolveScopedWorkspace(flags.scope);
  let storePath = flags.store;
  if (!storePath) {
    if (flags.scope === 'project' || flags.scope === 'local') {
      storePath = ensureKnowledgeWorkspace(workspace.home).jsonStorePath;
    } else {
      storePath = defaultStorePath();
    }
  }

  if (command === 'paths') {
    const resolvedWorkspace = ensureKnowledgeWorkspace(workspace.home);
    output({
      ok: true,
      scope: flags.scope ?? 'global',
      home: resolvedWorkspace.home,
      config_path: resolvedWorkspace.configPath,
      json_store_path: resolvedWorkspace.jsonStorePath,
      knowledge_db_path: resolvedWorkspace.knowledgeDbPath,
      artifacts_dir: resolvedWorkspace.artifactsDir,
      indexes_dir: resolvedWorkspace.indexesDir,
      logs_dir: resolvedWorkspace.logsDir,
      runs_dir: resolvedWorkspace.runsDir,
      schemas_dir: resolvedWorkspace.schemasDir,
      wiki_dir: resolvedWorkspace.wikiDir,
      config: readKnowledgeConfig(resolvedWorkspace.configPath),
      message: resolvedWorkspace.home,
    }, flags.json);
    return;
  }

  if (command === 'db') {
    const action = positional[1] ?? 'init';
    const resolvedWorkspace = ensureKnowledgeWorkspace(workspace.home);
    if (action !== 'init' && action !== 'stats') {
      throw new Error("Invalid db action. Use 'init' or 'stats'.");
    }
    if (action === 'init') {
      const result = migrateKnowledgeDb(resolvedWorkspace.knowledgeDbPath);
      output({ ok: true, ...result, message: `Initialized ${result.path}` }, flags.json);
      return;
    }
    migrateKnowledgeDb(resolvedWorkspace.knowledgeDbPath);
    const stats = getKnowledgeDbStats(resolvedWorkspace.knowledgeDbPath);
    output({ ok: true, path: resolvedWorkspace.knowledgeDbPath, ...stats, message: `knowledge.db schema v${stats.schema_version}` }, flags.json);
    return;
  }

  if (command === 'wiki') {
    const action = positional[1] ?? 'init';
    if (action !== 'init') throw new Error("Invalid wiki action. Use 'init'.");
    const resolvedWorkspace = ensureKnowledgeWorkspace(workspace.home);
    const config = readKnowledgeConfig(resolvedWorkspace.configPath);
    const artifactStore = createArtifactStore(config, resolvedWorkspace);
    const result = await initializeWikiLayout(artifactStore);
    output({ ok: true, ...result, message: `Initialized wiki layout in ${resolvedWorkspace.home}` }, flags.json);
    return;
  }

  if (command === 'safety') {
    const action = positional[1] ?? 'status';
    const resolvedWorkspace = ensureKnowledgeWorkspace(workspace.home);
    const config = readKnowledgeConfig(resolvedWorkspace.configPath);
    const policy = resolveSafetyPolicy(config, resolvedWorkspace);
    migrateKnowledgeDb(resolvedWorkspace.knowledgeDbPath);
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
        if (!text) throw new Error('Usage: open-knowledge safety redact <text>');
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
    if (!sourceRef) throw new Error('Usage: open-knowledge source resolve <source-ref>');
    const resolvedWorkspace = ensureKnowledgeWorkspace(workspace.home);
    const config = readKnowledgeConfig(resolvedWorkspace.configPath);
    const safetyPolicy = resolveSafetyPolicy(config, resolvedWorkspace);
    const result = await resolveOpenFilesSource({
      dbPath: resolvedWorkspace.knowledgeDbPath,
      sourceRef,
      purpose: flags.purpose,
      limit: flags.limit,
      safetyPolicy,
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
    if (action !== 'manifest') throw new Error("Invalid ingest action. Use 'manifest'.");
    const input = positional[2];
    if (!input) throw new Error('Usage: open-knowledge ingest manifest <file|s3://bucket/key>');
    const resolvedWorkspace = ensureKnowledgeWorkspace(workspace.home);
    const config = readKnowledgeConfig(resolvedWorkspace.configPath);
    const safetyPolicy = resolveSafetyPolicy(config, resolvedWorkspace);
    const result = await ingestOpenFilesManifest({
      dbPath: resolvedWorkspace.knowledgeDbPath,
      input,
      config,
      safetyPolicy,
    });
    output({ ok: true, ...result, message: `Ingested ${result.items_seen} manifest item(s)` }, flags.json);
    return;
  }

  if (command === 'reindex') {
    const action = positional[1] ?? '';
    if (action !== 'outbox') throw new Error("Invalid reindex action. Use 'outbox'.");
    const input = positional[2];
    if (!input) throw new Error('Usage: open-knowledge reindex outbox <file|s3://bucket/key>');
    const resolvedWorkspace = ensureKnowledgeWorkspace(workspace.home);
    const config = readKnowledgeConfig(resolvedWorkspace.configPath);
    const safetyPolicy = resolveSafetyPolicy(config, resolvedWorkspace);
    const result = await consumeOpenFilesOutbox({
      dbPath: resolvedWorkspace.knowledgeDbPath,
      input,
      config,
      safetyPolicy,
    });
    output({ ok: true, ...result, message: `Consumed ${result.events_seen} outbox event(s)` }, flags.json);
    return;
  }

  ensureStore(storePath);

  if (command === 'add') {
    const title = positional[1];
    const content = positional[2];
    if (!title || !content) throw new Error('Usage: open-knowledge add <title> <content>');
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
    if (!flags.tag) throw new Error('Missing required --tag. Example: open-knowledge untag --id <id> -t <tag>');
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
        if (!title || !content) throw new Error('New item requires title and content. Example: open-knowledge upsert <title> <content> [--id <id>]');
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
    if (!flags.yes) throw new Error('Refusing delete without --yes. Re-run with: open-knowledge delete --id <id> --yes');
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
    if (!flags.yes) throw new Error('Refusing prune without --yes. Re-run with: open-knowledge prune --yes [--older-than <days>] [--empty]');
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
    if (!flags.yes) throw new Error('Refusing dedupe without --yes. Re-run with: open-knowledge dedupe --yes [--json]');
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
  throw new Error(`Unknown command: ${positional[0]}.${hint} Run 'open-knowledge --help' for available commands.`);
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
