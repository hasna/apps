# Headless SDK (`@hasna/slides`)

The core SDK is framework-agnostic and serializable. A deck is fully described
by a plain JSON object (`DeckData`); every rendering path (HTML export, React
viewer) is derived from that model.

## Data model

```ts
interface DeckData {
  id: string;
  title: string;
  theme: string;            // reveal.js theme name
  config: DeckConfig;       // reveal.js options (typed well-known keys + passthrough)
  slides: Slide[];
  meta?: Record<string, unknown>;
  createdAt: string;        // ISO-8601
  updatedAt: string;        // ISO-8601
  version: number;          // schema version
}

interface Slide {
  id: string;
  body: string;
  format: "markdown" | "html";
  notes?: string;
  fragments?: string[];
  transition?: "none" | "fade" | "slide" | "convex" | "concave" | "zoom";
  background?: string;      // color -> data-background-color; else image URL
  autoAnimate?: boolean;
  attributes?: Record<string, string>;
  children?: Slide[];       // vertical stack (one level deep)
}
```

## Creating and editing

```ts
import { createDeck } from "@hasna/slides";

const deck = createDeck({ title: "Q3 Review", theme: "night" });

const a = deck.addSlide({ body: "# Q3 Review" });          // append
const c = deck.addSlide({ body: "## Wrap up" });
deck.addSlide({ body: "## Metrics" }, 1);                  // insert at index 1

deck.updateSlide(a.id, { transition: "zoom" });
deck.setNotes(a.id, "Pause for questions.");
deck.moveSlide(c.id, 0);
deck.removeSlide(c.id);
```

### Vertical stacks

```ts
const parent = deck.addSlide({ body: "## Architecture" });
deck.addChild(parent.id, { body: "### Data flow" });
deck.addChild(parent.id, { body: "### Failure modes" });
```

`deck.slideCount()` counts top-level slides plus their vertical children.
Grandchildren are not supported (reveal.js allows a single vertical level) and
are stripped when a slide is normalized.

## Serialization

```ts
import { serializeDeck, deserializeDeck } from "@hasna/slides";

const json = serializeDeck(deck.toJSON());       // string
const restored = deserializeDeck(json);          // validated DeckData (throws if malformed)
```

`loadDeck(input)` accepts a JSON string or a plain object, validates it with
zod, and returns a `Deck`.

## Markdown authoring

`parseMarkdownDeck(md)` converts a reveal.js-style Markdown string into slide
inputs; `slidesToMarkdown(slides)` renders the inverse. See
[`export.md`](./export.md) for how markdown slides are emitted at export time.
