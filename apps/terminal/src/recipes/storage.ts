// Recipes storage — global (recipes.json under the effective data home, getTerminalDir()) + per-project (.terminal/recipes.json)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { Recipe, Collection, RecipeStore } from "./model.js";
import { genId, extractVariables } from "./model.js";
import { getTerminalDir } from "../paths.js";

const GLOBAL_DIR = getTerminalDir();
const GLOBAL_FILE = join(GLOBAL_DIR, "recipes.json");

function projectFile(projectPath: string): string {
  return join(projectPath, ".terminal", "recipes.json");
}

function loadStore(filePath: string): RecipeStore {
  if (!existsSync(filePath)) return { recipes: [], collections: [] };
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return { recipes: [], collections: [] };
  }
}

function saveStore(filePath: string, store: RecipeStore): void {
  const dir = filePath.replace(/\/[^/]+$/, "");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, JSON.stringify(store, null, 2));
}

// ── Built-in system recipes (always available, zero config) ─────────────────

const SYSTEM_RECIPES: Recipe[] = [
  // Git workflows
  { id: "sys-commit-push", name: "commit-push", description: "Stage all, commit, push to origin", command: "git add -A && git commit -m \"{message}\" && git push", tags: ["git"], collection: "git", variables: [{ name: "message", required: true }], createdAt: 0, updatedAt: 0 },
  { id: "sys-pr", name: "create-pr", description: "Create GitHub PR from current branch", command: "gh pr create --title \"{title}\" --body \"{body}\"", tags: ["git", "github"], collection: "git", variables: [{ name: "title", required: true }, { name: "body", default: "" }], createdAt: 0, updatedAt: 0 },
  { id: "sys-stash", name: "stash-switch", description: "Stash changes, switch branch, pop", command: "git stash && git checkout {branch} && git stash pop", tags: ["git"], collection: "git", variables: [{ name: "branch", required: true }], createdAt: 0, updatedAt: 0 },

  // Quality checks
  { id: "sys-todos", name: "find-todos", description: "Find all TODO/FIXME/HACK in source code", command: "grep -rn 'TODO\\|FIXME\\|HACK\\|XXX' {path} --include='*.ts' --include='*.tsx' --include='*.js' --include='*.py' --include='*.go' --include='*.rs' --include='*.java' --include='*.rb'", tags: ["quality"], collection: "quality", variables: [{ name: "path", default: "src/" }], createdAt: 0, updatedAt: 0 },
  { id: "sys-deadcode", name: "find-unused-exports", description: "Find exported symbols that may be unused", command: "grep -rn 'export ' {path} --include='*.ts' | sed 's/.*export //' | sed 's/[(<:].*//' | sort -u", tags: ["quality"], collection: "quality", variables: [{ name: "path", default: "src/" }], createdAt: 0, updatedAt: 0 },
  { id: "sys-security", name: "security-scan", description: "Scan for common security anti-patterns", command: "grep -rn 'eval\\|exec\\|spawn\\|innerHTML\\|dangerouslySetInnerHTML\\|password.*=.*[\"'\\']' {path} --include='*.ts' --include='*.js' --include='*.py'", tags: ["security"], collection: "quality", variables: [{ name: "path", default: "src/" }], createdAt: 0, updatedAt: 0 },

  // Project info
  { id: "sys-deps", name: "list-deps", description: "Show project dependencies", command: "cat package.json 2>/dev/null | grep -A 100 '\"dependencies\"' | head -30 || cat requirements.txt 2>/dev/null || cat Cargo.toml 2>/dev/null | grep -A 50 'dependencies'", tags: ["deps"], collection: "project", variables: [], createdAt: 0, updatedAt: 0 },
  { id: "sys-size", name: "project-size", description: "Count lines of code by file type", command: "find {path} -not -path '*/node_modules/*' -not -path '*/dist/*' -not -path '*/.git/*' -type f | xargs wc -l 2>/dev/null | sort -rn | head -20", tags: ["stats"], collection: "project", variables: [{ name: "path", default: "src/" }], createdAt: 0, updatedAt: 0 },

  // Process management
  { id: "sys-port", name: "kill-port", description: "Kill whatever is running on a port", command: "lsof -ti :{port} | xargs kill -9 2>/dev/null || echo 'Port {port} is free'", tags: ["process"], collection: "system", variables: [{ name: "port", required: true }], createdAt: 0, updatedAt: 0 },
  { id: "sys-disk", name: "disk-usage", description: "Show disk usage of current directory", command: "du -sh {path}/* 2>/dev/null | sort -rh | head -15", tags: ["system"], collection: "system", variables: [{ name: "path", default: "." }], createdAt: 0, updatedAt: 0 },
];

