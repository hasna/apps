# React viewer (`@hasna/slides/react`)

A reveal.js-backed presentation component. `react` and `react-dom` are optional
peer dependencies — install them only when you use this entry point.

```tsx
import { Presentation } from "@hasna/slides/react";
// aliases: Deck, DeckViewer
```

## Usage

```tsx
import { Presentation } from "@hasna/slides/react";
import { createDeck, parseMarkdownDeck } from "@hasna/slides";

const deck = createDeck({ slides: parseMarkdownDeck(source) });

export function Preview() {
  return (
    <div style={{ height: 480 }}>
      <Presentation deck={deck} theme="black" embedded />
    </div>
  );
}
```

Accepts either a serializable `DeckData` or a `Deck` instance for the `deck`
prop. Give the viewer a sized container — reveal.js fills its parent.

## Props

| Prop | Type | Default | Notes |
| --- | --- | --- | --- |
| `deck` | `DeckData \| Deck` | — | Required. |
| `theme` | `string` | deck theme | reveal.js theme name. |
| `embedded` | `boolean` | `true` | Only capture keyboard/scroll while focused/hovered. |
| `controls` | `boolean` | deck config | Navigation arrows. |
| `progress` | `boolean` | deck config | Progress bar. |
| `slideNumber` | `boolean \| string` | — | Slide numbering. |
| `injectStyles` | `boolean` | `true` | Inject reveal core + theme CSS `<link>`s. |
| `cdnBase` | `string` | pinned jsDelivr | Base URL for injected styles. |
| `revealVersion` | `string` | `REVEAL_VERSION` | CDN pin. |
| `plugins` | `{ markdown?; notes?; highlight? }` | all `true` | Which plugins to load. |
| `onReady` | `(reveal) => void` | — | Fires after init. |
| `onSlideChanged` | `({ h, v }) => void` | — | Fires on navigation. |

## Behavior

- reveal.js and its plugins are **dynamically imported inside an effect**, so
  the component is safe in SSR frameworks (Next.js, etc.) — nothing reveal
  related executes on the server.
- The viewer re-initializes when the deck's slides, config, or theme change.
- Built-in interactions: arrow keys navigate, `O` toggles overview, `S` opens
  the speaker-notes window, and fragments advance on keypress.
- Styles: by default the component injects `<link>` tags for the reveal core
  and theme CSS from a pinned CDN. Set `injectStyles={false}` and import the
  CSS yourself if you prefer to bundle it.
