# @hasna/draw

[![npm](https://img.shields.io/npm/v/@hasna/draw.svg)](https://www.npmjs.com/package/@hasna/draw)
[![license](https://img.shields.io/npm/l/@hasna/draw.svg)](./LICENSE)

Headless board **SDK** for quick notes and freehand drawings, in the spirit of Google Keep.
A framework agnostic board and card model with a portable, renderer free drawing scene that
is compatible with [Excalidraw](https://excalidraw.com) for interchange, plus optional React
board, card, and draw surface components.

- **Headless core (`@hasna/draw`)**: framework agnostic. Runs anywhere (Node, Bun, edge,
  browser) with no DOM and no drawing engine. Create boards, add note and drawing cards,
  pin / archive / reorder / recolor, query and count, and import / export **JSON** and
  **Excalidraw** scenes.
- **React components (`@hasna/draw/react`)**: a Keep style `<Board>`, a `<Card>` that
  renders notes or a read only drawing preview, a hand rolled SVG `<DrawSurface>` for
  freehand sketching, and a `<NoteEditor>`. They read and write the *same* JSON the headless
  SDK produces.
- **CLI (`draw`)**: create boards, add cards, list, export to Excalidraw, and print stats,
  all over board JSON files.

The drawing scene is plain data shaped to map cleanly onto Excalidraw, so a sketch made in
the browser round trips through the SDK unchanged, and a platform can later feed the same
scene to a real Excalidraw canvas through `toExcalidraw` / `fromExcalidraw`.

## Install

```bash
bun add @hasna/draw        # or: npm i @hasna/draw
bun install -g @hasna/draw # for the `draw` CLI
```

React is an optional peer dependency; install it only if you use `@hasna/draw/react`:

```bash
bun add react react-dom
```

Installing this library creates no application directories in HOME or XDG roots.
The CLI writes only the board file you supply; omitting the file in `draw create`
prints the board to stdout. Reads and exports do not create an implicit store.

## Headless SDK

```ts
import { createBoard } from "@hasna/draw";

const board = createBoard({ title: "Ideas" })
  .addNote({ title: "Groceries", text: "milk\neggs", color: "yellow" })
  .addDrawing({ title: "Wireframe" })
  .addNote({ text: "Ship the beta", pinned: true });

board.query();                 // pinned cards first, then by order
board.stats();                 // { total, notes, drawings, pinned, archived, colors }
const json = board.serialize(true);
```

Load and validate an existing board (envelope or bare object, string or parsed):

```ts
import { loadBoard } from "@hasna/draw";

const restored = loadBoard(json);
```

Functional helpers are exported too (`addCard`, `updateCard`, `deleteCard`, `reorderCard`,
`pinCard`, `archiveCard`, `setCardColor`, `listCards`, `searchBoard`, `boardStats`,
`serializeBoard`, `parseBoard`, `note`, `drawing`, scene builders, …). See
[docs/sdk.md](./docs/sdk.md).

### Drawing scenes

```ts
import { createScene, addStroke, toExcalidraw, fromExcalidraw } from "@hasna/draw";

const scene = addStroke(createScene(), [
  [0, 0],
  [10, 20],
  [30, 15],
]);

const file = toExcalidraw(scene);   // a portable .excalidraw file
const back = fromExcalidraw(file);  // normalized scene, unknown types dropped
```

A scene is just data: a versioned list of `DrawElement`s (freedraw, line, arrow, rectangle,
ellipse, diamond, text) with no canvas or renderer dependency. See
[docs/drawing.md](./docs/drawing.md).

## React components

```tsx
import { useState } from "react";
import { Board } from "@hasna/draw/react";
import type { Board as BoardData } from "@hasna/draw";

export function MyBoard({ initial }: { initial: BoardData }) {
  const [board, setBoard] = useState(initial);
  return <Board board={board} onChange={setBoard} editable />;
}
```

The components ship no CSS of their own. They render semantic classes
(`hasna-draw-board`, `hasna-draw-card`, `hasna-draw-card[data-color]`, `hasna-draw-surface`)
you style yourself. See [docs/react-board.md](./docs/react-board.md) and the `dashboard/` demo.

## CLI

```bash
draw create board.json --title "Ideas"      # new empty board
draw add board.json --note "buy milk" --color yellow
draw add board.json --drawing --scene sketch.excalidraw.json
draw list board.json                         # table of cards
draw export board.json --to excalidraw       # export a scene as Excalidraw JSON
draw stats board.json                        # counts by kind / color / state
```

## Development

Release packing requires npm >=11 (tested with 11.19.0); older npm versions can run
`prepare` even with `--ignore-scripts`. `prepack` builds before scanning the
actual npm archive. When invoking `scan:artifact` directly, run `bun run build`
first. The scanner disables lifecycle recursion and overrides inherited dry-run
configuration so the checked archive always exists.

```bash
bun install
bun test          # unit tests
bun run typecheck # tsc --noEmit
bun run build     # library + react + cli + type declarations
cd dashboard && bun install && bun run dev   # live Keep style board demo
```

## License

[Apache-2.0](./LICENSE) © Hasna. Excalidraw interchange is a data format bridge; this
package bundles no Excalidraw code.
