/**
 * Core data model for a presentation deck.
 *
 * The model is framework-agnostic and serializable: a {@link DeckData} is a
 * plain JSON object that fully describes a deck. Rendering (standalone HTML
 * export, React viewer) is derived from this model and never the other way
 * around.
 */

/** reveal.js built-in slide transitions. */
export type SlideTransition =
  | "none"
  | "fade"
  | "slide"
  | "convex"
  | "concave"
  | "zoom";

/** Transition speed presets. */
export type TransitionSpeed = "default" | "fast" | "slow";

/** How a slide body should be interpreted when rendered. */
export type SlideBodyFormat = "markdown" | "html";

/**
 * A single slide.
 *
 * A slide with `children` becomes a *vertical stack*: reveal.js renders the
 * slide's own body as the top of the stack and each child below it, navigable
 * with the down arrow. Children may not themselves contain children (reveal.js
 * only supports a single level of vertical nesting).
 */
export interface Slide {
  /** Stable unique id (nanoid). */
  id: string;
  /** Slide body, interpreted per {@link Slide.format}. */
  body: string;
  /** Body format. Defaults to `"markdown"` when a slide is created. */
  format: SlideBodyFormat;
  /** Speaker notes shown in the reveal.js notes/presenter view. */
  notes?: string;
  /**
   * Extra fragment lines. Each entry is revealed on a successive keypress and
   * is rendered with reveal.js' `fragment` class.
   */
  fragments?: string[];
  /** Per-slide transition override. */
  transition?: SlideTransition;
  /**
   * Slide background. A value that looks like a CSS color (`#rrggbb`,
   * `rgb(...)`, or a bare CSS color keyword) becomes `data-background-color`;
   * anything else is treated as an image URL (`data-background-image`).
   */
  background?: string;
  /** Enable reveal.js auto-animate between this slide and the next. */
  autoAnimate?: boolean;
  /** Arbitrary extra attributes applied to the generated `<section>`. */
  attributes?: Record<string, string>;
  /** Vertical sub-slides. When present, this slide is the top of a stack. */
  children?: Slide[];
}

/** Input accepted when adding/creating a slide (id + format are optional). */
export interface SlideInput {
  body?: string;
  format?: SlideBodyFormat;
  notes?: string;
  fragments?: string[];
  transition?: SlideTransition;
  background?: string;
  autoAnimate?: boolean;
  attributes?: Record<string, string>;
  children?: SlideInput[];
}

/** Patch accepted by `updateSlide` — every field is optional. */
export type SlidePatch = Partial<Omit<Slide, "id" | "children">>;

/**
 * Deck-wide reveal.js configuration. Well-known keys are typed; any other
 * reveal.js option may be passed through and is forwarded verbatim to
 * `Reveal.initialize`.
 */
export interface DeckConfig {
  transition?: SlideTransition;
  transitionSpeed?: TransitionSpeed;
  controls?: boolean;
  progress?: boolean;
  slideNumber?: boolean | string;
  center?: boolean;
  loop?: boolean;
  hash?: boolean;
  autoSlide?: number;
  width?: number;
  height?: number;
  margin?: number;
  /** Passthrough for any additional reveal.js option. */
  [key: string]: unknown;
}

/**
 * The complete serializable representation of a deck. This is what
 * `serializeDeck` produces and `deserializeDeck` / `loadDeck` consume.
 */
export interface DeckData {
  /** Stable unique deck id (nanoid). */
  id: string;
  /** Human-readable deck title (used as the `<title>` on HTML export). */
  title: string;
  /** reveal.js theme name (e.g. `black`, `white`, `league`, `moon`). */
  theme: string;
  /** Deck-wide reveal.js config. */
  config: DeckConfig;
  /** Ordered top-level slides. */
  slides: Slide[];
  /** Arbitrary app-defined metadata (author, tags, etc.). */
  meta?: Record<string, unknown>;
  /** ISO-8601 creation timestamp. */
  createdAt: string;
  /** ISO-8601 last-modified timestamp. */
  updatedAt: string;
  /** Deck schema version, see {@link DECK_SCHEMA_VERSION}. */
  version: number;
}

/** Options for {@link createDeck}. */
export interface CreateDeckOptions {
  id?: string;
  title?: string;
  theme?: string;
  config?: DeckConfig;
  slides?: SlideInput[];
  meta?: Record<string, unknown>;
}
