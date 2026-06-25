import { Database } from "bun:sqlite";
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "fs";
import { dirname, join } from "path";
import { runMigrations } from "./migrations";

let instance: Database | null = null;
let instancePath: string | null = null;

export function getDataDir(): string {
  const home = process.env["HOME"] || process.env["USERPROFILE"] || "/tmp";
  migrateLegacyDotfile("crawl");
  const newDir = join(home, ".hasna", "crawl");
  mkdirSync(newDir, { recursive: true });
  return newDir;
}

function resolveDbPath(): string {
  if (Bun.env.HASNA_CRAWL_DB_PATH) {
    return Bun.env.HASNA_CRAWL_DB_PATH;
  }
  if (Bun.env.CRAWL_DB_PATH) {
    return Bun.env.CRAWL_DB_PATH;
  }
  return join(getDataDir(), "data.db");
}

export function getDb(): Database {
  const path = resolveDbPath();
  if (instance && instancePath === path) return instance;
  if (instance) closeDb();

  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);

  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA synchronous = NORMAL");

  runMigrations(db);

  instance = db;
  instancePath = path;
  return instance;
}

export function closeDb(): void {
  if (instance) {
    instance.close();
    instance = null;
    instancePath = null;
  }
}

function migrateLegacyDotfile(name: string): void {
  const home = process.env["HOME"] || process.env["USERPROFILE"] || "/tmp";
  const legacyDir = join(home, `.${name}`);
  const targetDir = join(home, ".hasna", name);
  if (!existsSync(legacyDir) || existsSync(targetDir)) return;
  copyTree(legacyDir, targetDir);
}

function copyTree(source: string, target: string): void {
  const stat = statSync(source);
  if (stat.isDirectory()) {
    mkdirSync(target, { recursive: true });
    for (const entry of readdirSync(source)) {
      copyTree(join(source, entry), join(target, entry));
    }
    return;
  }
  if (stat.isFile()) {
    mkdirSync(dirname(target), { recursive: true });
    if (!existsSync(target)) copyFileSync(source, target);
  }
}
