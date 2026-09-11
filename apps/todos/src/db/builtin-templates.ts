import type { Database } from "bun:sqlite";
import { getDatabase } from "./database.js";
import { createTemplate, listTemplates } from "./templates.js";
import { builtinTemplateInputs } from "../lib/builtin-template-library.js";
export * from "../lib/builtin-template-library.js";

/** Explicit legacy storage compatibility; public initialization uses the API. */
export function initBuiltinTemplates(db?: Database): {
  created: number;
  skipped: number;
  names: string[];
} {
  const d = db || getDatabase();
  const existingNames = new Set(listTemplates(d).map((t) => t.name));
  const names: string[] = [];
  let skipped = 0;
  for (const input of builtinTemplateInputs()) {
    if (existingNames.has(input.name)) {
      skipped++;
      continue;
    }
    createTemplate(input, d);
    names.push(input.name);
  }
  return { created: names.length, skipped, names };
}
