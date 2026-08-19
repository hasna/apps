/**
 * DOM tests for {@link Board} (Sol-guided Priority 3): pinned/others
 * sections and their headings, query/sort filtering, custom renderCard,
 * columns gridTemplateColumns, onOpenCard, and the canEdit gate
 * (editable && Boolean(onChange)).
 */
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { installTestDom, restoreTestDom } from "./test-dom.js";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { Board } from "./Board.js";
import type { Board as BoardData, Card as CardData } from "../types/index.js";

const PAST = "2020-01-01T00:00:00.000Z";

function noteCard(id: string, over: Partial<CardData> = {}): CardData {
  return {
    id,
    kind: "note",
    text: `note ${id}`,
    color: "default",
    labels: [],
    pinned: false,
    archived: false,
    order: 0,
    createdAt: PAST,
    updatedAt: PAST,
    ...over,
  };
}

function boardWith(cards: CardData[]): BoardData {
  return { id: "b1", title: "board", cards, createdAt: PAST, updatedAt: PAST };
}

beforeAll(() => {
  installTestDom();
});

afterAll(() => {
  restoreTestDom();
});

describe("Board sections and headings", () => {
  test("splits pinned and other cards into their own sections with headings", () => {
    const board = boardWith([
      noteCard("p1", { pinned: true, text: "pinned note" }),
      noteCard("o1", { text: "other one" }),
      noteCard("o2", { text: "other two" }),
    ]);
    const { container, getByText } = render(<Board board={board} />);

    const pinnedSection = container.querySelector('[data-section="pinned"]')!;
    const othersSection = container.querySelector('[data-section="others"]')!;
    expect(pinnedSection).not.toBeNull();
    expect(othersSection).not.toBeNull();
    expect(pinnedSection.querySelectorAll("article")).toHaveLength(1);
    expect(othersSection.querySelectorAll("article")).toHaveLength(2);
    expect(getByText("Pinned")).not.toBeNull();
    expect(getByText("Others")).not.toBeNull();
    cleanup();
  });

  test("Others heading is absent when there are no other cards", () => {
    const board = boardWith([noteCard("p1", { pinned: true }), noteCard("p2", { pinned: true })]);
    const { queryByText, container } = render(<Board board={board} />);

    expect(queryByText("Pinned")).not.toBeNull();
    expect(queryByText("Others")).toBeNull();
    expect(container.querySelector('[data-section="others"]')).not.toBeNull(); // section still rendered, empty
    cleanup();
  });

  test("Pinned heading is absent when nothing is pinned", () => {
    const board = boardWith([noteCard("o1"), noteCard("o2")]);
    const { queryByText } = render(<Board board={board} />);

    expect(queryByText("Pinned")).toBeNull();
    expect(queryByText("Others")).toBeNull(); // no pinned section above it either
    cleanup();
  });
});

describe("Board filtering, sorting, and layout", () => {
  test("applies the query filter and the sort", () => {
    const board = boardWith([
      noteCard("red1", { color: "red", text: "red card" }),
      noteCard("blue1", { color: "blue", text: "blue card" }),
    ]);
    const { container } = render(<Board board={board} query={{ color: "red" }} />);
    const articles = container.querySelectorAll("article");
    expect(articles).toHaveLength(1);
    expect(articles[0]!.getAttribute("data-color")).toBe("red");
    cleanup();
  });

  test("columns renders gridTemplateColumns on every grid", () => {
    const board = boardWith([
      noteCard("p1", { pinned: true }),
      noteCard("o1"),
      noteCard("o2"),
    ]);
    const { container } = render(<Board board={board} columns={3} />);
    const grids = container.querySelectorAll(".hasna-draw-board__grid");
    expect(grids.length).toBeGreaterThan(0);
    for (const grid of grids) {
      expect((grid as HTMLElement).style.gridTemplateColumns).toBe("repeat(3, minmax(0, 1fr))");
    }
    cleanup();
  });

  test("custom renderCard replaces the default card entirely", () => {
    const board = boardWith([noteCard("n1", { text: "hidden by custom renderer" })]);
    const { container, queryByText } = render(
      <Board board={board} renderCard={(card) => <div key={card.id}>custom-{card.id}</div>} />,
    );
    expect(queryByText("custom-n1")).not.toBeNull();
    expect(queryByText("hidden by custom renderer")).toBeNull();
    expect(container.querySelector(".hasna-draw-card")).toBeNull();
    cleanup();
  });

  test("onOpenCard fires with the card id when a card body is clicked", () => {
    const board = boardWith([noteCard("n1", { text: "open me" })]);
    const onOpenCard = mock<(id: string) => void>();
    const { getByText } = render(<Board board={board} onOpenCard={onOpenCard} />);

    fireEvent.click(getByText("open me"));
    expect(onOpenCard).toHaveBeenCalledTimes(1);
    expect(onOpenCard.mock.calls[0]![0]).toBe("n1");
    cleanup();
  });
});

describe("Board canEdit gate", () => {
  test("an onChange-less board has no controls even when editable", () => {
    const board = boardWith([noteCard("n1")]);
    const { container } = render(<Board board={board} editable />);
    expect(container.querySelector(".hasna-draw-card__actions")).toBeNull();
    expect(container.querySelector(".hasna-draw-card__swatch")).toBeNull();
    cleanup();
  });

  test("editable={false} with onChange also disables the controls", () => {
    const board = boardWith([noteCard("n1")]);
    const onChange = mock<(board: BoardData) => void>();
    const { container } = render(<Board board={board} onChange={onChange} editable={false} />);
    expect(container.querySelector(".hasna-draw-card__actions")).toBeNull();
    cleanup();
  });

  test("onChange with editable defaults to true shows pin/archive/color controls", () => {
    const board = boardWith([noteCard("n1")]);
    const onChange = mock<(board: BoardData) => void>();
    const { container } = render(<Board board={board} onChange={onChange} />);
    expect(container.querySelector(".hasna-draw-card__actions")).not.toBeNull();
    expect(container.querySelectorAll(".hasna-draw-card__swatch")).toHaveLength(10);
    // Clicking a control routes through the pure core and emits a NEW board.
    const pinButton = container.querySelector(".hasna-draw-card__action")!;
    fireEvent.click(pinButton);
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0]![0] as BoardData;
    expect(next.cards[0]!.pinned).toBe(true);
    cleanup();
  });

  test("onChange emits a patched board for a color change", () => {
    const board = boardWith([noteCard("n1")]);
    const onChange = mock<(board: BoardData) => void>();
    const { container } = render(<Board board={board} onChange={onChange} />);
    const swatch = container.querySelector('.hasna-draw-card__swatch[data-color="red"]')!;
    fireEvent.click(swatch);
    const next = onChange.mock.calls[0]![0] as BoardData;
    expect(next.cards[0]!.color).toBe("red");
    cleanup();
  });
});

describe("Board with a drawing card", () => {
  test("renders a drawing card as an SVG preview inside the grid", () => {
    const board = boardWith([
      {
        id: "d1",
        kind: "drawing",
        scene: { schema: "hasna.draw.scene", version: 1, elements: [] },
        color: "default",
        labels: [],
        pinned: false,
        archived: false,
        order: 0,
        createdAt: PAST,
        updatedAt: PAST,
      } as CardData,
    ]);
    const { container } = render(<Board board={board} />);
    const article = container.querySelector("article")!;
    expect(article.getAttribute("data-kind")).toBe("drawing");
    expect(article.querySelector(".hasna-draw-card__drawing svg")).not.toBeNull();
    cleanup();
  });
});
