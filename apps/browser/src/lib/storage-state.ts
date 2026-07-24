/**
 * Storage-state persistence — save/load browser auth state (cookies, localStorage, sessionStorage).
 * Uses Playwright's native storageState() API for full fidelity.
 */

import { existsSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { Page, BrowserContext } from "playwright";

import { getDataDir } from "../db/schema.js";
import {
  encryptedPathForJson,
  ensureOwnerOnlyDir,
  readSecureJsonFile,
  sanitizeStorageName,
  writeEncryptedJsonFile,
} from "./security.js";

export type BrowserStorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;

function getStatesDir(): string {
  return join(getDataDir(), "states");
}

function ensureDir() {
  ensureOwnerOnlyDir(getStatesDir());
}

function statePath(name: string): string {
  return join(getStatesDir(), `${sanitizeStorageName(name)}.json`);
}

export async function saveState(context: BrowserContext, name: string): Promise<string> {
  ensureDir();
  const path = statePath(name);
  const state = await context.storageState();
  return writeEncryptedJsonFile(path, state, getDataDir());
}

export async function saveStateFromPage(page: Page, name: string): Promise<string> {
  return saveState(page.context(), name);
}

export function loadStatePath(name: string): string | null {
  const path = statePath(name);
  const encrypted = encryptedPathForJson(path);
  if (existsSync(encrypted)) return encrypted;
  return existsSync(path) ? path : null;
}

export function loadState(name: string): BrowserStorageState | null {
  const path = loadStatePath(name);
  return path ? readSecureJsonFile<BrowserStorageState>(path, getDataDir()) : null;
}

export function listStates(): Array<{ name: string; path: string; modified: string }> {
  ensureDir();
  const statesDir = getStatesDir();
  return readdirSync(statesDir)
    .filter(f => f.endsWith(".json") || f.endsWith(".json.enc"))
    .map(f => {
      const path = join(statesDir, f);
      const stat = Bun.file(path);
      return {
        name: f.replace(/\.json(?:\.enc)?$/, ""),
        path,
        modified: new Date(stat.lastModified).toISOString(),
      };
    })
    .sort((a, b) => b.modified.localeCompare(a.modified));
}

export function deleteState(name: string): boolean {
  const path = statePath(name);
  const encrypted = encryptedPathForJson(path);
  let deleted = false;
  if (existsSync(encrypted)) {
    unlinkSync(encrypted);
    deleted = true;
  }
  if (existsSync(path)) {
    unlinkSync(path);
    deleted = true;
  }
  return deleted;
}
