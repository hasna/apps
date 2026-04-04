import { readdirSync, readFileSync, existsSync, statSync } from "fs";
import { join, resolve } from "path";
import type { CreateScenarioInput, FileScenario } from "../types/index.js";
import { upsertScenario } from "../db/scenarios.js";

export interface TestersConfig {
  url?: string;
  model?: string;
  tags?: string[];
  scenarios?: FileScenario[];
  projectId?: string;
}

/**
 * Minimal YAML parser for .testers.yml configs.
 * Handles the common patterns we need: top-level keys,
 * scenarios list with nested array values (steps, tags).
 */
function parseYamlLike(content: string): TestersConfig {
  const config: TestersConfig = { scenarios: [] };
  const lines = content.split("\n");

  let inScenariosBlock = false;
  let currentScenario: Record<string, unknown> | null = null;
  let currentArrayKey: string | null = null;
  let currentArrayItems: string[] = [];

  function finishScenario() {
    if (currentScenario && currentScenario.name) {
      if (currentArrayKey && currentArrayItems.length > 0) {
        currentScenario[currentArrayKey] = currentArrayItems;
      }
      config.scenarios!.push(currentScenario as FileScenario);
    }
    currentScenario = null;
    currentArrayKey = null;
    currentArrayItems = [];
  }

  for (const line of lines) {
    const raw = line.trimEnd();
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const indent = raw.search(/\S/);

    // --- Scenario list item: "  - name: ..." at indent 2 inside scenarios block ---
    if (trimmed.startsWith("- ") && inScenariosBlock && indent === 2) {
      // Flush any pending array items before switching scenarios
      if (currentScenario && currentArrayKey && currentArrayItems.length > 0) {
        currentScenario[currentArrayKey] = currentArrayItems;
      }
      finishScenario();
      currentScenario = {};
      // Parse the rest of the line after "- " as a key: value pair
      const rest = trimmed.slice(2).trim();
      const kvMatch = rest.match(/^([a-zA-Z_]\w*):\s*(.*)?$/);
      if (kvMatch) {
        const [, key, rawVal] = kvMatch;
        const val = rawVal?.trim() ?? "";
        if (!val && (key === "steps" || key === "tags")) {
          currentArrayKey = key;
          currentArrayItems = [];
        } else if (val.startsWith("[")) {
          const items = val.slice(1, -1).split(",").map((t) => t.trim().replace(/"/g, "")).filter(Boolean);
          if (key === "steps" || key === "tags") currentScenario[key] = items;
        } else {
          switch (key) {
            case "name": currentScenario.name = val; break;
            case "description": currentScenario.description = val; break;
            case "targetPath": currentScenario.targetPath = val; break;
            case "model": currentScenario.model = val; break;
            case "requiresAuth": currentScenario.requiresAuth = val === "true"; break;
            case "priority": currentScenario.priority = val; break;
            case "steps": currentScenario.steps = []; break;
            case "tags": currentScenario.tags = []; break;
          }
        }
      }
      continue;
    }

    // --- Array items: "    - value" under a scenario ---
    if (trimmed.startsWith("- ") && currentScenario && indent >= 4) {
      const val = trimmed.slice(2).trim().replace(/^["']|["']$/g, "");
      if (currentArrayKey) {
        currentArrayItems.push(val);
      }
      continue;
    }

    // --- Key: value ---
    const kvMatch = raw.match(/^(\s*)([a-zA-Z_]\w*):\s*(.*)?$/);
    if (!kvMatch) continue;

    const [, indentStr, key, rawVal] = kvMatch;
    const val = rawVal?.trim() ?? "";

    // Top-level (indent 0)
    if (indent === 0) {
      finishScenario();
      inScenariosBlock = false;

      if (key === "scenarios") {
        if (!val) inScenariosBlock = true;
        continue;
      }
      if (key === "url" && val) { config.url = val; continue; }
      if (key === "model" && val) { config.model = val; continue; }
      if (key === "projectId" && val) { config.projectId = val; continue; }
      if (key === "tags" && val) {
        config.tags = val.replace(/[\[\]]/g, "").split(",").map((t) => t.trim()).filter(Boolean);
      }
      continue;
    }

    // Scenario-level (indent 4, properties of a list-item scenario)
    if (indent === 4 && currentScenario && inScenariosBlock) {
      if (!val) {
        // Key with no value — might be an array key
        if (key === "steps" || key === "tags") {
          // Flush previous array before starting a new one
          if (currentArrayKey && currentArrayItems.length > 0) {
            currentScenario[currentArrayKey] = currentArrayItems;
          }
          currentArrayKey = key;
          currentArrayItems = [];
        }
        continue;
      }

      // Inline array: [a, b, c]
      if (val.startsWith("[")) {
        const items = val.slice(1, -1).split(",").map((t) => t.trim().replace(/"/g, "")).filter(Boolean);
        if (key === "steps" || key === "tags") {
          currentScenario[key] = items;
        }
        continue;
      }

      // Scalar value
      switch (key) {
        case "name": currentScenario.name = val; break;
        case "description": currentScenario.description = val; break;
        case "targetPath": currentScenario.targetPath = val; break;
        case "model": currentScenario.model = val; break;
        case "requiresAuth": currentScenario.requiresAuth = val === "true"; break;
        case "priority": currentScenario.priority = val; break;
        case "steps": currentScenario.steps = []; break;
        case "tags": currentScenario.tags = []; break;
      }
      continue;
    }
  }

  finishScenario();
  return config;
}

/**
 * Load scenarios from a .testers.yml config file.
 */
export function loadTestersConfig(configPath: string): TestersConfig {
  const absPath = resolve(configPath);
  if (!existsSync(absPath)) {
    throw new Error(`Config file not found: ${absPath}`);
  }
  const content = readFileSync(absPath, "utf-8");
  return parseYamlLike(content);
}

/**
 * Discover scenarios from files (.testers.yml or tests/scenarios/*.yaml).
 * Upserts them into the DB, returning created/updated/deduped counts.
 */
export function discoverScenariosFromFiles(
  projectRoot?: string,
): { created: number; updated: number; deduped: number; total: number } {
  const root = projectRoot ?? process.cwd();
  let created = 0;
  let updated = 0;
  let deduped = 0;

  const files: string[] = [];

  // Check .testers.yml in project root
  const configPath = join(root, ".testers.yml");
  if (existsSync(configPath)) files.push(configPath);

  // Check tests/scenarios/*.yaml
  const scenariosDir = join(root, "tests", "scenarios");
  if (existsSync(scenariosDir) && statSync(scenariosDir).isDirectory()) {
    for (const f of readdirSync(scenariosDir)) {
      if (f.endsWith(".yaml") || f.endsWith(".yml")) {
        files.push(join(scenariosDir, f));
      }
    }
  }

  for (const file of files) {
    try {
      const cfg = loadTestersConfig(file);
      for (const sc of cfg.scenarios ?? []) {
        const result = upsertScenario({
          name: sc.name,
          description: sc.description ?? sc.name,
          steps: sc.steps,
          tags: [...(cfg.tags ?? []), ...(sc.tags ?? [])],
          priority: sc.priority,
          model: sc.model ?? cfg.model,
          targetPath: sc.targetPath,
          requiresAuth: sc.requiresAuth,
          projectId: cfg.projectId,
        });
        if (result.action === "created") created++;
        else if (result.action === "updated") updated++;
        else deduped++;
      }
    } catch {
      // Skip files that fail to parse
    }
  }

  return { created, updated, deduped, total: created + updated + deduped };
}
