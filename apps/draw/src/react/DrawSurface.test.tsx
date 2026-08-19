/**
 * DOM interaction tests for {@link DrawSurface} (Sol-guided Priority 2).
 *
 * These tests exercise the real React component under a happy-dom window: the
 * pointer capture contract, the draft preview path, the exact `addStroke`
 * payload emitted through `onChange`, and the readOnly / interactive mode
 * split (pointer handlers only when interactive, computed viewBox only when
 * readOnly). The globals are installed exactly like apps/browser's
 * executor.test.ts, which is the proven happy-dom pattern on this fleet.
 */
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { installTestDom, restoreTestDom } from "./test-dom.js";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { DrawSurface } from "./DrawSurface.js";
import { addElement, addStroke, createScene } from "../model/scene.js";

beforeAll(() => {
  installTestDom();
});

afterAll(() => {
  restoreTestDom();
});

describe("DrawSurface pointer interaction", () => {
  test("pointerDown -> pointerMove -> pointerUp emits addStroke output with exact color and strokeWidth", () => {
    const onChange = mock<(scene: ReturnType<typeof createScene>) => void>();
    const { container } = render(
      <DrawSurface onChange={onChange} color="#ff0000" strokeWidth={5} />,
    );
    const svg = container.querySelector("svg")!;

    fireEvent.pointerDown(svg, { clientX: 10, clientY: 20, pointerId: 1 });
    fireEvent.pointerMove(svg, { clientX: 30, clientY: 40, pointerId: 1 });
    fireEvent.pointerUp(svg, { pointerId: 1 });

    expect(onChange).toHaveBeenCalledTimes(1);
    const scene = onChange.mock.calls[0]![0];
    expect(scene.elements).toHaveLength(1);
    const el = scene.elements[0]!;
    expect(el.type).toBe("freedraw");
    expect(el.x).toBe(10); // absolute points are rebased onto the element origin
    expect(el.y).toBe(20);
    expect(el.strokeColor).toBe("#ff0000");
    expect(el.strokeWidth).toBe(5);
    expect(el.points).toEqual([
      [0, 0],
      [20, 20],
    ]);
    cleanup();
  });

  test("a single-point click must not call onChange", () => {
    const onChange = mock<() => void>();
    const { container } = render(<DrawSurface onChange={onChange} />);
    const svg = container.querySelector("svg")!;

    fireEvent.pointerDown(svg, { clientX: 5, clientY: 5, pointerId: 1 });
    fireEvent.pointerUp(svg, { pointerId: 1 });

    expect(onChange).not.toHaveBeenCalled();
    cleanup();
  });

  test("pointerLeave finishes the stroke exactly like pointerUp", () => {
    const onChange = mock<(scene: ReturnType<typeof createScene>) => void>();
    const { container } = render(<DrawSurface onChange={onChange} />);
    const svg = container.querySelector("svg")!;

    fireEvent.pointerDown(svg, { clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(svg, { clientX: 8, clientY: 9, pointerId: 1 });
    fireEvent.pointerLeave(svg, { pointerId: 1 });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]![0].elements[0]!.points).toEqual([
      [0, 0],
      [8, 9],
    ]);
    cleanup();
  });

  test("move before down does not create a stroke", () => {
    const onChange = mock<() => void>();
    const { container } = render(<DrawSurface onChange={onChange} />);
    const svg = container.querySelector("svg")!;

    fireEvent.pointerMove(svg, { clientX: 3, clientY: 4, pointerId: 1 });
    fireEvent.pointerUp(svg, { pointerId: 1 });

    expect(onChange).not.toHaveBeenCalled();
    cleanup();
  });

  test("draft preview path is rendered while drawing", () => {
    const onChange = mock<() => void>();
    const { container } = render(<DrawSurface onChange={onChange} />);
    const svg = container.querySelector("svg")!;

    fireEvent.pointerDown(svg, { clientX: 1, clientY: 2, pointerId: 1 });
    // One point only: no draft path yet (needs two points).
    expect(svg.querySelectorAll("path")).toHaveLength(0);

    fireEvent.pointerMove(svg, { clientX: 11, clientY: 12, pointerId: 1 });
    const draft = svg.querySelector("path");
    expect(draft).not.toBeNull();
    expect(draft!.getAttribute("d")).toBe("M 1 2 L 11 12");
    expect(draft!.getAttribute("stroke")).toBe("currentColor");

    fireEvent.pointerUp(svg, { pointerId: 1 });
    expect(svg.querySelectorAll("path")).toHaveLength(0); // draft cleared
    cleanup();
  });
});

