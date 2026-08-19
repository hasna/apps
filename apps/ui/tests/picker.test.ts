// Variant-picker behavior under a real DOM.
//
// DOM-dependency choice (recorded per the Sol advisory): happy-dom 20.10.2,
// the same version apps/browser already pins in this monorepo — the smallest
// maintained DOM implementation the repo already uses. No jsdom, no browser
// automation, no network. The picker module runs its boot() against a fresh
// happy-dom Window per test; globals are restored afterwards.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

const originalGlobals = new Map<PropertyKey, unknown>();

function setGlobal(key: PropertyKey, value: unknown): void {
  if (!originalGlobals.has(key)) originalGlobals.set(key, (globalThis as Record<PropertyKey, unknown>)[key]);
  (globalThis as Record<PropertyKey, unknown>)[key] = value;
}

let windowRef: Window;

/** Standard demo markup: one group, three options, options 2 and 3 hidden. */
const THREE_OPTIONS = `
  <div data-uidotsh-pick="Hero style">
    <div data-uidotsh-option="Minimal"><main>one</main></div>
    <div data-uidotsh-option="Editorial" hidden><main>two</main></div>
    <div data-uidotsh-option="Bold" hidden><main>three</main></div>
  </div>
`;

async function setupDom(markup: string): Promise<void> {
  windowRef = new Window();
  windowRef.document.body.innerHTML = markup;
  setGlobal("window", windowRef);
  setGlobal("document", windowRef.document);
  setGlobal("customElements", windowRef.customElements);
  setGlobal("MutationObserver", windowRef.MutationObserver);
  setGlobal("requestAnimationFrame", windowRef.requestAnimationFrame.bind(windowRef));
  setGlobal("cancelAnimationFrame", windowRef.cancelAnimationFrame.bind(windowRef));
  setGlobal("Event", windowRef.Event);
  setGlobal("CustomEvent", windowRef.CustomEvent);
  setGlobal("KeyboardEvent", windowRef.KeyboardEvent);
  setGlobal("MouseEvent", windowRef.MouseEvent);
  setGlobal("PointerEvent", windowRef.PointerEvent ?? windowRef.MouseEvent);
  setGlobal("HTMLElement", windowRef.HTMLElement);
  setGlobal("HTMLSelectElement", windowRef.HTMLSelectElement);
  setGlobal("HTMLOptionElement", windowRef.HTMLOptionElement);
  setGlobal("HTMLInputElement", windowRef.HTMLInputElement);
  setGlobal("HTMLButtonElement", windowRef.HTMLButtonElement);
  setGlobal("Element", windowRef.Element);
  setGlobal("Node", windowRef.Node);
  setGlobal("DocumentFragment", windowRef.DocumentFragment);
  setGlobal("ShadowRoot", windowRef.ShadowRoot);
  setGlobal("getComputedStyle", windowRef.getComputedStyle.bind(windowRef));
  setGlobal("location", windowRef.location);

  if (windowRef.document.readyState === "loading") {
    windowRef.document.addEventListener("DOMContentLoaded", () => {}, { once: true });
    windowRef.document.dispatchEvent(new windowRef.Event("DOMContentLoaded"));
  }
  // Import fresh so boot() runs against THIS window's globals.
  await import(`../src/picker.ts?test=${Math.random()}`);
}

beforeEach(() => {
  originalGlobals.clear();
});

afterEach(() => {
  for (const [key, value] of originalGlobals) {
    if (value === undefined) delete (globalThis as Record<PropertyKey, unknown>)[key];
    else (globalThis as Record<PropertyKey, unknown>)[key] = value;
  }
  originalGlobals.clear();
  windowRef?.close();
});

function pickerElement(): HTMLElement | null {
  return windowRef.document.body.querySelector("uidotsh-picker");
}

function selectBox(): HTMLSelectElement | null {
  return pickerElement()?.shadowRoot?.querySelector("[data-select]") ?? null;
}

function positionText(): string {
  return pickerElement()?.shadowRoot?.querySelector("[data-position]")?.textContent ?? "";
}

function visibleOptions(): string[] {
  const wrapper = windowRef.document.querySelector("[data-uidotsh-pick]");
  const visible: string[] = [];
  for (const el of Array.from(wrapper?.querySelectorAll("[data-uidotsh-option]") ?? [])) {
    if (!(el as HTMLElement).hidden) visible.push(el.getAttribute("data-uidotsh-option") ?? "");
  }
  return visible;
}

