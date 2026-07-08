/**
 * @hasna/slides — headless presentation-deck SDK.
 *
 * This barrel is framework-agnostic and safe to use server-side. The React
 * reveal.js viewer lives at the `@hasna/slides/react` subpath so that consumers
 * that only need the data model / HTML export never pull in React or reveal.js
 * at runtime.
 */

// Core deck model + CRUD
export {
  Deck,
  createDeck,
  loadDeck,
  normalizeSlide,
  DEFAULT_THEME,
  DEFAULT_CONFIG,
} from "./deck.js";

// Serialization
export { serializeDeck, deserializeDeck, cloneDeckData } from "./serialize.js";

// Standalone HTML export + slide rendering
export {
  exportDeckHtml,
  renderSlidesFragment,
  looksLikeColor,
  type ExportHtmlOptions,
  type InlineAssets,
} from "./export-html.js";

// Markdown authoring
export { parseMarkdownDeck, slidesToMarkdown } from "./markdown.js";

// Validation
export {
  parseDeckData,
  safeParseDeckData,
  deckDataSchema,
  slideSchema,
  deckConfigSchema,
  slideTransitionSchema,
  slideBodyFormatSchema,
} from "./validation.js";

// Types
export type {
  Slide,
  SlideInput,
  SlidePatch,
  SlideTransition,
  TransitionSpeed,
  SlideBodyFormat,
  DeckConfig,
  DeckData,
  CreateDeckOptions,
} from "./types.js";

// Version constants
export { VERSION, REVEAL_VERSION, DECK_SCHEMA_VERSION } from "./version.js";
