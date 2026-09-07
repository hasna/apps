import { afterEach, expect, it } from "bun:test";
import { createTestRenderer, type TestRendererSetup } from "@opentui/core/testing";
import { InputRenderable } from "@opentui/core";
import { createEmailsKeymap } from "./keymap-input.js";

let setup: TestRendererSetup | undefined;
afterEach(() => { setup?.renderer.destroy(); setup = undefined; });

it("ignores unnamed terminal keys without resolver errors and still handles Escape and Ctrl+C", async () => {
  setup = await createTestRenderer({ width: 80, height: 20, kittyKeyboard: true });
  const keymap = createEmailsKeymap(setup.renderer);
  const errors: unknown[] = [];
  const actions: string[] = [];
  const events: string[] = [];
  keymap.on("error", (error) => errors.push(error));
  setup.renderer.keyInput.on("keypress", (event) => events.push(event.name));
  keymap.registerLayer({ id: "input-regression", bindings: [
    { key: "escape", cmd: () => { actions.push("escape"); } },
    { key: "ctrl+c", cmd: () => { actions.push("interrupt"); } },
  ] });
  setup.mockInput.pressKey("\x1b[999~");
  setup.mockInput.pressKey("\x1b[0;1u");
  setup.mockInput.pressKey("\u00a0");
  await setup.flush();
  expect(events.filter((name) => !name.trim()).length).toBeGreaterThanOrEqual(2);
  expect(actions).toEqual([]);
  expect(errors).toEqual([]);
  setup.mockInput.pressEscape();
  setup.mockInput.pressCtrlC();
  await setup.flush();
  expect(actions).toEqual(["escape", "interrupt"]);
  expect(errors).toEqual([]);
});

it("keeps whitespace and ordinary text available to the focused input", async () => {
  setup = await createTestRenderer({ width: 80, height: 20 });
  const keymap = createEmailsKeymap(setup.renderer);
  const errors: unknown[] = [];
  keymap.on("error", (error) => errors.push(error));
  keymap.registerLayer({ id: "text-regression", bindings: [{ key: "escape", cmd: () => {} }] });
  const input = new InputRenderable(setup.renderer, { id: "text", width: 40 });
  setup.renderer.root.add(input);
  input.focus();
  await setup.mockInput.typeText("review\u00a0@example.com");
  await setup.flush();
  expect(input.value).toBe("review\u00a0@example.com");
  expect(errors).toEqual([]);
});
