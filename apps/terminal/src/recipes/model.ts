// Recipes data model — reusable command templates with collections and projects

export interface RecipeVariable {
  name: string;
  description?: string;
  default?: string;
  required?: boolean;
}

export interface Recipe {
  id: string;
  name: string;
  description?: string;
  command: string;
  tags: string[];
  collection?: string;
  project?: string;  // project path — if set, recipe is project-scoped
  variables: RecipeVariable[];
  createdAt: number;
  updatedAt: number;
}

export interface Collection {
  id: string;
  name: string;
  description?: string;
  project?: string;
  createdAt: number;
}

export interface RecipeStore {
  recipes: Recipe[];
  collections: Collection[];
}

/** Generate a short random ID */
export function genId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** Substitute variables in a command template */
export function substituteVariables(command: string, vars: Record<string, string>): string {
  let result = command;
  for (const [name, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{${name}\\}`, "g"), value);
  }
  return result;
}

/** Extract variable placeholders from a command */
export function extractVariables(command: string): string[] {
  const matches = command.match(/\{(\w+)\}/g);
  if (!matches) return [];
  return [...new Set(matches.map(m => m.slice(1, -1)))];
}
