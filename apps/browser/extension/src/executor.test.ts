import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Window } from "happy-dom";
import { executeDomJob } from "./executor";

let windowRef: Window;
const originalGlobals = new Map<PropertyKey, unknown>();

function setGlobal(key: PropertyKey, value: unknown): void {
  if (!originalGlobals.has(key)) originalGlobals.set(key, (globalThis as Record<PropertyKey, unknown>)[key]);
  (globalThis as Record<PropertyKey, unknown>)[key] = value;
}

beforeEach(() => {
  windowRef = new Window();
  setGlobal("window", windowRef);
  setGlobal("document", windowRef.document);
  setGlobal("location", windowRef.location);
  setGlobal("Event", windowRef.Event);
  setGlobal("InputEvent", windowRef.InputEvent);
  setGlobal("MouseEvent", windowRef.MouseEvent);
  setGlobal("PointerEvent", windowRef.PointerEvent ?? windowRef.MouseEvent);
  setGlobal("KeyboardEvent", windowRef.KeyboardEvent);
  setGlobal("HTMLElement", windowRef.HTMLElement);
  setGlobal("HTMLInputElement", windowRef.HTMLInputElement);
  setGlobal("HTMLTextAreaElement", windowRef.HTMLTextAreaElement);
  setGlobal("HTMLSelectElement", windowRef.HTMLSelectElement);
  setGlobal("getComputedStyle", windowRef.getComputedStyle.bind(windowRef));
});

afterEach(() => {
  for (const [key, value] of originalGlobals) {
    (globalThis as Record<PropertyKey, unknown>)[key] = value;
  }
  originalGlobals.clear();
  windowRef.close();
});

describe("extension DOM executor", () => {
  it("clicks the selected node", async () => {
    document.body.innerHTML = `<button id="run">Run</button>`;
    let clicks = 0;
    document.querySelector("#run")?.addEventListener("click", () => clicks++);

    await executeDomJob({
      id: "click-1",
      type: "click",
      payload: { selector: "#run" },
    });

    expect(clicks).toBe(1);
  });

  it("fills inputs and fires input/change events", async () => {
    document.body.innerHTML = `<input id="name" />`;
    const input = document.querySelector("#name") as HTMLInputElement;
    const events: string[] = [];
    input.addEventListener("input", () => events.push("input"));
    input.addEventListener("change", () => events.push("change"));

    await executeDomJob({
      id: "fill-1",
      type: "fill",
      payload: { selector: "#name", value: "Ada" },
    });

    expect(input.value).toBe("Ada");
    expect(events).toEqual(["input", "change"]);
  });

  it("types text and can clear first", async () => {
    document.body.innerHTML = `<input id="q" value="old" />`;
    const input = document.querySelector("#q") as HTMLInputElement;

    await executeDomJob({
      id: "type-1",
      type: "type",
      payload: { selector: "#q", text: "new", clear: true },
    });

    expect(input.value).toBe("new");
  });

  it("extracts text, html, links, and page snapshot", async () => {
    windowRef.happyDOM.setURL("https://example.test/root");
    document.head.innerHTML = `<title>Fixture</title><meta name="description" content="Demo" />`;
    document.body.innerHTML = `
      <main><h1>Hello</h1><a href="/next">Next</a></main>
      <form></form>
      <img src="/x.png" />
    `;

    expect(await executeDomJob({ id: "text", type: "extract", payload: { format: "text", selector: "main" } })).toContain("Hello");
    expect(await executeDomJob({ id: "html", type: "extract", payload: { format: "html", selector: "main" } })).toContain("<h1>Hello</h1>");
    expect(await executeDomJob({ id: "links", type: "extract", payload: { format: "links" } })).toEqual(["https://example.test/next"]);
    expect(await executeDomJob({ id: "snapshot", type: "extract", payload: { format: "snapshot" } })).toMatchObject({
      url: "https://example.test/root",
      title: "Fixture",
      meta_description: "Demo",
      links_count: 1,
      images_count: 1,
      forms_count: 1,
    });
  });
});