// ── CRUD operations ──────────────────────────────────────────────────────────

/** Get all recipes (merged: system + global + project-scoped) */
export function listRecipes(projectPath?: string): Recipe[] {
  const global = loadStore(GLOBAL_FILE).recipes;
  if (!projectPath) return [...global, ...SYSTEM_RECIPES];
  const project = loadStore(projectFile(projectPath)).recipes;
  return [...project, ...global, ...SYSTEM_RECIPES]; // project > global > system priority
}

/** Get recipes filtered by collection */
export function listByCollection(collection: string, projectPath?: string): Recipe[] {
  return listRecipes(projectPath).filter(r => r.collection === collection);
}

/** Get a recipe by name */
export function getRecipe(name: string, projectPath?: string): Recipe | null {
  return listRecipes(projectPath).find(r => r.name === name) ?? null;
}

/** Create a recipe */
export function createRecipe(opts: {
  name: string;
  command: string;
  description?: string;
  tags?: string[];
  collection?: string;
  project?: string;
  variables?: { name: string; default?: string; required?: boolean }[];
}): Recipe {
  const filePath = opts.project ? projectFile(opts.project) : GLOBAL_FILE;
  const store = loadStore(filePath);

  // Prevent duplicates — update existing if same name
  const existingIdx = store.recipes.findIndex(r => r.name === opts.name);
  if (existingIdx >= 0) {
    store.recipes[existingIdx].command = opts.command;
    store.recipes[existingIdx].updatedAt = Date.now();
    if (opts.description) store.recipes[existingIdx].description = opts.description;
    if (opts.tags) store.recipes[existingIdx].tags = opts.tags;
    if (opts.collection) store.recipes[existingIdx].collection = opts.collection;
    saveStore(filePath, store);
    return store.recipes[existingIdx];
  }

  // Auto-detect variables from command if not explicitly provided
  const detectedVars = extractVariables(opts.command);
  const variables = opts.variables ?? detectedVars.map(name => ({ name, required: true }));

  const recipe: Recipe = {
    id: genId(),
    name: opts.name,
    description: opts.description,
    command: opts.command,
    tags: opts.tags ?? [],
    collection: opts.collection,
    project: opts.project,
    variables,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  store.recipes.push(recipe);
  saveStore(filePath, store);
  return recipe;
}

/** Delete a recipe by name — tries project first, then global */
export function deleteRecipe(name: string, projectPath?: string): boolean {
  // Try project-scoped first
  if (projectPath) {
    const pFile = projectFile(projectPath);
    const pStore = loadStore(pFile);
    const before = pStore.recipes.length;
    pStore.recipes = pStore.recipes.filter(r => r.name !== name);
    if (pStore.recipes.length < before) {
      saveStore(pFile, pStore);
      return true;
    }
  }
  // Fall back to global
  const store = loadStore(GLOBAL_FILE);
  const before = store.recipes.length;
  store.recipes = store.recipes.filter(r => r.name !== name);
  if (store.recipes.length < before) {
    saveStore(GLOBAL_FILE, store);
    return true;
  }
  return false;
}

// ── Collections ──────────────────────────────────────────────────────────────

export function listCollections(projectPath?: string): Collection[] {
  const global = loadStore(GLOBAL_FILE).collections;
  if (!projectPath) return global;
  const project = loadStore(projectFile(projectPath)).collections;
  return [...project, ...global];
}

export function createCollection(opts: { name: string; description?: string; project?: string }): Collection {
  const filePath = opts.project ? projectFile(opts.project) : GLOBAL_FILE;
  const store = loadStore(filePath);

  // Prevent duplicates — return existing if same name
  const existing = store.collections.find(c => c.name === opts.name);
  if (existing) return existing;

  const collection: Collection = {
    id: genId(),
    name: opts.name,
    description: opts.description,
    project: opts.project,
    createdAt: Date.now(),
  };

  store.collections.push(collection);
  saveStore(filePath, store);
  return collection;
}

/** Initialize project-scoped recipes file */
export function initProject(projectPath: string): void {
  const file = projectFile(projectPath);
  if (!existsSync(file)) {
    saveStore(file, { recipes: [], collections: [] });
  }
}
