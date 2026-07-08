import type { Slide, SlideInput } from "./types.js";

/**
 * Parse a single authoring string in reveal.js Markdown deck convention into
 * an array of {@link SlideInput} (markdown-format slides).
 *
 * Delimiters (each must be alone on its own line):
 *   - `---` starts a new top-level (horizontal) slide.
 *   - `--`  starts a new vertical sub-slide under the current top-level slide.
 *
 * Speaker notes use reveal.js' `Note:` convention: within a slide, a line
 * beginning with `Note:` marks the start of speaker notes; the remainder of
 * that line plus all following lines (until the next slide delimiter) become
 * the slide's notes and are stripped from the body.
 *
 * @example
 * ```md
 * # Title
 * Welcome
 * ---
 * ## Agenda
 * - one
 * - two
 * Note: remember to smile
 * --
 * ### Detail
 * more depth
 * ```
 */
export function parseMarkdownDeck(markdown: string): SlideInput[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");

  // Group lines into horizontal groups, each of which is a list of vertical
  // sub-groups. body + notes are extracted per sub-group afterwards.
  const horizontals: string[][][] = [];
  let currentHorizontal: string[][] = [[]];
  horizontals.push(currentHorizontal);

  const pushHorizontal = () => {
    currentHorizontal = [[]];
    horizontals.push(currentHorizontal);
  };
  const pushVertical = () => {
    currentHorizontal.push([]);
  };
  const appendLine = (line: string) => {
    const sub = currentHorizontal[currentHorizontal.length - 1]!;
    sub.push(line);
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "---") {
      pushHorizontal();
    } else if (trimmed === "--") {
      pushVertical();
    } else {
      appendLine(line);
    }
  }

  const toSlide = (raw: string[]): SlideInput | null => {
    const { body, notes } = splitNotes(raw);
    const trimmedBody = body.trim();
    if (trimmedBody === "" && !notes) return null;
    const slide: SlideInput = { body: trimmedBody, format: "markdown" };
    if (notes) slide.notes = notes;
    return slide;
  };

  const result: SlideInput[] = [];
  for (const horizontal of horizontals) {
    const subs = horizontal.map(toSlide).filter((s): s is SlideInput => s !== null);
    if (subs.length === 0) continue;
    const [head, ...rest] = subs;
    if (rest.length > 0) head!.children = rest;
    result.push(head!);
  }
  return result;
}

function splitNotes(raw: string[]): { body: string; notes?: string } {
  const noteIndex = raw.findIndex((l) => /^\s*Note:/.test(l));
  if (noteIndex === -1) return { body: raw.join("\n") };
  const bodyLines = raw.slice(0, noteIndex);
  const firstNote = raw[noteIndex]!.replace(/^\s*Note:\s?/, "");
  const restNotes = raw.slice(noteIndex + 1);
  const notes = [firstNote, ...restNotes].join("\n").trim();
  return { body: bodyLines.join("\n"), notes: notes || undefined };
}

/**
 * Render slides back into a reveal.js Markdown authoring string. This is the
 * inverse of {@link parseMarkdownDeck} for markdown-format slides and is used
 * by the dashboard to keep the editor textarea in sync with the model.
 *
 * HTML-format slides are emitted verbatim (they are already HTML).
 */
export function slidesToMarkdown(slides: Slide[]): string {
  const renderOne = (slide: Slide): string => {
    let out = slide.body;
    if (slide.notes) {
      out += `\n\nNote: ${slide.notes}`;
    }
    return out;
  };

  const blocks: string[] = [];
  for (const slide of slides) {
    const stack: string[] = [renderOne(slide)];
    for (const child of slide.children ?? []) {
      stack.push(renderOne(child));
    }
    blocks.push(stack.join("\n\n--\n\n"));
  }
  return blocks.join("\n\n---\n\n");
}
