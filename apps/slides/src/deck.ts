import { nanoid } from "nanoid";
import type {
  CreateDeckOptions,
  DeckConfig,
  DeckData,
  Slide,
  SlideInput,
  SlidePatch,
} from "./types.js";
import { DECK_SCHEMA_VERSION } from "./version.js";
import { exportDeckHtml, type ExportHtmlOptions } from "./export-html.js";
import { slidesToMarkdown } from "./markdown.js";
import { cloneDeckData, deserializeDeck } from "./serialize.js";

/** Default reveal.js theme used when none is supplied. */
export const DEFAULT_THEME = "black";

/** Default deck config. */
export const DEFAULT_CONFIG: DeckConfig = {
  controls: true,
  progress: true,
  center: true,
  hash: true,
  transition: "slide",
};

function nowIso(): string {
  return new Date().toISOString();
}

/** Normalize a {@link SlideInput} into a fully-formed {@link Slide}. */
export function normalizeSlide(input: SlideInput = {}): Slide {
  const slide: Slide = {
    id: nanoid(10),
    body: input.body ?? "",
    format: input.format ?? "markdown",
  };
  if (input.notes !== undefined) slide.notes = input.notes;
  if (input.fragments) slide.fragments = [...input.fragments];
  if (input.transition) slide.transition = input.transition;
  if (input.background) slide.background = input.background;
  if (input.autoAnimate) slide.autoAnimate = input.autoAnimate;
  if (input.attributes) slide.attributes = { ...input.attributes };
  if (input.children && input.children.length > 0) {
    // Vertical children are always leaves (children stripped).
    slide.children = input.children.map((child) => {
      const leaf = normalizeSlide(child);
      delete leaf.children;
      return leaf;
    });
  }
  return slide;
}

/**
 * A mutable, in-memory presentation deck. Wraps a serializable
 * {@link DeckData} and offers slide CRUD, vertical stacks, notes, theming, and
 * export helpers. Every mutation bumps `updatedAt`.
 */
export class Deck {
  private _data: DeckData;

  constructor(data: DeckData) {
    this._data = data;
  }

  /** The underlying serializable deck data (live reference). */
  get data(): DeckData {
    return this._data;
  }

  get id(): string {
    return this._data.id;
  }

  get title(): string {
    return this._data.title;
  }

  get theme(): string {
    return this._data.theme;
  }

  get slides(): Slide[] {
    return this._data.slides;
  }

  private touch(): void {
    this._data.updatedAt = nowIso();
  }

  /** Total number of slides, counting vertical children. */
  slideCount(): number {
    return this._data.slides.reduce(
      (sum, s) => sum + 1 + (s.children?.length ?? 0),
      0,
    );
  }

  /** Append a slide (or insert at `index`) and return it. */
  addSlide(input: SlideInput = {}, index?: number): Slide {
    const slide = normalizeSlide(input);
    if (index === undefined || index >= this._data.slides.length) {
      this._data.slides.push(slide);
    } else {
      this._data.slides.splice(Math.max(0, index), 0, slide);
    }
    this.touch();
    return slide;
  }

  /** Add a vertical sub-slide under `parentId`. Returns the new child. */
  addChild(parentId: string, input: SlideInput = {}, index?: number): Slide {
    const parent = this._data.slides.find((s) => s.id === parentId);
    if (!parent) throw new Error(`No top-level slide with id "${parentId}"`);
    const child = normalizeSlide(input);
    delete child.children;
    if (!parent.children) parent.children = [];
    if (index === undefined || index >= parent.children.length) {
      parent.children.push(child);
    } else {
      parent.children.splice(Math.max(0, index), 0, child);
    }
    this.touch();
    return child;
  }

  /** Find a slide by id, searching top-level slides and vertical children. */
  getSlide(id: string): Slide | undefined {
    for (const slide of this._data.slides) {
      if (slide.id === id) return slide;
      const child = slide.children?.find((c) => c.id === id);
      if (child) return child;
    }
    return undefined;
  }

