/**
 * DOM tests for {@link Card} (Sol-guided Priority 3): note versus drawing
 * rendering, previewHeight, the controls-require-writable-and-handler gate,
 * stopPropagation on pin/archive/color clicks, data attributes, ColorControls
 * aria-pressed/data-active, article-body-only onOpen, and Pin/Unpin labels.
 */
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { installTestDom, restoreTestDom } from "./test-dom.js";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { Card } from "./Card.js";
import type { Card as CardData, CardPatch } from "../types/index.js";

const PAST = "2020-01-01T00:00:00.000Z";

function noteCard(over: Partial<CardData> = {}): CardData {
  return {
    id: "n1",
    kind: "note",
    text: "note body",
    title: "Note Title",
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

beforeAll(() => {
  installTestDom();
});

afterAll(() => {
  restoreTestDom();
});

describe("Card rendering", () => {
  test("a note card renders title, text, and data attributes", () => {
    const card = noteCard({ pinned: true, archived: false, color: "yellow", labels: ["a"] });
    const { container, getByText } = render(<Card card={card} />);

    const article = container.querySelector("article")!;
    expect(article.getAttribute("data-kind")).toBe("note");
    expect(article.getAttribute("data-color")).toBe("yellow");
    expect(article.getAttribute("data-pinned")).toBe("true");
    expect(article.getAttribute("data-archived")).toBeNull(); // false is not rendered
    expect(getByText("Note Title")).not.toBeNull();
    expect(getByText("note body")).not.toBeNull();
    expect(getByText("a")).not.toBeNull(); // label
    expect(container.querySelector(".hasna-draw-card__drawing")).toBeNull();
    cleanup();
  });

  test("a drawing card renders an SVG preview with the exact previewHeight", () => {
    const card: CardData = {
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
    };
    const { container } = render(<Card card={card} previewHeight={240} />);
    const svg = container.querySelector(".hasna-draw-card__drawing svg")!;
    expect(svg).not.toBeNull();
    expect(svg.getAttribute("height")).toBe("240");
    expect(container.querySelector(".hasna-draw-card__text")).toBeNull();
    cleanup();
  });
});

describe("Card controls gate", () => {
  test("readOnly hides every control", () => {
    const { container } = render(
      <Card card={noteCard()} readOnly onPin={() => undefined} onArchive={() => undefined} onChange={() => undefined} />,
    );
    expect(container.querySelector(".hasna-draw-card__actions")).toBeNull();
    cleanup();
  });

  test("no handlers hides every control even when writable", () => {
    const { container } = render(<Card card={noteCard()} />);
    expect(container.querySelector(".hasna-draw-card__actions")).toBeNull();
    cleanup();
  });

  test("only the provided handlers render their controls", () => {
    const { container } = render(<Card card={noteCard()} onPin={() => undefined} />);
    const actions = container.querySelector(".hasna-draw-card__actions")!;
    expect(actions).not.toBeNull();
    expect(actions.querySelectorAll("button")).toHaveLength(1); // pin only
    expect(container.querySelector(".hasna-draw-card__swatch")).toBeNull();
    cleanup();
  });
});

describe("Card stopPropagation", () => {
  test("pin click does not trigger onOpen and toggles the label", () => {
    const onOpen = mock<() => void>();
    const onPin = mock<() => void>();
    const { getByText } = render(<Card card={noteCard()} onOpen={onOpen} onPin={onPin} />);

    const pin = getByText("Pin");
    fireEvent.click(pin);
    expect(onPin).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
    cleanup();
  });

  test("archive click does not trigger onOpen", () => {
    const onOpen = mock<() => void>();
    const onArchive = mock<() => void>();
    const { getByText } = render(<Card card={noteCard()} onOpen={onOpen} onArchive={onArchive} />);

    fireEvent.click(getByText("Archive"));
    expect(onArchive).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
    cleanup();
  });

  test("color swatch click does not trigger onOpen and emits the exact patch", () => {
    const onOpen = mock<() => void>();
    const onChange = mock<(patch: CardPatch) => void>();
    const { container } = render(<Card card={noteCard()} onOpen={onOpen} onChange={onChange} />);

    const swatch = container.querySelector('.hasna-draw-card__swatch[data-color="green"]')!;
    fireEvent.click(swatch);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]![0]).toEqual({ color: "green" });
    expect(onOpen).not.toHaveBeenCalled();
    cleanup();
  });
});

describe("ColorControls", () => {
  test("marks the active swatch with aria-pressed and data-active", () => {
    const { container } = render(<Card card={noteCard({ color: "blue" })} onChange={() => undefined} />);
    const active = container.querySelector('.hasna-draw-card__swatch[data-color="blue"]')!;
    const inactive = container.querySelector('.hasna-draw-card__swatch[data-color="red"]')!;
    expect(active.getAttribute("aria-pressed")).toBe("true");
    expect(active.getAttribute("data-active")).toBe("true");
    expect(inactive.getAttribute("aria-pressed")).toBe("false");
    expect(inactive.getAttribute("data-active")).toBeNull();
    cleanup();
  });
});

describe("Card onOpen", () => {
  test("clicking the article body fires onOpen exactly once", () => {
    const onOpen = mock<() => void>();
    const { getByText } = render(<Card card={noteCard()} onOpen={onOpen} />);
    fireEvent.click(getByText("note body"));
    expect(onOpen).toHaveBeenCalledTimes(1);
    cleanup();
  });

  test("Pin and Unpin labels switch with the pinned flag", () => {
    const { getByText, rerender } = render(<Card card={noteCard()} onPin={() => undefined} />);
    expect(getByText("Pin")).not.toBeNull();
    rerender(<Card card={noteCard({ pinned: true })} onPin={() => undefined} />);
    expect(getByText("Unpin")).not.toBeNull();
    cleanup();
  });

  test("archived state flips the Archive label", () => {
    const { getByText, rerender } = render(<Card card={noteCard()} onArchive={() => undefined} />);
    expect(getByText("Archive")).not.toBeNull();
    rerender(<Card card={noteCard({ archived: true })} onArchive={() => undefined} />);
    expect(getByText("Unarchive")).not.toBeNull();
    cleanup();
  });
});
