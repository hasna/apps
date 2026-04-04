#!/usr/bin/env bun
import { defaultStorePath, loadStore, saveStore, withLock, makeId } from './store.js';
import pkg from '../package.json' with { type: 'json' };

const COMMANDS = ['add', 'list', 'get', 'delete', 'update', 'export', 'help'];
const COMMAND_ALIASES = {
  ls: 'list',
  rm: 'delete',
  edit: 'update',
};

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('-')) {
      positional.push(token);
      continue;
    }
    if (token === '--json') {
      flags.json = true;
      continue;
    }
    if (token === '--yes' || token === '-y') {
      flags.yes = true;
      continue;
    }
    if (token === '--help' || token === '-h') {
      flags.help = true;
      continue;
    }
    if (token === '--version' || token === '-v') {
      flags.version = true;
      continue;
    }
    if (token === '--desc') {
      flags.desc = true;
      continue;
    }
    if (token === '--page' || token === '-p') {
      flags.page = Number(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token === '--limit' || token === '-l') {
      flags.limit = Number(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token === '--search' || token === '-s') {
      flags.search = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === '--sort') {
      flags.sort = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === '--id') {
      flags.id = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === '--store') {
      flags.store = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === '--title') {
      flags.title = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === '--content') {
      flags.content = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === '--url') {
      flags.url = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === '--tag' || token === '-t') {
      flags.tag = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === '--format') {
      flags.format = argv[i + 1];
      i += 1;
      continue;
    }
    throw new Error(`Unknown flag: ${token}. Run 'open-knowledge --help' for valid options.`);
  }
  return { positional, flags };
}

function resolveCommand(raw) {
  if (!raw) return '';
  return COMMAND_ALIASES[raw] ?? raw;
}

