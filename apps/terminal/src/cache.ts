// In-memory LRU cache + disk persistence for command translations

import { existsSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const CACHE_FILE = join(homedir(), ".terminal", "cache.json");
const MAX_ENTRIES = 500;

type CacheMap = Record<string, string>;

let mem: CacheMap = {};

export function loadCache() {
  if (!existsSync(CACHE_FILE)) return;
  try { mem = JSON.parse(readFileSync(CACHE_FILE, "utf8")); } catch {}
}

function persistCache() {
  try { writeFileSync(CACHE_FILE, JSON.stringify(mem)); } catch {}
}

/** Normalize a natural language query for cache lookup */
export function normalizeNl(nl: string): string {
  return nl
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s]/g, "")   // strip punctuation
    .replace(/\s+/g, " ");
}

export function cacheGet(nl: string): string | null {
  return mem[normalizeNl(nl)] ?? null;
}

export function cacheSet(nl: string, command: string) {
  const key = normalizeNl(nl);
  // evict oldest if full
  const keys = Object.keys(mem);
  if (keys.length >= MAX_ENTRIES) delete mem[keys[0]];
  mem[key] = command;
  persistCache();
}
