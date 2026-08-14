import type { TemplateVariable } from "../types/index.js";

/** Resolve template variables consistently for local and remote execution. */
export function resolveTemplateVariables(
  templateVars: TemplateVariable[],
  provided?: Record<string, string>,
): Record<string, string> {
  const merged: Record<string, string> = { ...provided };

  for (const variable of templateVars) {
    if (merged[variable.name] === undefined && variable.default !== undefined) {
      merged[variable.name] = variable.default;
    }
  }

  const missing = templateVars
    .filter((variable) => variable.required && merged[variable.name] === undefined)
    .map((variable) => variable.name);
  if (missing.length > 0) {
    throw new Error(`Missing required template variable(s): ${missing.join(", ")}`);
  }
  return merged;
}

/** Replace only variables which have been resolved, leaving unrelated literals intact. */
export function substituteTemplateVariables(text: string, variables: Record<string, string>): string {
  let result = text;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, "g"), value);
  }
  return result;
}

/** Evaluate the intentionally small, documented template-condition language. */
export function evaluateTemplateCondition(condition: string, variables: Record<string, string>): boolean {
  if (!condition || condition.trim() === "") return true;
  const trimmed = condition.trim();
  const equal = trimmed.match(/^\{([^}]+)\}\s*==\s*(.+)$/);
  if (equal) return (variables[equal[1]!] ?? "") === equal[2]!.trim();
  const unequal = trimmed.match(/^\{([^}]+)\}\s*!=\s*(.+)$/);
  if (unequal) return (variables[unequal[1]!] ?? "") !== unequal[2]!.trim();
  const falsy = trimmed.match(/^!\{([^}]+)\}$/);
  if (falsy) {
    const value = variables[falsy[1]!];
    return !value || value === "" || value === "false";
  }
  const truthy = trimmed.match(/^\{([^}]+)\}$/);
  if (truthy) {
    const value = variables[truthy[1]!];
    return !!value && value !== "" && value !== "false";
  }
  return true;
}
