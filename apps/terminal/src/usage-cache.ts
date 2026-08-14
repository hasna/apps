// Usage learning cache — zero-cost repeated queries
// After 3 identical prompt→command mappings, cache locally

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";
import { getTerminalDir } from "./paths.js";

const DIR = getTerminalDir();
const CACHE_FILE = join(DIR, "learned.json");

interface LearnedEntry {
  command: string;
  count: number;
  lastUsed: number;
}

type LearnedCache = Record<string, LearnedEntry>; // key = projectHash:promptHash

function ensureDir() {
  if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
}

function hash(s: string): string {
  return createHash("md5").update(s).digest("hex").slice(0, 12);
}

function cacheKey(prompt: string): string {
  const projectHash = hash(process.cwd());
  const promptHash = hash(prompt.toLowerCase().trim());
  return `${projectHash}:${promptHash}`;
}

function loadCache(): LearnedCache {
  ensureDir();
  if (!existsSync(CACHE_FILE)) return {};
  try { return JSON.parse(readFileSync(CACHE_FILE, "utf8")); } catch { return {}; }
}

function saveCache(cache: LearnedCache): void {
  ensureDir();
  writeFileSync(CACHE_FILE, JSON.stringify(cache));
}

/** Check if we have a learned command for this prompt (3+ identical mappings) */
export function getLearned(prompt: string): string | null {
  const key = cacheKey(prompt);
  const cache = loadCache();
  const entry = cache[key];
  if (entry && entry.count >= 3) return entry.command;
  return null;
}

/** Record a prompt→command mapping */
export function recordMapping(prompt: string, command: string): void {
  const key = cacheKey(prompt);
  const cache = loadCache();
  const existing = cache[key];
  if (existing && existing.command === command) {
    existing.count++;
    existing.lastUsed = Date.now();
  } else {
    cache[key] = { command, count: 1, lastUsed: Date.now() };
  }
  saveCache(cache);
}

/** Get cache stats */
export function learnedStats(): { entries: number; cached: number } {
  const cache = loadCache();
  const entries = Object.keys(cache).length;
  const cached = Object.values(cache).filter(e => e.count >= 3).length;
  return { entries, cached };
}
