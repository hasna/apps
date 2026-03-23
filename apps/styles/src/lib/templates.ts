import { getDb } from "./db.js";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";

export interface StyleTemplate {
  id: string;
  name: string;
  description: string;
  styleProfileId: string;
  variables: Record<string, string>;
  createdAt: number;
}

export type CreateTemplateInput = Omit<StyleTemplate, "id" | "createdAt">;

export interface ApplyResult {
  success: boolean;
  filesCreated: string[];
  errors: string[];
}

// ── helpers ──────────────────────────────────────────────────────────────────

function rowToTemplate(row: Record<string, unknown>): StyleTemplate {
  return {
    id: row.id as string,
    name: row.name as string,
    description: (row.description as string) ?? "",
    styleProfileId: (row.style_profile_id as string) ?? "",
    variables: JSON.parse((row.variables as string) ?? "{}"),
    createdAt: row.created_at as number,
  };
}

/**
 * Substitute {{VAR_NAME}} placeholders in a template string.
 */
function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

export function createTemplate(input: CreateTemplateInput): StyleTemplate {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = Date.now();

  db.run(
    `INSERT INTO templates (id, name, description, style_profile_id, variables, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.name,
      input.description,
      input.styleProfileId,
      JSON.stringify(input.variables),
      now,
    ]
  );

  return { ...input, id, createdAt: now };
}

export function getTemplate(id: string): StyleTemplate | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM templates WHERE id = ?")
    .get(id) as Record<string, unknown> | null;
  if (!row) return null;
  return rowToTemplate(row);
}

export function listTemplates(profileId?: string): StyleTemplate[] {
  const db = getDb();
  let rows: Record<string, unknown>[];

  if (profileId) {
    rows = db
      .prepare("SELECT * FROM templates WHERE style_profile_id = ? ORDER BY created_at ASC")
      .all(profileId) as Record<string, unknown>[];
  } else {
    rows = db
      .prepare("SELECT * FROM templates ORDER BY created_at ASC")
      .all() as Record<string, unknown>[];
  }

  return rows.map(rowToTemplate);
}

export function deleteTemplate(id: string): void {
  const db = getDb();
  db.run("DELETE FROM templates WHERE id = ?", [id]);
}

// ── Apply ─────────────────────────────────────────────────────────────────────

/**
 * Apply a template to a project directory.
 *
 * The template's variables map can include special keys:
 *   - Files to create: keys ending in "_FILE" are interpreted as "<relative-path>_FILE"
 *     and their value is written as file content (after variable interpolation).
 *   - If a variable key is "OUTPUT_FILES" its value is parsed as JSON array of
 *     { path: string, content: string } objects.
 *
 * For simple templates that only define styles (no OUTPUT_FILES), we write
 * a default .styles/style.md context file summarising the template's profile.
 */
export function applyTemplate(id: string, projectPath: string): ApplyResult {
  const template = getTemplate(id);
  if (!template) {
    return {
      success: false,
      filesCreated: [],
      errors: [`Template not found: ${id}`],
    };
  }

  const filesCreated: string[] = [];
  const errors: string[] = [];
  const vars = template.variables;

  try {
    // Handle OUTPUT_FILES descriptor
    if (vars["OUTPUT_FILES"]) {
      let outputFiles: Array<{ path: string; content: string }> = [];
      try {
        outputFiles = JSON.parse(vars["OUTPUT_FILES"]);
      } catch {
        errors.push("Failed to parse OUTPUT_FILES JSON in template variables");
      }

      for (const file of outputFiles) {
        try {
          const absPath = join(projectPath, file.path);
          const dir = dirname(absPath);
          if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
          writeFileSync(absPath, interpolate(file.content, vars), "utf-8");
          filesCreated.push(absPath);
        } catch (e) {
          errors.push(`Failed to write ${file.path}: ${(e as Error).message}`);
        }
      }
    }

    // Handle _FILE suffix keys
    for (const [key, content] of Object.entries(vars)) {
      if (!key.endsWith("_FILE")) continue;
      const relPath = key.slice(0, -5).toLowerCase().replace(/_/g, "/");
      const absPath = join(projectPath, relPath);
      try {
        const dir = dirname(absPath);
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        writeFileSync(absPath, interpolate(content, vars), "utf-8");
        filesCreated.push(absPath);
      } catch (e) {
        errors.push(`Failed to write ${relPath}: ${(e as Error).message}`);
      }
    }

    // Always write a style context file
    const stylesMdPath = join(projectPath, ".styles", "style.md");
    if (!filesCreated.some((f) => f === stylesMdPath)) {
      const stylesMdDir = join(projectPath, ".styles");
      if (!existsSync(stylesMdDir)) mkdirSync(stylesMdDir, { recursive: true });

      const header = `# Style Context\n\nTemplate: **${template.name}**\n${
        template.description ? `\n${template.description}\n` : ""
      }\nProfile ID: \`${template.styleProfileId}\`\n\nGenerated at: ${new Date().toISOString()}\n`;

      writeFileSync(stylesMdPath, header, "utf-8");
      filesCreated.push(stylesMdPath);
    }
  } catch (e) {
    errors.push(`Unexpected error applying template: ${(e as Error).message}`);
    return { success: false, filesCreated, errors };
  }

  return { success: errors.length === 0, filesCreated, errors };
}
