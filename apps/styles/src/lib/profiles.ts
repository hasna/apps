import { getDb } from "./db.js";
import { getStyle, STYLES } from "./registry.js";
import { join } from "path";
import { existsSync, readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname } from "path";

export interface StyleProfile {
  id: string;
  name: string;
  displayName: string;
  description: string;
  category: string;
  principles: string[];
  antiPatterns: string[];
  typography: Record<string, unknown>;
  colors: Record<string, unknown>;
  componentRules: Record<string, unknown>;
  tags: string[];
  createdAt: number;
  builtin: boolean;
}

export type CreateProfileInput = Omit<StyleProfile, "id" | "createdAt" | "builtin">;

// ── helpers ──────────────────────────────────────────────────────────────────

function rowToProfile(row: Record<string, unknown>, builtin = false): StyleProfile {
  return {
    id: row.id as string,
    name: row.name as string,
    displayName: row.display_name as string,
    description: (row.description as string) ?? "",
    category: (row.category as string) ?? "",
    principles: JSON.parse((row.principles as string) ?? "[]"),
    antiPatterns: JSON.parse((row.anti_patterns as string) ?? "[]"),
    typography: JSON.parse((row.typography as string) ?? "{}"),
    colors: JSON.parse((row.colors as string) ?? "{}"),
    componentRules: JSON.parse((row.component_rules as string) ?? "{}"),
    tags: JSON.parse((row.tags as string) ?? "[]"),
    createdAt: row.created_at as number,
    builtin,
  };
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

export function createProfile(input: CreateProfileInput): StyleProfile {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = Date.now();

  db.run(
    `INSERT INTO style_profiles
       (id, name, display_name, description, category, principles, anti_patterns,
        typography, colors, component_rules, tags, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.name,
      input.displayName,
      input.description,
      input.category,
      JSON.stringify(input.principles),
      JSON.stringify(input.antiPatterns),
      JSON.stringify(input.typography),
      JSON.stringify(input.colors),
      JSON.stringify(input.componentRules),
      JSON.stringify(input.tags),
      now,
    ]
  );

  return {
    ...input,
    id,
    createdAt: now,
    builtin: false,
  };
}

export function getProfile(id: string): StyleProfile | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM style_profiles WHERE id = ?")
    .get(id) as Record<string, unknown> | null;
  if (!row) return null;
  return rowToProfile(row);
}

export function getProfileByName(name: string): StyleProfile | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM style_profiles WHERE name = ?")
    .get(name) as Record<string, unknown> | null;
  if (!row) return null;
  return rowToProfile(row);
}

export function listProfiles(): StyleProfile[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM style_profiles ORDER BY created_at ASC")
    .all() as Record<string, unknown>[];
  return rows.map((r) => rowToProfile(r));
}

export function updateProfile(
  id: string,
  changes: Partial<CreateProfileInput>
): StyleProfile {
  const db = getDb();
  const existing = getProfile(id);
  if (!existing) throw new Error(`Profile not found: ${id}`);

  const merged = { ...existing, ...changes };

  db.run(
    `UPDATE style_profiles SET
       name = ?, display_name = ?, description = ?, category = ?,
       principles = ?, anti_patterns = ?, typography = ?, colors = ?,
       component_rules = ?, tags = ?
     WHERE id = ?`,
    [
      merged.name,
      merged.displayName,
      merged.description,
      merged.category,
      JSON.stringify(merged.principles),
      JSON.stringify(merged.antiPatterns),
      JSON.stringify(merged.typography),
      JSON.stringify(merged.colors),
      JSON.stringify(merged.componentRules),
      JSON.stringify(merged.tags),
      id,
    ]
  );

  return { ...merged, builtin: false };
}

export function deleteProfile(id: string): void {
  const db = getDb();
  db.run("DELETE FROM style_profiles WHERE id = ?", [id]);
}

// ── Project / active profile ──────────────────────────────────────────────────

export function setActiveProfile(
  projectPath: string,
  profileId: string
): void {
  const db = getDb();
  const existing = db
    .prepare("SELECT id FROM project_configs WHERE project_path = ?")
    .get(projectPath) as { id: string } | null;

  if (existing) {
    db.run(
      "UPDATE project_configs SET profile_id = ? WHERE project_path = ?",
      [profileId, projectPath]
    );
  } else {
    db.run(
      `INSERT INTO project_configs (id, project_path, profile_id, created_at)
       VALUES (?, ?, ?, ?)`,
      [crypto.randomUUID(), projectPath, profileId, Date.now()]
    );
  }
}

export function getActiveProfile(
  projectPath: string
): StyleProfile | null {
  const db = getDb();

  // 1. Check project_configs first
  const config = db
    .prepare("SELECT profile_id FROM project_configs WHERE project_path = ?")
    .get(projectPath) as { profile_id: string | null } | null;

  if (config?.profile_id) {
    const profile = getProfile(config.profile_id);
    if (profile) return profile;
  }

  // 2. Fallback: check global preference
  const pref = db
    .prepare(
      "SELECT value FROM preferences WHERE key = 'active_profile' AND scope = 'global'"
    )
    .get() as { value: string } | null;

  if (pref?.value) {
    const profile = getProfile(pref.value) ?? getProfileByName(pref.value);
    if (profile) return profile;
  }

  return null;
}

// ── Built-in styles from the styles/ directory ────────────────────────────────

function getStylesRootDir(): string {
  // Resolve relative to this compiled file: dist/lib/profiles.js → root/styles/
  const thisFile = fileURLToPath(import.meta.url);
  const thisDir = dirname(thisFile);
  // During development (src/lib/profiles.ts) → ../../styles
  // After build (dist/lib/profiles.js) → ../../styles — same relative depth
  return join(thisDir, "..", "..", "styles");
}

export function getBuiltinStyleProfile(name: string): StyleProfile {
  const meta = getStyle(name);
  if (!meta) {
    throw new Error(
      `Unknown style: "${name}". Available: ${STYLES.map((s) => s.name).join(", ")}`
    );
  }

  // Try to read the STYLE.md for the profile's detailed rules
  const styleMdPath = join(getStylesRootDir(), name, "STYLE.md");
  let styleMarkdown = "";
  if (existsSync(styleMdPath)) {
    styleMarkdown = readFileSync(styleMdPath, "utf-8");
  }

  // Parse optional JSON front-matter from the STYLE.md if present
  // Format: ---json\n{...}\n---\n<markdown>
  let extraData: Partial<StyleProfile> = {};
  const frontMatterMatch = styleMarkdown.match(
    /^---json\s*\n([\s\S]*?)\n---\s*\n/
  );
  if (frontMatterMatch) {
    try {
      extraData = JSON.parse(frontMatterMatch[1]);
    } catch {
      // ignore malformed front-matter
    }
  }

  return {
    id: `builtin:${name}`,
    name: meta.name,
    displayName: meta.displayName,
    description: extraData.description ?? meta.description,
    category: meta.category,
    principles: extraData.principles ?? meta.principles,
    antiPatterns: extraData.antiPatterns ?? [],
    typography: extraData.typography ?? {},
    colors: extraData.colors ?? {},
    componentRules: extraData.componentRules ?? {},
    tags: meta.tags,
    createdAt: 0,
    builtin: true,
  };
}