describe("DrawSurface mode contract", () => {
  test("readOnly includes a computed viewBox and omits pointer handlers", () => {
    const scene = addStroke(createScene(), [
      [10, 10],
      [30, 50],
    ]);
    const { container } = render(<DrawSurface scene={scene} readOnly />);
    const svg = container.querySelector("svg")!;

    // Padding 8 around bounds {x:10, y:10, w:20, h:40}.
    expect(svg.getAttribute("viewBox")).toBe("2 2 36 56");
    expect(svg.getAttribute("data-readonly")).toBe("true");
    expect(svg.getAttribute("onpointerdown")).toBeNull();
    expect(svg.getAttribute("onpointerup")).toBeNull();
    // The rendered stroke is a static element, not a draft.
    const path = svg.querySelector("path")!;
    expect(path.getAttribute("d")).toBe("M 10 10 L 30 50");
    cleanup();
  });

  test("interactive mode omits the viewBox", () => {
    const onChange = mock<() => void>();
    const { container } = render(<DrawSurface onChange={onChange} />);
    const svg = container.querySelector("svg")!;

    expect(svg.getAttribute("viewBox")).toBeNull();
    expect(svg.getAttribute("data-readonly")).toBeNull();
    cleanup();
  });

  test("no onChange with readOnly=false is still non-interactive", () => {
    const { container } = render(<DrawSurface />);
    const svg = container.querySelector("svg")!;

    expect(svg.getAttribute("onpointerdown")).toBeNull();
    expect(svg.getAttribute("onpointermove")).toBeNull();
    expect(svg.getAttribute("onpointerup")).toBeNull();
    expect(svg.getAttribute("onpointerleave")).toBeNull();
    cleanup();
  });
});

describe("DrawSurface element rendering", () => {
  test("renders every element kind with exact fill, stroke, width, and opacity fraction", () => {
    let scene = createScene();
    scene = addStroke(scene, [
      [0, 0],
      [5, 5],
    ], { strokeColor: "#123456", strokeWidth: 4, opacity: 50 });
    scene = addElement(scene, {
      type: "rectangle",
      x: 10,
      y: 10,
      width: 20,
      height: 10,
      backgroundColor: "#abcdef",
      strokeColor: "#000000",
      opacity: 100,
    });
    scene = addElement(scene, { type: "ellipse", x: 0, y: 0, width: 10, height: 6 });
    scene = addElement(scene, { type: "diamond", x: 0, y: 0, width: 10, height: 10 });
    scene = addElement(scene, {
      type: "text",
      x: 4,
      y: 6,
      width: 0,
      height: 0,
      text: "hi",
      fontSize: 20,
    });

    const { container } = render(<DrawSurface scene={scene} readOnly />);

    const path = container.querySelector("path")!;
    expect(path.getAttribute("d")).toBe("M 0 0 L 5 5");
    expect(path.getAttribute("fill")).toBe("none");
    expect(path.getAttribute("stroke")).toBe("#123456");
    expect(path.getAttribute("stroke-width")).toBe("4");
    expect(path.getAttribute("stroke-linecap")).toBe("round");
    expect(path.getAttribute("stroke-linejoin")).toBe("round");
    expect(path.getAttribute("opacity")).toBe("0.5"); // stored 50 -> fraction

    const rect = container.querySelector("rect")!;
    expect(rect.getAttribute("x")).toBe("10");
    expect(rect.getAttribute("y")).toBe("10");
    expect(rect.getAttribute("width")).toBe("20");
    expect(rect.getAttribute("height")).toBe("10");
    expect(rect.getAttribute("fill")).toBe("#abcdef");
    expect(rect.getAttribute("stroke")).toBe("#000000");
    expect(rect.getAttribute("opacity")).toBe("1"); // stored 100 -> 1

    const ellipse = container.querySelector("ellipse")!;
    expect(ellipse.getAttribute("cx")).toBe("5");
    expect(ellipse.getAttribute("cy")).toBe("3");
    expect(ellipse.getAttribute("rx")).toBe("5");
    expect(ellipse.getAttribute("ry")).toBe("3");

    const polygon = container.querySelector("polygon")!;
    expect(polygon.getAttribute("points")).toBe("5,0 10,5 5,10 0,5");

    const text = container.querySelector("text")!;
    expect(text.getAttribute("x")).toBe("4");
    expect(text.getAttribute("y")).toBe("26"); // baseline shifted by fontSize
    expect(text.getAttribute("font-size")).toBe("20");
    expect(text.getAttribute("fill")).toBe("currentColor");
    expect(text.textContent).toBe("hi");
    cleanup();
  });

  test("a stroke with opacity 1 renders at 0.01 opacity (regression guard)", () => {
    const scene = addStroke(createScene(), [[0, 0], [1, 1]], { opacity: 1 });
    const { container } = render(<DrawSurface scene={scene} readOnly />);
    const path = container.querySelector("path")!;
    expect(path.getAttribute("opacity")).toBe("0.01");
    cleanup();
  });
});
