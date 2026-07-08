/**
 * Read-only analysis of a document: plain-text extraction, outline, and stats.
 */
import type {
  DocJSON,
  DocNode,
  DocumentStats,
  HeadingLevel,
  OutlineEntry,
} from "../types/index.js";

const BLOCK_SEPARATOR = "\n";

/** Extract the concatenated text of a node subtree (no formatting). */
export function nodeText(node: DocNode): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return "\n";
  if (!node.content || node.content.length === 0) return "";
  return node.content.map(nodeText).join("");
}

/**
 * Extract the plain text of a whole document, inserting blank lines between
 * top-level blocks so paragraphs and headings stay separated.
 */
export function toText(doc: DocJSON): string {
  const blocks = doc.content ?? [];
  return blocks
    .map((block) => {
      if (block.type === "horizontalRule") return "";
      return nodeText(block);
    })
    .join(BLOCK_SEPARATOR)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Slugify heading text into a URL-safe id. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Build the document outline from its headings. Slug ids are de-duplicated by
 * appending `-1`, `-2`, ... on collision.
 */
export function getOutline(doc: DocJSON): OutlineEntry[] {
  const entries: OutlineEntry[] = [];
  const seen = new Map<string, number>();
  const blocks = doc.content ?? [];
  blocks.forEach((block, index) => {
    if (block.type !== "heading") return;
    const level = Number(
      (block.attrs?.level as number | undefined) ?? 1,
    ) as HeadingLevel;
    const textValue = nodeText(block).trim();
    const base = slugify(textValue) || `heading-${index}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    const id = count === 0 ? base : `${base}-${count}`;
    entries.push({ level, text: textValue, index, id });
  });
  return entries;
}

function countWordsInString(value: string): number {
  const trimmed = value.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/u).length;
}

/** Compute word/character/reading-time statistics for a document. */
export function countWords(doc: DocJSON): DocumentStats {
  const blocks = doc.content ?? [];
  let words = 0;
  let characters = 0;
  let charactersNoSpaces = 0;
  let paragraphs = 0;
  let headings = 0;

  const walk = (node: DocNode): void => {
    if (node.type === "text") {
      const value = node.text ?? "";
      words += countWordsInString(value);
      characters += [...value].length;
      charactersNoSpaces += [...value.replace(/\s/gu, "")].length;
      return;
    }
    if (node.content) node.content.forEach(walk);
  };

  for (const block of blocks) {
    if (block.type === "paragraph") paragraphs += 1;
    if (block.type === "heading") headings += 1;
    walk(block);
  }

  const plain = toText(doc);
  const sentences = plain
    ? plain.split(/[.!?]+(?:\s|$)/u).filter((s) => s.trim().length > 0).length
    : 0;

  return {
    words,
    characters,
    charactersNoSpaces,
    paragraphs,
    headings,
    sentences,
    readingTimeMinutes: Math.max(words > 0 ? 1 : 0, Math.ceil(words / 200)),
  };
}
