/**
 * Test DOM environment for draw's React component tests.
 *
 * Three happy-dom / react-dom incompatibilities are neutralized here, and all
 * three are LOAD-ORDER sensitive — this module must be imported before any
 * react-dom import (the test files order their imports accordingly):
 *
 * 1. `isInputEventSupported` is computed ONCE at react-dom module evaluation.
 *    Without a `document` at that moment the flag is false and React takes its
 *    IE8 `attachEvent` polyfill path, which never fires — text-input onChange
 *    becomes dead in every test. A document is installed at module scope, so
 *    the probe runs against a real window.
 * 2. happy-dom's `document` has no `oninput` member, so even with a document
 *    the probe falls to `typeof div.oninput === "function"` and fails. Pinning
 *    `document.oninput = null` makes `"oninput" in document` true and selects
 *    the modern input-event path.
 * 3. happy-dom exposes `value` as a PROTOTYPE accessor, so React's input value
 *    tracker (`trackValueOnNode`) finds no OWN property descriptor and installs
 *    a getter-only trap; React never observes edits. Every input/textarea
 *    created after install gets an own, configurable `value` accessor backed by
 *    a per-node symbol — the jsdom shape React's tracker expects.
 *
 * Test files run in a shared process (bun test), so teardown must never set
 * the globals back to undefined while sibling files still need them:
 * `restoreTestDom` simply installs a FRESH window for the next file.
 */
import { Window } from "happy-dom";

const VALUE_KEY = Symbol("draw-test-value");

const originalGlobals = new Map<PropertyKey, unknown>();
let captured = false;

function setGlobal(key: PropertyKey, value: unknown): void {
  if (!captured) originalGlobals.set(key, (globalThis as Record<PropertyKey, unknown>)[key]);
  (globalThis as Record<PropertyKey, unknown>)[key] = value;
}

/** Install a jsdom-like own `value` accessor on an input/textarea node. */
function patchValueDescriptor(el: { tagName: string }): void {
  if (el.tagName !== "INPUT" && el.tagName !== "TEXTAREA") return;
  const node = el as { [VALUE_KEY]?: string };
  Object.defineProperty(node, "value", {
    configurable: true,
    enumerable: false,
    get(this: { [VALUE_KEY]?: string }) {
      return this[VALUE_KEY] ?? "";
    },
    set(this: { [VALUE_KEY]?: string }, v: unknown) {
      this[VALUE_KEY] = String(v);
    },
  });
}

/**
 * Install (or re-install) the window globals and environment patches. Safe to
 * call repeatedly: each call installs a fresh window for the next test file.
 */
export function installTestDom(): void {
  const windowRef = new Window();

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
  setGlobal("SVGElement", windowRef.SVGElement);
  setGlobal("Element", windowRef.Element);
  setGlobal("Node", windowRef.Node);
  setGlobal("getComputedStyle", windowRef.getComputedStyle.bind(windowRef));

  // React's feature probe: `"oninput" in document` must be true so the modern
  // input-event path (not the IE8 polyfill) is selected for text inputs.
  (windowRef.document as unknown as Record<string, unknown>).oninput = null;

  const doc = windowRef.document;
  const origCreate = doc.createElement.bind(doc);
  doc.createElement = (tag: string, options?: ElementCreationOptions) => {
    const el = origCreate(tag, options);
    patchValueDescriptor(el);
    return el;
  };
  const origCreateNS = doc.createElementNS.bind(doc);
  doc.createElementNS = (ns: string, tag: string) => {
    const el = origCreateNS(ns, tag);
    patchValueDescriptor(el);
    return el;
  };

  captured = true;
}

/**
 * Per-file teardown. In a shared-process run the globals must stay installed
 * for sibling files, so this installs a fresh window instead of restoring the
 * original (empty) environment. The originals are only consulted on the first
 * install, before any react-dom code has run.
 */
export function restoreTestDom(): void {
  installTestDom();
}

// Install at MODULE SCOPE: react-dom's `isInputEventSupported` probe runs at
// its own module evaluation, so a document must already exist. Test files
// import this module before any react-dom import.
installTestDom();