  /** Apply a partial patch to a slide (top-level or child). Returns it. */
  updateSlide(id: string, patch: SlidePatch): Slide {
    const slide = this.getSlide(id);
    if (!slide) throw new Error(`No slide with id "${id}"`);
    Object.assign(slide, patch);
    this.touch();
    return slide;
  }

  /** Set (or clear) speaker notes for a slide. */
  setNotes(id: string, notes: string | undefined): Slide {
    const slide = this.getSlide(id);
    if (!slide) throw new Error(`No slide with id "${id}"`);
    if (notes === undefined || notes === "") {
      delete slide.notes;
    } else {
      slide.notes = notes;
    }
    this.touch();
    return slide;
  }

  /** Remove a slide (top-level or child). Returns whether one was removed. */
  removeSlide(id: string): boolean {
    const topIndex = this._data.slides.findIndex((s) => s.id === id);
    if (topIndex !== -1) {
      this._data.slides.splice(topIndex, 1);
      this.touch();
      return true;
    }
    for (const slide of this._data.slides) {
      if (!slide.children) continue;
      const childIndex = slide.children.findIndex((c) => c.id === id);
      if (childIndex !== -1) {
        slide.children.splice(childIndex, 1);
        if (slide.children.length === 0) delete slide.children;
        this.touch();
        return true;
      }
    }
    return false;
  }

  /** Move a top-level slide to a new index. Returns whether it moved. */
  moveSlide(id: string, toIndex: number): boolean {
    const from = this._data.slides.findIndex((s) => s.id === id);
    if (from === -1) return false;
    const [slide] = this._data.slides.splice(from, 1);
    const clamped = Math.max(0, Math.min(toIndex, this._data.slides.length));
    this._data.slides.splice(clamped, 0, slide!);
    this.touch();
    return true;
  }

  setTitle(title: string): this {
    this._data.title = title;
    this.touch();
    return this;
  }

  setTheme(theme: string): this {
    this._data.theme = theme;
    this.touch();
    return this;
  }

  /** Shallow-merge a config patch. */
  setConfig(patch: DeckConfig): this {
    this._data.config = { ...this._data.config, ...patch };
    this.touch();
    return this;
  }

  /** Merge arbitrary metadata. */
  setMeta(meta: Record<string, unknown>): this {
    this._data.meta = { ...(this._data.meta ?? {}), ...meta };
    this.touch();
    return this;
  }

  /** A deep-cloned copy of the serializable deck data. */
  toJSON(): DeckData {
    return cloneDeckData(this._data);
  }

  /** Export a standalone reveal.js HTML document. */
  toHtml(options?: ExportHtmlOptions): string {
    return exportDeckHtml(this._data, options);
  }

  /** Render slides to reveal.js Markdown authoring syntax. */
  toMarkdown(): string {
    return slidesToMarkdown(this._data.slides);
  }

  /** An independent deep-cloned Deck. */
  clone(): Deck {
    return new Deck(cloneDeckData(this._data));
  }
}

/** Create a new, empty (or pre-populated) deck. */
export function createDeck(options: CreateDeckOptions = {}): Deck {
  const now = nowIso();
  const data: DeckData = {
    id: options.id ?? nanoid(12),
    title: options.title ?? "Untitled Deck",
    theme: options.theme ?? DEFAULT_THEME,
    config: { ...DEFAULT_CONFIG, ...(options.config ?? {}) },
    slides: (options.slides ?? []).map(normalizeSlide),
    createdAt: now,
    updatedAt: now,
    version: DECK_SCHEMA_VERSION,
  };
  if (options.meta) data.meta = { ...options.meta };
  return new Deck(data);
}

/**
 * Load a deck from serialized {@link DeckData} (a JSON string or a plain
 * object). The input is validated; malformed decks throw.
 */
export function loadDeck(input: string | unknown): Deck {
  const data = deserializeDeck(input);
  return new Deck(data);
}
