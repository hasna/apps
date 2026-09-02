/**
 * Copy this script into a fresh npm consumer of the packed @hasna/docs artifact,
 * then run `node packed-react-smoke.mjs` there. The consumer needs react,
 * react-dom and happy-dom (verification uses 19.2.8 / 19.2.8 / 20.10.2).
 * Do not use a repository lock, dependency overrides, or omitted optional deps.
 */
import assert from "node:assert/strict";
import { Window } from "happy-dom";

const window = new Window({ url: "https://example.com" });
for (const name of ["window", "document", "navigator", "location", "Node", "Element",
  "HTMLElement", "HTMLInputElement", "HTMLTextAreaElement", "Text", "Event", "MouseEvent",
  "KeyboardEvent", "InputEvent", "MutationObserver", "DOMParser", "getComputedStyle",
  "requestAnimationFrame", "cancelAnimationFrame"]) {
  const value = name === "window" ? window : window[name];
  Object.defineProperty(globalThis, name, { configurable: true, writable: true,
    value: typeof value === "function" && /^[a-z]/.test(name) ? value.bind(window) : value });
}
document.oninput = null;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Install the DOM before React's load-time feature probes.
const { act, createElement } = await import("react");
const { createRoot } = await import("react-dom/client");
const { Editor } = await import("@hasna/docs/react");
const { Document } = await import("@hasna/docs");
const { BubbleMenu, FloatingMenu } = await import("@tiptap/react/menus");
assert.equal(typeof BubbleMenu.render, "function");
assert.equal(typeof FloatingMenu.render, "function");

const container = document.createElement("div");
document.body.append(container);
const root = createRoot(container);
let editor;
const updates = [];
const ready = (instance) => { editor = instance; };
const changed = (json) => { updates.push(json); };
const render = (props) => root.render(createElement(Editor, { onReady: ready, onChange: changed, ...props }));
try {
  await act(async () => { render({ markdown: "# Packed editor\n\nHello world." }); });
  assert.ok(editor, "mounted Editor calls onReady");
  assert.equal(editor.getJSON().content[0].type, "heading");
  assert.equal(container.querySelector(".ProseMirror").textContent, "Packed editorHello world.");
  assert.ok(container.querySelectorAll("button").length >= 10, "formatting toolbar is present");

  const toolbar = (title) => {
    const button = [...container.querySelectorAll("button")].find((node) => node.title === title);
    assert.ok(button, `toolbar button ${title} exists`);
    button.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  };
  await act(async () => {
    editor.commands.setContent("<p>Format me</p>");
    // Select the text, not the trailing paragraph StarterKit may append.
    editor.commands.setTextSelection({ from: 1, to: 10 });
    toolbar("Bold");
  });
  assert.equal(editor.isActive("bold"), true);
  assert.ok(editor.getHTML().includes("<strong>Format me</strong>"));
  await act(async () => { toolbar("Italic"); });
  assert.equal(editor.isActive("italic"), true);
  await act(async () => { toolbar("Heading 2"); });
  assert.equal(editor.isActive("heading", { level: 2 }), true,
    JSON.stringify({ html: editor.getHTML(), selection: editor.state.selection.toJSON(), canHeading: editor.can().toggleHeading({ level: 2 }) }));
  await act(async () => { toolbar("Bullet list"); });
  assert.equal(editor.isActive("bulletList"), true);
  assert.ok(updates.length >= 4, "edits emit document JSON");
  const edited = updates.at(-1);
  assert.deepEqual(Document.fromJSON(edited).toJSON(), edited, "editor JSON round-trips through the headless SDK");

  const controlled = Document.fromMarkdown("# Controlled\n\nReplacement content.").toJSON();
  const beforeControlled = updates.length;
  await act(async () => { render({ value: controlled }); });
  assert.deepEqual(JSON.parse(JSON.stringify(editor.getJSON())), controlled,
    "controlled JSON updates the mounted editor (regardless of attribute-object prototypes)");
  assert.equal(updates.length, beforeControlled, "controlled replacement does not emit a spurious edit");
  await act(async () => { render({ value: controlled, editable: false, showToolbar: false }); });
  assert.equal(editor.isEditable, false);
  assert.equal(container.querySelector(".hasna-docs-toolbar"), null);
  await act(async () => { render({ value: controlled, editable: true }); });
  assert.equal(editor.isEditable, true);
  assert.ok(container.querySelector(".hasna-docs-toolbar"));
  console.log("PASS: packed Editor mount, toolbar formatting, emitted/controlled JSON, editable state, and optional menu imports");
} finally {
  await act(async () => { root.unmount(); });
  window.happyDOM.cancelAsync();
  window.close();
}
