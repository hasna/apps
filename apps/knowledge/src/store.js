import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { homedir } from 'node:os';

export function defaultStorePath() {
  return `${homedir()}/.open-knowledge/db.json`;
}

function ensureStore(path) {
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ items: [] }, null, 2));
  }
}

export function loadStore(path) {
  ensureStore(path);
  const raw = readFileSync(path, 'utf8');
  const parsed = JSON.parse(raw);
  if (!parsed || !Array.isArray(parsed.items)) {
    return { items: [] };
  }
  return parsed;
}

export function saveStore(path, store) {
  writeFileSync(path, JSON.stringify(store, null, 2));
}

export function makeId() {
  return `k_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
