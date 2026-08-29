import type { Command } from "commander";
import chalk from "chalk";
import { existsSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { dbPackages } from "../registry.js";
import { dataPath, dirExists, execSafe, pad, spawnSafe } from "../utils.js";

/**
 * Strict SQL identifier validation: only letters, digits and underscore,
 * never starting with a digit. Table/column names from sqlite_master or the
 * static SERVICE_TABLES allowlist must pass before being interpolated into
 * SQL, so a malicious database cannot inject statements.
 */
function isSafeIdentifier(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}

const MAX_SEARCH_LIMIT = 100;

const SERVICE_TABLES: Record<string, Array<{ table: string; columns: string[] }>> = {
  todos: [{ table: "tasks", columns: ["title", "description"] }],
  mementos: [
    { table: "memories", columns: ["content", "context"] },
    { table: "entities", columns: ["name", "description"] },
  ],
  emails: [{ table: "emails", columns: ["subject", "body", "to_address", "from_address"] }],
  prompts: [{ table: "prompts", columns: ["content", "name", "description"] }],
  contacts: [
    { table: "contacts", columns: ["name", "email", "notes"] },
    { table: "companies", columns: ["name", "description"] },
  ],
  conversations: [{ table: "messages", columns: ["content"] }],
  recordings: [{ table: "recordings", columns: ["title", "transcript", "enhanced"] }],
  implementations: [{ table: "implementations", columns: ["title", "description", "notes"] }],
  sessions: [{ table: "sessions", columns: ["summary", "notes", "tags"] }],
  testers: [{ table: "scenarios", columns: ["title", "description", "steps"] }],
  tickets: [{ table: "tickets", columns: ["title", "description"] }],
  skills: [{ table: "skills", columns: ["name", "description"] }],
  hooks: [{ table: "hooks", columns: ["name", "description"] }],
  configs: [{ table: "configs", columns: ["name", "content"] }],
  secrets: [{ table: "secrets", columns: ["key", "description"] }],
  brains: [{ table: "models", columns: ["name", "description"] }],
  files: [{ table: "files", columns: ["path", "name", "tags"] }],
  search: [{ table: "searches", columns: ["query", "results"] }],
  wallets: [{ table: "cards", columns: ["label", "notes"] }],
};

function findDbFiles(serviceDir: string): string[] {
  if (!dirExists(serviceDir)) return [];
  const files: string[] = [];
  try {
    const entries = readdirSync(serviceDir, { recursive: true });
    for (const entry of entries) {
      const full = join(serviceDir, String(entry));
      if ((full.endsWith(".db") || full.endsWith(".sqlite") || full.endsWith(".sqlite3")) && existsSync(full)) {
        try {
          if (statSync(full).isFile()) {
            files.push(full);
          }
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* ignore */
  }
  return files;
}

function tableExists(dbPath: string, tableName: string): boolean {
  if (!isSafeIdentifier(tableName)) return false;
  // dbPath/tableName travel as argv — a malicious database (or db path)
  // cannot carry shell substitution.
  const result = spawnSafe("sqlite3", [dbPath, `SELECT name FROM sqlite_master WHERE type='table' AND name='${tableName}';`]);
  return result !== null && result.trim() === tableName;
}

function getExistingColumns(dbPath: string, tableName: string, wantedColumns: string[]): string[] {
  if (!isSafeIdentifier(tableName)) return [];
  const result = spawnSafe("sqlite3", [dbPath, `PRAGMA table_info(${tableName});`]);
  if (!result) return [];
  const existingCols = result
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const parts = line.split("|");
      return parts[1] || "";
    })
    .filter(Boolean);
  return wantedColumns.filter((c) => existingCols.includes(c));
}

interface SearchResult {
  service: string;
  table: string;
  column: string;
  snippet: string;
  rowId: string;
}

function searchTable(dbPath: string, serviceName: string, tableName: string, columns: string[], query: string, limit: number): SearchResult[] {
  if (!tableExists(dbPath, tableName)) return [];
  const existingCols = getExistingColumns(dbPath, tableName, columns);
  if (existingCols.length === 0) return [];
  const results: SearchResult[] = [];
  const escapedQuery = query.replace(/'/g, "''");
  for (const col of existingCols) {
    if (!isSafeIdentifier(col) || !isSafeIdentifier(tableName)) continue;
    const sql = `SELECT rowid, substr(${col}, 1, 200) FROM "${tableName}" WHERE "${col}" LIKE '%${escapedQuery}%' LIMIT ${limit};`;
    // The query travels as an argv entry, never through a shell — shell
    // substitution in a search string cannot execute.
    const raw = spawnSafe("sqlite3", [dbPath, sql]);
    if (!raw) continue;
    for (const line of raw.split("\n").filter(Boolean)) {
      const sepIdx = line.indexOf("|");
      if (sepIdx === -1) continue;
      const rowId = line.slice(0, sepIdx);
      const snippet = line.slice(sepIdx + 1).trim();
      results.push({ service: serviceName, table: tableName, column: col, snippet, rowId });
    }
  }
  return results;
}

function highlight(text: string, query: string): string {
  const lower = text.toLowerCase();
  const queryLower = query.toLowerCase();
  let result = "";
  let lastIndex = 0;
  let idx = lower.indexOf(queryLower, lastIndex);
  while (idx !== -1) {
    result += text.slice(lastIndex, idx);
    result += chalk.bold.yellow(text.slice(idx, idx + query.length));
    lastIndex = idx + query.length;
    idx = lower.indexOf(queryLower, lastIndex);
  }
  result += text.slice(lastIndex);
  return result;
}

const SERVICE_COLORS2: Record<string, (s: string) => string> = {};
const PALETTE = [
  chalk.cyan,
  chalk.magenta,
  chalk.yellow,
  chalk.green,
  chalk.blue,
  chalk.redBright,
  chalk.cyanBright,
  chalk.magentaBright,
];

function serviceColor(name: string): (s: string) => string {
  if (!SERVICE_COLORS2[name]) {
    const idx = Object.keys(SERVICE_COLORS2).length % PALETTE.length;
    SERVICE_COLORS2[name] = PALETTE[idx];
  }
  return SERVICE_COLORS2[name];
}

export function registerSearchCommand(program: Command): void {
  program
    .command("search <query>")
    .description("Cross-service search across all SQLite databases")
    .option("-l, --limit <n>", "Max results per service", "5")
    .option("-s, --service <name>", "Search only a specific service")
    .option("--json", "Output as JSON")
    .action((query: string, opts) => {
      const limit = Math.min(Math.max(parseInt(opts.limit, 10) || 5, 1), MAX_SEARCH_LIMIT);
      let packages = dbPackages();
      if (opts.service) {
        packages = packages.filter((p) => p.name === opts.service);
        if (packages.length === 0) {
          console.error(chalk.red(`Service not found: ${opts.service}`));
          process.exit(1);
        }
      }
      if (!opts.json) {
        console.log(chalk.bold("agency search") + chalk.dim(` — "${query}"\n`));
      }
      const allResults: Record<string, SearchResult[]> = {};
      let totalMatches = 0;
      for (const pkg of packages) {
        const dp = dataPath(pkg.dataDir);
        const dbFiles = findDbFiles(dp);
        if (dbFiles.length === 0) continue;
        const knownTables = SERVICE_TABLES[pkg.name];
        const serviceResults: SearchResult[] = [];
        for (const dbFile of dbFiles) {
          if (knownTables) {
            for (const { table, columns } of knownTables) {
              const results = searchTable(dbFile, pkg.name, table, columns, query, limit);
              serviceResults.push(...results);
            }
          } else {
            const tablesRaw = spawnSafe("sqlite3", [dbFile, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%';"]);
            if (!tablesRaw) continue;
            const tables = tablesRaw.split("\n").filter(Boolean).filter(isSafeIdentifier);
            for (const table of tables) {
              const colsRaw = spawnSafe("sqlite3", [dbFile, `PRAGMA table_info(${table});`]);
              if (!colsRaw) continue;
              const textCols = colsRaw
                .split("\n")
                .filter(Boolean)
                .map((line) => {
                  const parts = line.split("|");
                  return { name: parts[1] || "", type: (parts[2] || "").toUpperCase() };
                })
                .filter((c) => c.type === "TEXT" || c.type === "VARCHAR" || c.type === "")
                .map((c) => c.name);
              if (textCols.length > 0) {
                const results = searchTable(dbFile, pkg.name, table, textCols, query, limit);
                serviceResults.push(...results);
              }
            }
          }
        }
        if (serviceResults.length > 0) {
          const limited = serviceResults.slice(0, limit);
          allResults[pkg.name] = limited;
          totalMatches += limited.length;
        }
      }
      if (opts.json) {
        console.log(JSON.stringify(allResults, null, 2));
        return;
      }
      if (totalMatches === 0) {
        console.log(chalk.dim("  No results found across any service."));
        return;
      }
      for (const [service, results] of Object.entries(allResults)) {
        const colorFn = serviceColor(service);
        console.log(colorFn(`  ${service}`) + chalk.dim(`: ${results.length} match(es)`));
        for (const r of results) {
          const snippet = r.snippet.length > 120 ? r.snippet.slice(0, 120) + "..." : r.snippet;
          const highlighted = highlight(snippet, query);
          console.log(`    ${chalk.dim(`[${r.table}.${r.column}]`)} ${highlighted}`);
        }
        console.log();
      }
      console.log(chalk.dim(`  ${totalMatches} total match(es) across ${Object.keys(allResults).length} service(s)`));
    });
}
