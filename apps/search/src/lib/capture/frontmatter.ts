import { z } from "zod";
import { SearchProviderNameSchema } from "../../types/index.js";

/**
 * Frontmatter metadata schema for auto-saved search captures (I38-00188).
 *
 * One capture = one markdown document in the S3 md corpus; the frontmatter
 * carries the provenance of the capture itself so a capture is readable
 * without any index. Keep this schema forward-compatible: unknown extra
 * keys are preserved on parse and stripped on render only when they were
 * not present in the input.
 */

export const CAPTURE_SCHEMA_VERSION = 1;
export const CAPTURE_KIND = "search-capture";

export const CapturePointSchema = z.enum(["cli", "mcp", "server", "sdk"]);
export type CapturePoint = z.infer<typeof CapturePointSchema>;

export const CaptureFrontmatterSchema = z.object({
  schema_version: z.literal(CAPTURE_SCHEMA_VERSION),
  capture_id: z.string().min(1),
  kind: z.literal(CAPTURE_KIND),
  query: z.string().min(1),
  providers: z.array(SearchProviderNameSchema),
  profile_id: z.string().nullable(),
  result_count: z.number().int().min(0),
  duration_ms: z.number().int().min(0),
  captured_at: z.string().datetime(),
  capture_point: CapturePointSchema,
  redacted: z.boolean(),
});
export type CaptureFrontmatter = z.infer<typeof CaptureFrontmatterSchema>;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CAPTURE_ID_RE = /^[a-zA-Z0-9_-]+$/;

/** Validate the free-form pieces the schema cannot: date shape and key safety. */
export function assertValidCorpusDate(date: string): void {
  if (!DATE_RE.test(date)) {
    throw new Error(`invalid corpus date: ${date} (expected yyyy-mm-dd)`);
  }
}

/** Validate a capture id for use in an S3 key segment (no slashes, no dots). */
export function assertValidCaptureId(captureId: string): void {
  if (!CAPTURE_ID_RE.test(captureId)) {
    throw new Error(
      `invalid capture id: ${captureId} (allowed: letters, digits, _ and -)`,
    );
  }
}

function yamlScalar(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  const text = String(value);
  // Quote when the plain form would be ambiguous or multi-line.
  if (/^[\s\-?:,.[\]{}#&*!|>'"%@`]/.test(text) || /[:#]\s/.test(text) || text.includes("\n")) {
    return JSON.stringify(text);
  }
  return text;
}

function yamlArray(values: readonly unknown[]): string {
  const lines = values.map((v) => `  - ${yamlScalar(v)}`);
  return lines.join("\n");
}

/** Render frontmatter as YAML block (without the surrounding `---` fences). */
export function renderFrontmatter(fm: CaptureFrontmatter): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(fm)) {
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      lines.push(yamlArray(value));
    } else {
      lines.push(`${key}: ${yamlScalar(value)}`);
    }
  }
  return lines.join("\n");
}

function parseYamlValue(raw: string): unknown {
  const text = raw.trim();
  if (text === "null") return null;
  if (text === "true") return true;
  if (text === "false") return false;
  if (/^-?\d+$/.test(text)) return Number(text);
  if (/^".*"$/.test(text) || /^'.*'$/.test(text)) {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text.slice(1, -1);
    }
  }
  return text;
}

function parseYamlList(lines: string[], start: number): { values: unknown[]; next: number } {
  const values: unknown[] = [];
  let i = start;
  for (; i < lines.length; i++) {
    const m = lines[i]?.match(/^  - (.*)$/);
    if (!m) break;
    values.push(parseYamlValue(m[1] ?? ""));
  }
  return { values, next: i };
}

/**
 * Parse a frontmatter YAML block (without the `---` fences). Unknown keys
 * are preserved so newer captures remain readable by older readers.
 */
export function parseFrontmatter(yaml: string): Record<string, unknown> {
  const lines = yaml.split("\n");
  const out: Record<string, unknown> = {};
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line || line.trim() === "") {
      i++;
      continue;
    }
    if (line.startsWith("  - ")) {
      throw new Error(`unexpected list item at line ${i + 1} without a key`);
    }
    const colon = line.indexOf(":");
    if (colon < 0) {
      throw new Error(`malformed frontmatter line ${i + 1}: ${line}`);
    }
    const key = line.slice(0, colon).trim();
    const rest = line.slice(colon + 1).trim();
    if (rest === "") {
      const list = parseYamlList(lines, i + 1);
      out[key] = list.values;
      i = list.next;
    } else {
      out[key] = parseYamlValue(rest);
      i++;
    }
  }
  return out;
}

/** Render a full capture document: `---` fences + frontmatter. */
export function renderFrontmatterBlock(fm: CaptureFrontmatter): string {
  return `---\n${renderFrontmatter(fm)}\n---`;
}

/**
 * Parse a full capture document and validate the frontmatter against the
 * schema. Throws when the frontmatter is missing or invalid.
 */
export function parseCaptureDocument(markdown: string): CaptureFrontmatter {
  if (!markdown.startsWith("---\n")) {
    throw new Error("capture document is missing its frontmatter fence");
  }
  const end = markdown.indexOf("\n---", 4);
  if (end < 0) {
    throw new Error("capture document frontmatter is not closed");
  }
  const yaml = markdown.slice(4, end);
  const parsed = parseFrontmatter(yaml);
  return CaptureFrontmatterSchema.parse(parsed);
}
