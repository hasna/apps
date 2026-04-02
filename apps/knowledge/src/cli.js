#!/usr/bin/env bun
import { defaultStorePath, loadStore, saveStore, makeId } from './store.js';
import pkg from '../package.json' with { type: 'json' };

const COMMANDS = ['add', 'list', 'get', 'delete', 'help'];
const COMMAND_ALIASES = {
  ls: 'list',
  rm: 'delete'
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
    throw new Error(`Unknown flag: ${token}. Run 'open-knowledge --help' for valid options.`);
  }
  return { positional, flags };
}

function resolveCommand(raw) {
  if (!raw) {
    return '';
  }
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
  if (!input) {
    return '';
  }
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
  console.log(`open-knowledge - local agent knowledge store\n\nUsage:\n  open-knowledge <command> [options]\n\nCommands:\n  add <title> <content>      Add an item\n  list (alias: ls)            List items (supports pagination/search/sort)\n  get --id <id>               Get one item\n  delete (alias: rm) --id <id> Delete item (requires --yes)\n  help [command]              Show help\n\nGlobal Options:\n  --json                      Output JSON\n  --store <path>              Override store path\n  -v, --version               Show version\n  -h, --help                  Show help\n\nList Options:\n  -p, --page <n>              Page number (default: 1)\n  -l, --limit <n>             Items per page (default: 20)\n  -s, --search <text>         Filter by title/content\n  --sort <created|title>      Sort field (default: created)\n  --desc                       Sort descending\n\nDelete Options:\n  --id <id>                   Item id\n  -y, --yes                   Confirm destructive action`);
}

function printCommandHelp(command) {
  if (command === 'add') {
    console.log('Usage: open-knowledge add <title> <content> [--json]');
    return;
  }
  if (command === 'list' || command === 'ls') {
    console.log('Usage: open-knowledge list|ls [-p <page>] [-l <limit>] [-s <search>] [--sort created|title] [--desc] [--json]');
    return;
  }
  if (command === 'get') {
    console.log('Usage: open-knowledge get --id <id> [--json]');
    return;
  }
  if (command === 'delete' || command === 'rm') {
    console.log('Usage: open-knowledge delete|rm --id <id> -y [--json]');
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
    const db = loadStore(storePath);
    const item = {
      id: makeId(),
      title,
      content,
      created_at: new Date().toISOString()
    };
    db.items.push(item);
    saveStore(storePath, db);
    output({ ok: true, item, message: `Added ${item.id}` }, flags.json);
    return;
  }

  if (command === 'list') {
    const db = loadStore(storePath);
    const page = Number.isFinite(flags.page) && flags.page > 0 ? flags.page : 1;
    const limit = Number.isFinite(flags.limit) && flags.limit > 0 ? flags.limit : 20;
    const search = flags.search ? String(flags.search).toLowerCase() : '';
    const filtered = search
      ? db.items.filter((x) => x.title.toLowerCase().includes(search) || x.content.toLowerCase().includes(search))
      : db.items;

    const { sorted, sort, direction } = sortItems(filtered, flags);
    const start = (page - 1) * limit;
    const rows = sorted.slice(start, start + limit);
    const totalPages = Math.max(1, Math.ceil(sorted.length / limit));

    if (flags.json) {
      output({ ok: true, page, limit, total: sorted.length, total_pages: totalPages, sort, direction, items: rows }, true);
      return;
    }
    if (rows.length === 0) {
      output(`No items found (search=${search || 'none'})`, false);
      return;
    }
    for (const row of rows) {
      console.log(`${row.id}\t${row.title}\t${row.created_at}`);
    }
    console.log(`Page ${page}/${totalPages} | showing ${rows.length} of ${sorted.length} | sort=${sort} ${direction} | search=${search || 'none'}`);
    return;
  }

  if (command === 'get') {
    requireId(flags);
    const db = loadStore(storePath);
    const item = db.items.find((x) => x.id === flags.id);
    if (!item) {
      throw new Error(`Item not found: ${flags.id}`);
    }
    output({ ok: true, item, message: `${item.id}: ${item.title}` }, flags.json);
    return;
  }

  if (command === 'delete') {
    requireId(flags);
    if (!flags.yes) {
      throw new Error('Refusing delete without --yes. Re-run with: open-knowledge delete --id <id> --yes');
    }
    const db = loadStore(storePath);
    const before = db.items.length;
    db.items = db.items.filter((x) => x.id !== flags.id);
    const deleted = before !== db.items.length;
    saveStore(storePath, db);
    if (!deleted) {
      throw new Error(`Item not found: ${flags.id}`);
    }
    output({ ok: true, deleted_id: flags.id, message: `Deleted ${flags.id}` }, flags.json);
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