function keyOn(target: Element | Document, key: string): void {
  target.dispatchEvent(new windowRef.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
}

describe("variant picker", () => {
  test("selects only direct-child group options and fills label fallbacks", async () => {
    await setupDom(`
      <div data-uidotsh-pick="Hero style">
        <div data-uidotsh-option="Minimal"><main>one</main></div>
        <div data-uidotsh-option="Editorial" hidden><main>two</main></div>
        <div data-uidotsh-option hidden><main>three</main></div>
        <div data-uidotsh-pick="Nested group">
          <div data-uidotsh-option="Nested" hidden><main>nested</main></div>
        </div>
      </div>
    `);
    const select = selectBox();
    expect(select).not.toBeNull();
    const labels = Array.from(select!.options).map((o) => o.textContent);
    // Direct children only: the nested group's option is not selectable here.
    expect(labels).toEqual(["Minimal", "Editorial", "Option 3"]);
  });

  test("falls back to generic labels for group and option", async () => {
    await setupDom(`
      <div data-uidotsh-pick>
        <div data-uidotsh-option="Alpha"><main>a</main></div>
        <div data-uidotsh-option hidden><main>b</main></div>
      </div>
    `);
    const position = positionText();
    expect(position).toBe("1/2");
    const select = selectBox();
    expect(Array.from(select!.options).map((o) => o.textContent)).toEqual(["Alpha", "Option 2"]);
  });

  test("enforces exactly-one-visible and reports changed versus unchanged selection", async () => {
    await setupDom(THREE_OPTIONS);
    expect(visibleOptions()).toEqual(["Minimal"]);
    expect(positionText()).toBe("1/3");

    const select = selectBox()!;
    select.selectedIndex = 1;
    select.dispatchEvent(new windowRef.Event("change", { bubbles: true }));
    expect(visibleOptions()).toEqual(["Editorial"]);
    expect(positionText()).toBe("2/3");

    // Selecting the already-visible option leaves the state unchanged.
    const before = visibleOptions().join(",");
    select.selectedIndex = 1;
    select.dispatchEvent(new windowRef.Event("change", { bubbles: true }));
    expect(visibleOptions().join(",")).toBe(before);
  });

  test("clamps a fully-hidden group to the first visible position", async () => {
    await setupDom(`
      <div data-uidotsh-pick="Hero style">
        <div data-uidotsh-option="Minimal" hidden><main>one</main></div>
        <div data-uidotsh-option="Editorial" hidden><main>two</main></div>
      </div>
    `);
    // All options hidden at boot: visibleIndex clamps to 0 and one option is
    // forced visible.
    expect(positionText()).toBe("1/2");
    expect(visibleOptions()).toEqual(["Minimal"]);
  });

  test("arrow keys wrap around at both ends", async () => {
    await setupDom(THREE_OPTIONS);
    expect(positionText()).toBe("1/3");

    // Jump to the last option, then wrap forward to the first.
    const select = selectBox()!;
    select.selectedIndex = 2;
    select.dispatchEvent(new windowRef.Event("change", { bubbles: true }));
    expect(positionText()).toBe("3/3");

    keyOn(windowRef.document.body, "ArrowRight");
    expect(positionText()).toBe("1/3");
    expect(visibleOptions()).toEqual(["Minimal"]);

    keyOn(windowRef.document.body, "ArrowLeft");
    expect(positionText()).toBe("3/3");
    expect(visibleOptions()).toEqual(["Bold"]);
  });

  test("ignores keys typed inside a form field", async () => {
    await setupDom(`
      ${THREE_OPTIONS}
      <input id="field" />
    `);
    const field = windowRef.document.getElementById("field") as HTMLInputElement;
    field.focus();
    keyOn(field, "ArrowRight");
    expect(positionText()).toBe("1/3");
    expect(visibleOptions()).toEqual(["Minimal"]);
  });

  test("boot is idempotent", async () => {
    await setupDom(THREE_OPTIONS);
    expect(pickerElement()).not.toBeNull();

    // A second module instance runs its top-level boot() again against the
    // same window; the __uidotshPickerLoaded guard must short-circuit it.
    await import(`../src/picker.ts?test=${Math.random()}`);
    expect(pickerElement()).not.toBeNull();
    // Exactly one picker element remains; the original selection is intact.
    expect(windowRef.document.body.querySelectorAll("uidotsh-picker")).toHaveLength(1);
    expect(positionText()).toBe("1/3");
  });

  // Measured on happy-dom 20.10.2: a childList REMOVAL record is sometimes
  // dropped when it follows an earlier delivered mutation on the same window
  // (~1 in 8), while a removal delivered as the first mutation is reliable
  // (10/10). The two resync arms therefore run on separate windows.
  test("MutationObserver resyncs when options are added", async () => {
    await setupDom(THREE_OPTIONS);
    const wrapper = windowRef.document.querySelector("[data-uidotsh-pick]")!;
    expect(Array.from(selectBox()!.options)).toHaveLength(3);

    const extra = windowRef.document.createElement("div");
    extra.setAttribute("data-uidotsh-option", "Fourth");
    extra.setAttribute("hidden", "");
    extra.innerHTML = "<main>four</main>";
    wrapper.append(extra);
    for (let i = 0; i < 100 && Array.from(selectBox()!.options).length !== 4; i++) {
      await new Promise((r) => setTimeout(r, 10));
      await windowRef.happyDOM.waitUntilComplete();
    }

    expect(Array.from(selectBox()!.options).map((o) => o.textContent)).toEqual([
      "Minimal",
      "Editorial",
      "Bold",
      "Fourth",
    ]);
  });

  test("MutationObserver removes the picker when the group disappears", async () => {
    await setupDom(THREE_OPTIONS);
    expect(pickerElement()).not.toBeNull();

    windowRef.document.querySelector("[data-uidotsh-pick]")!.remove();
    // The observer callback schedules the re-sync through requestAnimationFrame;
    // happy-dom delivers the mutation on its own task queue, so poll with real
    // time plus virtual-time flushes, bounded by a hard deadline.
    for (let i = 0; i < 100 && pickerElement() !== null; i++) {
      await new Promise((r) => setTimeout(r, 10));
      await windowRef.happyDOM.waitUntilComplete();
    }
    expect(pickerElement()).toBeNull();
  });
});