function levenshtein(a, b) {
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

function suggestCommand(input) {
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

function printGlobalHelp() {
  console.log(`open-knowledge - local agent knowledge store

Usage:
  open-knowledge <command> [options]

Commands:
  add <title> <content>       Add an item
  list (alias: ls)             List items (supports pagination/search/sort/tag)
  get --id <id>               Get one item
  update --id <id>            Update an item (--title, --content, --url, --tag)
  delete (alias: rm) --id <id> Delete item (requires --yes)
  export                       Export all items (--format jsonl)
  help [command]               Show help

Global Options:
  --json                      Output JSON
  --store <path>              Override store path
  -v, --version               Show version
  -h, --help                  Show help

List Options:
  -p, --page <n>              Page number (default: 1)
  -l, --limit <n>             Items per page (default: 20)
  -s, --search <text>         Filter by title/content
  -t, --tag <tag>             Filter by tag
  --sort <created|title>       Sort field (default: created)
  --desc                       Sort descending

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
  --format jsonl              Export as newline-delimited JSON (default: JSON array)`);
}

function printCommandHelp(command) {
  if (command === 'add') {
    console.log('Usage: open-knowledge add <title> <content> [--url <url>] [-t <tag>] [--json]');
    return;
  }
  if (command === 'list' || command === 'ls') {
    console.log('Usage: open-knowledge list|ls [-p <page>] [-l <limit>] [-s <search>] [-t <tag>] [--sort created|title] [--desc] [--json]');
    return;
  }
  if (command === 'get') {
    console.log('Usage: open-knowledge get --id <id> [--json]');
    return;
  }
  if (command === 'update' || command === 'edit') {
    console.log('Usage: open-knowledge update|edit --id <id> [--title <title>] [--content <content>] [--url <url>] [-t <tag>] [--json]');
    return;
  }
  if (command === 'delete' || command === 'rm') {
    console.log('Usage: open-knowledge delete|rm --id <id> -y [--json]');
    return;
  }
  if (command === 'export') {
    console.log('Usage: open-knowledge export [--format jsonl] [--json]');
    return;
  }
  printGlobalHelp();
}

function output(data, asJson) {
  if (asJson) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  if (typeof data === 'string') {
    console.log(data);
    return;
  }
  console.log(data.message ?? JSON.stringify(data, null, 2));
}

function requireId(flags) {
  if (!flags.id) {
    throw new Error('Missing required --id. Example: open-knowledge get --id <id>');
  }
}

function sortItems(items, flags) {
  const sort = flags.sort ?? 'created';
  if (sort !== 'created' && sort !== 'title') {
    throw new Error("Invalid --sort value. Use 'created' or 'title'.");
  }
  const sorted = [...items].sort((a, b) => {
    if (sort === 'title') {
      return a.title.localeCompare(b.title);
    }
    return a.created_at.localeCompare(b.created_at);
  });
  if (flags.desc) {
    sorted.reverse();
  }
  return { sorted, sort, direction: flags.desc ? 'desc' : 'asc' };
}

function run(argv) {
  const { positional, flags } = parseArgs(argv);

  if (flags.version) {
    output({ name: pkg.name, version: pkg.version }, flags.json);
    return;
  }

  const command = resolveCommand(positional[0]);

  if (!command || flags.help || command === 'help') {
    printCommandHelp(positional[1]);
    return;
  }

  const storePath = flags.store || defaultStorePath();

  if (command === 'add') {
    const title = positional[1];
    const content = positional[2];
    if (!title || !content) {
      throw new Error('Usage: open-knowledge add <title> <content>');
    }
    withLock(storePath, () => {
      const db = loadStore(storePath);
      const item = {
        id: makeId(),
        title,
        content,
        url: flags.url || null,
        tags: flags.tag ? [flags.tag] : [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      db.items.push(item);
      saveStore(storePath, db);
      output({ ok: true, item, message: `Added ${item.id}` }, flags.json);
    });
    return;
  }

  if (command === 'list') {
    withLock(storePath, () => {
      const db = loadStore(storePath);
      const page = Number.isFinite(flags.page) && flags.page > 0 ? flags.page : 1;
      const limit = Number.isFinite(flags.limit) && flags.limit > 0 ? flags.limit : 20;
      const search = flags.search ? String(flags.search).toLowerCase() : '';
      const tag = flags.tag ? String(flags.tag).toLowerCase() : '';

      let filtered = db.items;
      if (search) {
        filtered = filtered.filter(
          (x) => x.title.toLowerCase().includes(search) || x.content.toLowerCase().includes(search)
        );
      }
      if (tag) {
        filtered = filtered.filter((x) => x.tags && x.tags.map((t) => t.toLowerCase()).includes(tag));
      }

      const { sorted, sort, direction } = sortItems(filtered, flags);
      const start = (page - 1) * limit;
      const rows = sorted.slice(start, start + limit);
      const totalPages = Math.max(1, Math.ceil(sorted.length / limit));

      if (flags.json) {
        output({ ok: true, page, limit, total: sorted.length, total_pages: totalPages, sort, direction, items: rows }, true);
        return;
      }
      if (rows.length === 0) {
        output(`No items found (search=${search || 'none'}, tag=${tag || 'none'})`, false);
        return;
      }
      for (const row of rows) {
        console.log(`${row.id}\t${row.title}\t${row.created_at}${row.url ? `\t${row.url}` : ''}${row.tags?.length ? `\t[${row.tags.join(', ')}]` : ''}`);
      }
      console.log(`Page ${page}/${totalPages} | showing ${rows.length} of ${sorted.length} | sort=${sort} ${direction} | search=${search || 'none'} | tag=${tag || 'none'}`);
    });
    return;
  }

  if (command === 'get') {
    requireId(flags);
    withLock(storePath, () => {
      const db = loadStore(storePath);
      const item = db.items.find((x) => x.id === flags.id);
      if (!item) {
        throw new Error(`Item not found: ${flags.id}`);
      }
      output({ ok: true, item, message: `${item.id}: ${item.title}` }, flags.json);
    });
    return;
  }

  if (command === 'update') {
    requireId(flags);
    withLock(storePath, () => {
      const db = loadStore(storePath);
      const idx = db.items.findIndex((x) => x.id === flags.id);
      if (idx === -1) {
        throw new Error(`Item not found: ${flags.id}`);
      }
      const item = db.items[idx];
      if (flags.title !== undefined) item.title = flags.title;
      if (flags.content !== undefined) item.content = flags.content;
      if (flags.url !== undefined) item.url = flags.url;
      if (flags.tag !== undefined) {
        item.tags = item.tags || [];
        if (!item.tags.map((t) => t.toLowerCase()).includes(flags.tag.toLowerCase())) {
          item.tags.push(flags.tag);
        }
      }
      item.updated_at = new Date().toISOString();
      db.items[idx] = item;
      saveStore(storePath, db);
      output({ ok: true, item, message: `Updated ${item.id}` }, flags.json);
    });
    return;
  }

  if (command === 'delete') {
    requireId(flags);
    if (!flags.yes) {
      throw new Error('Refusing delete without --yes. Re-run with: open-knowledge delete --id <id> --yes');
    }
    withLock(storePath, () => {
      const db = loadStore(storePath);
      const before = db.items.length;
      db.items = db.items.filter((x) => x.id !== flags.id);
      const deleted = before !== db.items.length;
      saveStore(storePath, db);
      if (!deleted) {
        throw new Error(`Item not found: ${flags.id}`);
      }
      output({ ok: true, deleted_id: flags.id, message: `Deleted ${flags.id}` }, flags.json);
    });
    return;
  }

  if (command === 'export') {
    const format = flags.format ?? 'json';
    if (format !== 'json' && format !== 'jsonl') {
      throw new Error("Invalid --format. Use 'json' or 'jsonl'.");
    }
    withLock(storePath, () => {
      const db = loadStore(storePath);
      if (format === 'jsonl') {
        for (const item of db.items) {
          console.log(JSON.stringify(item));
        }
      } else {
        output({ ok: true, items: db.items }, flags.json);
      }
    });
    return;
  }

  const suggestion = suggestCommand(positional[0]);
  const hint = suggestion ? ` Did you mean '${suggestion}'?` : '';
  throw new Error(`Unknown command: ${positional[0]}.${hint} Run 'open-knowledge --help' for available commands.`);
}

if (import.meta.main) {
  try {
    run(process.argv.slice(2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);
    process.exitCode = 1;
  }
}

export { run, parseArgs, suggestCommand, sortItems };
