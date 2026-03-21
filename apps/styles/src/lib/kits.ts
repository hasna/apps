import { getDb } from "./db.js";
import type { DesignTokens } from "./tokenizer.js";
import type { RawExtractedStyles } from "./extractor.js";
import type { CreateProfileInput } from "./profiles.js";

export interface StyleKit {
  id: string;
  name: string;
  url: string;
  tokens: DesignTokens;
  raw?: RawExtractedStyles;
  screenshot?: string;
  tags: string[];
  notes?: string;
  extractedAt: number;
  createdAt: number;
  updatedAt: number;
}

export type CreateKitInput = {
  name: string;
  url: string;
  tokens: DesignTokens;
  raw?: RawExtractedStyles;
  screenshot?: string;
  tags?: string[];
  notes?: string;
  extractedAt?: number;
};

// ── helpers ───────────────────────────────────────────────────────────────────

function rowToKit(row: Record<string, unknown>): StyleKit {
  return {
    id: row.id as string,
    name: row.name as string,
    url: row.url as string,
    tokens: JSON.parse(row.tokens as string),
    raw: row.raw ? JSON.parse(row.raw as string) : undefined,
    screenshot: (row.screenshot as string) ?? undefined,
    tags: JSON.parse((row.tags as string) ?? "[]"),
    notes: (row.notes as string) ?? undefined,
    extractedAt: row.extracted_at as number,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  };
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

export function saveKit(input: CreateKitInput): StyleKit {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = Date.now();
  const extractedAt = input.extractedAt ?? now;

  db.run(
    `INSERT INTO extracted_style_kits
       (id, name, url, tokens, raw, screenshot, tags, notes, extracted_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.name,
      input.url,
      JSON.stringify(input.tokens),
      input.raw ? JSON.stringify(input.raw) : null,
      input.screenshot ?? null,
      JSON.stringify(input.tags ?? []),
      input.notes ?? null,
      extractedAt,
      now,
      now,
    ]
  );

  return {
    id,
    name: input.name,
    url: input.url,
    tokens: input.tokens,
    raw: input.raw,
    screenshot: input.screenshot,
    tags: input.tags ?? [],
    notes: input.notes,
    extractedAt,
    createdAt: now,
    updatedAt: now,
  };
}

export function getKit(id: string): StyleKit | null {
  const db = getDb();
  const row = db
    .query("SELECT * FROM extracted_style_kits WHERE id = ?")
    .get(id) as Record<string, unknown> | null;
  if (!row) return null;
  return rowToKit(row);
}

export function listKits(filter?: { tags?: string[]; search?: string }): StyleKit[] {
  const db = getDb();
  let sql = "SELECT * FROM extracted_style_kits ORDER BY created_at DESC";
  const rows = db.query(sql).all() as Record<string, unknown>[];
  let kits = rows.map(rowToKit);

  if (filter?.search) {
    const q = filter.search.toLowerCase();
    kits = kits.filter(
      (k) =>
        k.name.toLowerCase().includes(q) ||
        k.url.toLowerCase().includes(q) ||
        (k.notes ?? "").toLowerCase().includes(q) ||
        k.tags.some((t) => t.toLowerCase().includes(q))
    );
  }

  if (filter?.tags?.length) {
    kits = kits.filter((k) =>
      filter.tags!.every((t) => k.tags.includes(t))
    );
  }

  return kits;
}

export function updateKit(id: string, patch: Partial<Omit<StyleKit, "id" | "createdAt">>): StyleKit {
  const db = getDb();
  const existing = getKit(id);
  if (!existing) throw new Error(`Style kit not found: ${id}`);

  const merged = { ...existing, ...patch };
  const now = Date.now();

  db.run(
    `UPDATE extracted_style_kits SET
       name = ?, url = ?, tokens = ?, raw = ?, screenshot = ?,
       tags = ?, notes = ?, extracted_at = ?, updated_at = ?
     WHERE id = ?`,
    [
      merged.name,
      merged.url,
      JSON.stringify(merged.tokens),
      merged.raw ? JSON.stringify(merged.raw) : null,
      merged.screenshot ?? null,
      JSON.stringify(merged.tags),
      merged.notes ?? null,
      merged.extractedAt,
      now,
      id,
    ]
  );

  return { ...merged, updatedAt: now };
}

export function deleteKit(id: string): void {
  const db = getDb();
  db.run("DELETE FROM extracted_style_kits WHERE id = ?", [id]);
}

export function searchKits(query: string): StyleKit[] {
  return listKits({ search: query });
}

// ── Kit → Profile conversion ───────────────────────────────────────────────────

export function kitToProfile(kit: StyleKit, name: string): CreateProfileInput {
  const { tokens } = kit;

  // Build colors map from top extracted colors
  const colorsMap: Record<string, string> = {};
  tokens.colors.slice(0, 12).forEach((c, i) => {
    colorsMap[c.name ?? `color-${i + 1}`] = c.value;
  });

  // Build typography map
  const typography = {
    fontFamilies: tokens.typography.fontFamilies,
    fontSizes: tokens.typography.fontSizes,
    fontWeights: tokens.typography.fontWeights,
    lineHeights: tokens.typography.lineHeights,
    letterSpacings: tokens.typography.letterSpacings,
  };

  // Component rules from extracted tokens
  const componentRules = {
    borderRadius: tokens.borderRadius,
    shadows: tokens.shadows,
    spacing: tokens.spacing,
    transitions: tokens.transitions,
    zIndices: tokens.zIndices,
    gradients: tokens.gradients,
  };

  return {
    name,
    displayName: name,
    description: `Extracted from ${kit.url} on ${new Date(kit.extractedAt).toLocaleDateString()}`,
    category: "custom",
    principles: [],
    antiPatterns: [],
    typography,
    colors: colorsMap,
    componentRules,
    tags: ["extracted", ...kit.tags],
  };
}
