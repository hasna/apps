import { afterEach, expect, it } from "bun:test";
import { testRender, type TestRendererSetup } from "@opentui/solid";
import { createSignal } from "solid-js";
import { ThemeProvider } from "../context/theme.js";
import { SelectDialog } from "./select-dialog.js";

let setup: TestRendererSetup | undefined;
afterEach(() => { setup?.renderer.destroy(); setup = undefined; });

it("keeps keyboard selection visible through a long mailbox list and resets it when searching", async () => {
  let picked = "";
  function Harness() {
    const [query, setQuery] = createSignal("");
    return <ThemeProvider mode="dark"><SelectDialog title="Mailboxes" query={query()} onQuery={setQuery}
      onClose={() => {}} onSelect={(item) => { picked = item.id; }}
      items={Array.from({ length: 30 }, (_, i) => ({ id: String(i), title: `mailbox-${String(i).padStart(2, "0")}@example.com` }))} /></ThemeProvider>;
  }
  setup = await testRender(() => <Harness />, { width: 70, height: 25 });
  await setup.flush();
  for (let i = 0; i < 23; i++) { setup.mockInput.pressArrow("down"); await setup.flush(); }
  expect(setup.captureCharFrame()).toContain("mailbox-23@example.com");
  expect(setup.captureCharFrame()).not.toContain("mailbox-00@example.com");
  setup.mockInput.pressEnter();
  await setup.flush();
  expect(picked).toBe("23");
  await setup.mockInput.typeText("mailbox-01");
  await setup.flush();
  expect(setup.captureCharFrame()).toContain("mailbox-01@example.com");
  setup.mockInput.pressEnter();
  await setup.flush();
  expect(picked).toBe("1");
});

it("does not activate a disabled option with the mouse", async () => {
  let picked = false;
  setup = await testRender(() => <ThemeProvider mode="dark"><SelectDialog title="Mailboxes" query="" onQuery={() => {}}
    onClose={() => {}} onSelect={() => { picked = true; }} items={[{ id: "disabled", title: "Unavailable mailbox", disabled: true }]} /></ThemeProvider>, { width: 70, height: 20 });
  await setup.flush();
  const lines = setup.captureCharFrame().split("\n");
  const y = lines.findIndex((line) => line.includes("Unavailable mailbox"));
  await setup.mockMouse.click(lines[y]!.indexOf("Unavailable mailbox"), y);
  await setup.flush();
  expect(picked).toBe(false);
});
