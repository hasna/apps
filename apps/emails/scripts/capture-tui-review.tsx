/** @jsxImportSource @opentui/solid */
// Synthetic mail only. The subprocess stub owns every API read and write.
import { testRender, useRenderer } from "@opentui/solid";
import { KeymapProvider } from "@opentui/keymap/solid";
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui";
import { onCleanup } from "solid-js";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { App } from "../src/cli/tui-solid/App.js";
import { startV1Stub } from "../src/test-support/v1-stub.js";
import { createProvider } from "../src/db/providers.js";
import { createAddress, markVerified } from "../src/db/addresses.js";
import { storeInboundEmail } from "../src/db/inbound.js";

const output = resolve(process.argv[2] ?? "/tmp/emails-tui-review");
mkdirSync(output, { recursive: true });
process.env.EMAILS_TUI_DISABLE_THEME_PROBE = "1";
process.env.EMAILS_TUI_CLIPBOARD_DRY_RUN = "1";
const stub = await startV1Stub();
stub.applyEnv();
function Harness() {
  const keymap = createDefaultOpenTuiKeymap(useRenderer());
  onCleanup(() => keymap.clearPendingSequence());
  return <KeymapProvider keymap={keymap}><App /></KeymapProvider>;
}
const provider = createProvider({ name: "Review sandbox", type: "sandbox", active: true });
const address = createAddress({ provider_id: provider.id, email: "hello@example.com" });
markVerified(address.id);
const setup = await testRender(() => <Harness />, { width: 120, height: 36, useMouse: true, kittyKeyboard: true, consoleMode: "disabled", openConsoleOnError: false });
const flush = async () => { await setup.flush(); await Bun.sleep(30); await setup.flush(); };
const click = async (label: string) => {
  const lines = setup.captureCharFrame().split("\n");
  const y = lines.findIndex((line) => line.includes(label));
  if (y < 0) throw new Error(`Missing control: ${label}`);
  await setup.mockMouse.click(lines[y]!.indexOf(label), y);
  await flush();
};
const capture = async (name: string) => {
  await flush();
  await Bun.write(`${output}/${name}.json`, JSON.stringify(setup.captureSpans()));
  await Bun.write(`${output}/${name}.txt`, setup.captureCharFrame());
};
const escape = async () => { setup.mockInput.pressEscape(); await flush(); };
try {
  await flush();
  await setup.waitForFrame((frame) => frame.includes("Your inbox is clear"));
  await capture("empty-inbox");
  await click("Settings");
  await capture("settings-general");
  await click("Appearance");
  await capture("settings-appearance");
  await click("Reading");
  await capture("settings-reading");
  setup.resize(80, 24);
  await capture("settings-narrow");
  await click("Shortcuts");
  await capture("shortcuts-narrow");
  setup.resize(120, 36);
  await flush();
  await click("Priority Inbox");
  await capture("settings-priority");
  await click("Appearance");
  await click("Color scheme");
  await capture("dark-settings");
  await escape();
  await capture("dark-empty-inbox");
  await click("Settings");
  await click("Appearance");
  await click("Color scheme");
  await click("Color scheme");
  await escape();
  storeInboundEmail({ provider_id: provider.id, message_id: "<review@example.com>", from_address: "Avery Stone <avery@example.com>", to_addresses: ["hello@example.com"], cc_addresses: [], subject: "Project update", text_body: "Hello", html_body: '<h1>Ready for review</h1><p>The <b>latest update</b> is ready. Read the <a href="https://example.com">release notes</a>.</p><table><tr><th>Service</th><th>Status</th></tr><tr><td>API</td><td>Healthy</td></tr></table><pre><code class="language-sh">cd project\nbun test\n  # full output</code></pre><div class="gmail_quote"><p>The earlier conversation is here.</p></div>', attachments: [], headers: {}, raw_size: 1, received_at: new Date().toISOString() });
  await click("Check for new mail");
  await capture("inbox");
  setup.mockInput.pressEnter();
  await flush();
  await capture("reader-collapsed");
  await click("Code · sh");
  await capture("reader-expanded");
  setup.mockInput.pressKey("r", { ctrl: true });
  await flush();
  await capture("reader-after-refresh");
  await escape();
  setup.mockInput.pressKey("f", { ctrl: true });
  await flush();
  await setup.mockInput.typeText("unmatched search");
  setup.mockInput.pressEnter();
  await flush();
  await capture("empty-search");
  setup.resize(80, 24);
  await capture("empty-search-narrow");
} finally {
  setup.renderer.destroy();
  stub.stop();
  stub.clearEnv();
}
console.log(`Saved native OpenTUI captures to ${output}`);
