import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const CONFIG_DIR = join(process.env["HOME"] || "~", ".contacts");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

interface ContactsConfig {
  db_path?: string;
}

export function readConfig(): ContactsConfig {
  if (!existsSync(CONFIG_FILE)) return {};
  try { return JSON.parse(readFileSync(CONFIG_FILE, "utf-8")) as ContactsConfig; } catch { return {}; }
}

export function writeConfig(config: ContactsConfig): void {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}
