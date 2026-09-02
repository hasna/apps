/**
 * Run from a fresh npm consumer of the packed Sheets artifact with React and
 * ReactDOM18.3.1, react-spreadsheet0.10.1 and test-only happy-dom20.10.2.
 * Keep the consumer free of repository locks, overrides and omitted peers.
 */
import assert from "node:assert/strict";
import { Window } from "happy-dom";

const window = new Window({ url: "https://example.com" });
for (const name of ["window", "document", "navigator", "Node", "Element", "HTMLElement",
  "HTMLInputElement", "Event", "MouseEvent", "KeyboardEvent", "getComputedStyle",
  "requestAnimationFrame", "cancelAnimationFrame"]) {
  const value = name === "window" ? window : window[name];
  Object.defineProperty(globalThis, name, { configurable: true, writable: true,
    value: typeof value === "function" && /^[a-z]/.test(name) ? value.bind(window) : value });
}
document.oninput = null;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { act, createElement } = await import("react");
const { createRoot } = await import("react-dom/client");
const { createWorkbook, setCells, getCellValue, loadWorkbook, serializeWorkbook } = await import("@hasna/sheets");
const { Spreadsheet } = await import("@hasna/sheets/react");
const workbook = createWorkbook();
setCells(workbook, { A1: "2", B1: "=A1*3", A50: "off-window" });
const original = serializeWorkbook(workbook);
const updates = [];
const container = document.createElement("div");
document.body.append(container);
const root = createRoot(container);
const render = (value) => root.render(createElement(Spreadsheet, {
  workbook: value, rows: 2, columns: 2, onWorkbookChange: (updated) => updates.push(updated),
}));

try {
  await act(async () => { render(workbook); });
  assert.equal(container.querySelectorAll("td").length, 4);
  assert.ok(container.textContent.includes("6"), "mounted grid evaluates the formula");
  await act(async () => {
    container.querySelector("td").dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true }));
  });
  await act(async () => {
    container.querySelector(".Spreadsheet__active-cell").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  });
  const input = container.querySelector("input");
  assert.ok(input, "actual grid enters edit mode");
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(input, "7");
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
    input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  assert.ok(updates.length > 0, "real input emits a controlled workbook update");
  const updated = loadWorkbook(serializeWorkbook(updates.at(-1)));
  assert.equal(getCellValue(updated, "A1"), 7);
  assert.equal(getCellValue(updated, "B1"), 21);
  assert.equal(getCellValue(updated, "A50"), "off-window");
  assert.equal(serializeWorkbook(workbook), original, "input workbook is not mutated");
  await act(async () => { render(updated); });
  assert.ok(container.textContent.includes("21"), "controlled update renders recalculated result");

  const replacement = createWorkbook();
  setCells(replacement, { A1: "4", B1: "=A1*3" });
  const beforeReplacement = updates.length;
  await act(async () => { render(replacement); });
  assert.ok(container.textContent.includes("12"), "external controlled replacement reaches the grid");
  assert.equal(updates.length, beforeReplacement, "external replacement is not an edit");
  console.log("PASS: packed Spreadsheet mount, actual edit, formula recalc, controlled JSON and off-window preservation");
} finally {
  await act(async () => { root.unmount(); });
  window.happyDOM.cancelAsync();
  window.close();
}
