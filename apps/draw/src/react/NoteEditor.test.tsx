/**
 * DOM tests for {@link NoteEditor} (Sol-guided Priority 3): null-safe
 * title/text binding, exact CardPatch objects, placeholders, default rows,
 * and className pass-through.
 */
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { installTestDom, restoreTestDom } from "./test-dom.js";
import { cleanup, render } from "@testing-library/react";
import { NoteEditor } from "./NoteEditor.js";

beforeAll(() => {
  installTestDom();
});

afterAll(() => {
  restoreTestDom();
});

describe("NoteEditor", () => {
  test("binds an absent card to empty values (null-safe)", () => {
    const { container } = render(<NoteEditor />);
    const input = container.querySelector(".hasna-draw-note-editor__title")! as HTMLInputElement;
    const textarea = container.querySelector(".hasna-draw-note-editor__text")! as HTMLTextAreaElement;
    expect(input.value).toBe("");
    expect(textarea.value).toBe("");
    cleanup();
  });

  test("binds card title and text into the fields", () => {
    const { container } = render(<NoteEditor card={{ title: "T", text: "body" }} />);
    const input = container.querySelector(".hasna-draw-note-editor__title")! as HTMLInputElement;
    const textarea = container.querySelector(".hasna-draw-note-editor__text")! as HTMLTextAreaElement;
    expect(input.value).toBe("T");
    expect(textarea.value).toBe("body");
    cleanup();
  });

  test("emits exact CardPatch objects on change", () => {
    const onChange = mock<(patch: { title?: string; text?: string }) => void>();
    const { container } = render(<NoteEditor onChange={onChange} />);
    const input = container.querySelector(".hasna-draw-note-editor__title")! as HTMLInputElement;
    const textarea = container.querySelector(".hasna-draw-note-editor__text")! as HTMLTextAreaElement;

    // The component's own onChange wiring is exercised through the props
    // React bound onto the nodes (real handler, real event shape). This is
    // the change-plugin contract; happy-dom + react-dom 19.2's text-input
    // onChange plumbing is broken at the environment level (the module-eval
    // isInputEventSupported probe), so the DOM-level dispatch cannot reach
    // it — the handler wiring below is what the component owns.
    const propsKey = Object.keys(input).find((k) => k.startsWith("__reactProps"))!;
    const props = (input as unknown as Record<string, unknown>)[propsKey] as {
      onChange: (e: { target: { value: string } }) => void;
    };
    props.onChange({ target: { value: "Groceries" } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]![0]).toEqual({ title: "Groceries" });

    const taPropsKey = Object.keys(textarea).find((k) => k.startsWith("__reactProps"))!;
    const taProps = (textarea as unknown as Record<string, unknown>)[taPropsKey] as {
      onChange: (e: { target: { value: string } }) => void;
    };
    taProps.onChange({ target: { value: "milk" } });
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange.mock.calls[1]![0]).toEqual({ text: "milk" });
    cleanup();
  });

  test("uses the provided placeholders and defaults", () => {
    const { container } = render(
      <NoteEditor titlePlaceholder="Name" textPlaceholder="Write..." />,
    );
    const input = container.querySelector(".hasna-draw-note-editor__title")!;
    const textarea = container.querySelector(".hasna-draw-note-editor__text")!;
    expect(input.getAttribute("placeholder")).toBe("Name");
    expect(textarea.getAttribute("placeholder")).toBe("Write...");
    expect(textarea.getAttribute("rows")).toBe("4"); // documented default
    cleanup();
  });

  test("honors an explicit rows value and passes className", () => {
    const { container } = render(<NoteEditor rows={6} className="fancy" />);
    const editor = container.querySelector(".hasna-draw-note-editor")!;
    const textarea = container.querySelector(".hasna-draw-note-editor__text")!;
    expect(editor.className).toBe("hasna-draw-note-editor fancy");
    expect(textarea.getAttribute("rows")).toBe("6");
    cleanup();
  });
});
