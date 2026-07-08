import type { Base } from "../types/index.js";
import { TablesBase } from "./base.js";

/** Serialize a base (or TablesBase) to a JSON string. */
export function serializeBase(base: Base | TablesBase, pretty = false): string {
  const data = base instanceof TablesBase ? base.toJSON() : base;
  return JSON.stringify(data, null, pretty ? 2 : undefined);
}

/** Parse and lightly validate a JSON string into a Base. */
export function deserializeBase(json: string): Base {
  const parsed = JSON.parse(json) as unknown;
  return assertBase(parsed);
}

/** Load a base JSON into a mutable TablesBase controller. */
export function loadBase(json: string): TablesBase {
  return TablesBase.fromJSON(deserializeBase(json));
}

function assertBase(value: unknown): Base {
  if (typeof value !== "object" || value === null) {
    throw new Error("Invalid base: expected an object");
  }
  const base = value as Partial<Base>;
  if (typeof base.id !== "string" || typeof base.name !== "string" || !Array.isArray(base.tables)) {
    throw new Error("Invalid base: missing id, name, or tables");
  }
  for (const table of base.tables) {
    if (typeof table.id !== "string" || !Array.isArray(table.fields) || !Array.isArray(table.records)) {
      throw new Error(`Invalid table in base: ${JSON.stringify(table).slice(0, 80)}`);
    }
  }
  return base as Base;
}
