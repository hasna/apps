/** @jsxImportSource @opentui/solid */
// Self-hosted-ONLY: the TUI reads/writes the operator `/v1` API (createProvider,
// createAddress, storeInboundEmail, createDomain, and the mail data source all
// route there). These tests drive the REAL App against an out-of-process /v1 stub
// (see src/test-support/v1-stub.ts). The manual "Pull" affordance was LOCAL
// S3→SQLite ingestion and no longer exists in the self-hosted-only client, so the
// former local-Pull tests are gone and the self-hosted case simply asserts Pull is
// absent. Device preferences use dedicated JSON; priority rules remain in the API.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { getDataRoot } from "../../paths.js";
import { createEmailsKeymap } from "../tui-solid/keymap-input.js";
import { KeymapProvider } from "@opentui/keymap/solid";
import { testRender, useRenderer, type TestRendererSetup } from "@opentui/solid";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { onCleanup } from "solid-js";
import { createAddress, markVerified } from "../../db/addresses.js";
import { createDomain } from "../../db/domains.js";
import { storeInboundEmail } from "../../db/inbound.js";
import { createProvider } from "../../db/providers.js";
import * as mailboxData from "./data.js";
import { toggleRead, type TuiMessage } from "./data.js";
import { App } from "../tui-solid/App.js";
import { resolveAddressChoice } from "../tui-solid/context/emails-state.js";
import { sidebarWidth } from "../tui-solid/component/sidebar.js";
import { startV1Stub, type V1Stub } from "../../test-support/v1-stub.js";
import { resolveMailDataSource } from "../../lib/mail-data-source.js";
import { RGBA, ImageRenderable, TextRenderable, TextTableRenderable, type Renderable, type TextChunk } from "@opentui/core";

let INHERITED_PROCESS_ENV: NodeJS.ProcessEnv;
function captureInheritedProcessEnv(): void {
  INHERITED_PROCESS_ENV = { ...process.env };
}
function restoreInheritedProcessEnv(): void {
  for (const key of Object.keys(process.env)) {
    if (!Object.prototype.hasOwnProperty.call(INHERITED_PROCESS_ENV, key)) delete process.env[key];
  }
  Object.assign(process.env, INHERITED_PROCESS_ENV);
}

let stub: V1Stub;
let savedHome: string | undefined;
let tmpHome = "";
let providerId = "";
let setup: TestRendererSetup | null = null;
let keymapErrors: unknown[] = [];

// data.ts caches the full message scan for a short window; direct seeding does not
// invalidate it, so bust it between tests (a data.ts mutation nulls the cache; the
// 404 PATCH on the empty store is expected).
function bustScanCache(): void {
  try {
    toggleRead({ kind: "inbound", id: "__cache_bust__", is_read: false } as TuiMessage);
  } catch {
    // Expected 404 — the cache was already nulled as a side effect.
  }
}

function Harness(props: { initialMailbox?: "inbox" | "unread" | "starred" | "sent" | "archived" | "spam" | "trash" }) {
  const renderer = useRenderer();
  const keymap = createEmailsKeymap(renderer);
  keymap.on("error", (error) => keymapErrors.push(error));
  onCleanup(() => keymap.clearPendingSequence());
  return (
    <KeymapProvider keymap={keymap}>
      <App initialMailbox={props.initialMailbox} />
    </KeymapProvider>
  );
}

beforeAll(async () => {
  stub = await startV1Stub();
});
afterAll(() => stub.stop());

beforeEach(async () => {
  keymapErrors = [];
  captureInheritedProcessEnv();
  process.env["EMAILS_TUI_DISABLE_THEME_PROBE"] = "1";
  process.env["EMAILS_TUI_CLIPBOARD_DRY_RUN"] = "1";
  savedHome = process.env["HOME"];
  tmpHome = mkdtempSync(join(tmpdir(), "emails-solid-tui-"));
  process.env["HOME"] = tmpHome;
  await stub.reset();
  stub.applyEnv();
  bustScanCache();
  providerId = createProvider({ name: "sandbox", type: "sandbox", active: true }).id;
  const address = createAddress({ provider_id: providerId, email: "ops@example.com" });
  markVerified(address.id);
});

afterEach(() => {
  setup?.renderer.destroy();
  setup = null;
  stub.clearEnv();
  delete process.env["EMAILS_TUI_DISABLE_THEME_PROBE"];
  delete process.env["EMAILS_TUI_CLIPBOARD_DRY_RUN"];
  if (savedHome === undefined) delete process.env["HOME"];
  else process.env["HOME"] = savedHome;
  rmSync(tmpHome, { recursive: true, force: true });
  restoreInheritedProcessEnv();
});

function seedMessage(
  subject: string,
  received_at = "2026-01-01T10:00:00.000Z",
  to = "ops@example.com",
  labels: string[] = [],
  attachments: Array<{ filename: string; content_type: string; size: number; local_path?: string; s3_url?: string }> = [],
  content?: { text?: string; html?: string },
) {
  return storeInboundEmail({
    provider_id: providerId,
    message_id: `<${subject}@example.com>`,
    from_address: `Sender ${subject} <sender-${subject.replace(/\s+/g, "-")}@example.com>`,
    to_addresses: [to],
    cc_addresses: [],
    subject,
    text_body: content?.text ?? `# ${subject}\n\nbody for ${subject}\n\nhttps://example.com/${encodeURIComponent(subject)}`,
    html_body: content?.html ?? null,
    attachments: attachments.map(({ filename, content_type, size }) => ({ filename, content_type, size })),
    attachment_paths: attachments.flatMap((attachment) => attachment.local_path || attachment.s3_url ? [{
      filename: attachment.filename,
      content_type: attachment.content_type,
      size: attachment.size,
      ...(attachment.local_path ? { local_path: attachment.local_path } : {}),
      ...(attachment.s3_url ? { s3_url: attachment.s3_url } : {}),
    }] : []),
    label_ids: labels,
    headers: {},
    raw_size: 1,
    received_at,
  });
}

async function renderApp(initialMailbox?: "inbox" | "unread" | "starred" | "sent" | "archived" | "spam" | "trash") {
  setup = await testRender(() => <Harness initialMailbox={initialMailbox} />, {
    width: 120,
    height: 33,
    exitOnCtrlC: false,
    consoleMode: "disabled",
    openConsoleOnError: false,
    kittyKeyboard: true,
    useMouse: true,
    enableMouseMovement: true,
  });
  await setup.flush();
  await Bun.sleep(0);
  await setup.flush();
  return setup;
}

function frame(): string {
  return setup?.captureCharFrame() ?? "";
}

async function flush() {
  await setup?.flush();
}

async function click(x: number, y: number) {
  await setup?.mockMouse.click(x, y);
  await flush();
}

async function clickText(text: string, occurrence = 0) {
  const lines = frame().split("\n");
  let seen = 0;
  for (const [y, line] of lines.entries()) {
    const x = line.indexOf(text);
    if (x < 0) continue;
    if (seen++ !== occurrence) continue;
    await click(Math.max(0, x), y);
    return;
  }
  throw new Error(`Text not found: ${text}\n${frame()}`);
}

async function key(name: string, options?: { ctrl?: boolean; shift?: boolean }) {
  if (name === "enter" || name === "return") setup?.mockInput.pressEnter(options);
  else if (name === "escape") setup?.mockInput.pressEscape(options);
  else if (name === "tab") setup?.mockInput.pressTab(options);
  else if (name === "up" || name === "down" || name === "left" || name === "right") setup?.mockInput.pressArrow(name, options);
  else if (name === "pageup") setup?.mockInput.pressKey("\x1B[5~", options);
  else if (name === "pagedown") setup?.mockInput.pressKey("\x1B[6~", options);
  else setup?.mockInput.pressKey(name, options);
  await flush();
}

async function typeText(value: string) {
  await setup?.mockInput.typeText(value);
  await flush();
}

describe("Emails Solid TUI", () => {
  it("keeps comma-grouped folder, category and label counts on one sidebar row", async () => {
    const ds = resolveMailDataSource();
    const counts = spyOn(ds, "mailboxCounts").mockResolvedValue({
      inbox: 132193, unread: 7, priority: 1000, starred: 999, sent: 1234567,
      archived: 0, spam: 12, trash: 5, countsComplete: false,
    });
    const labels = spyOn(ds, "listLabelSummaries").mockResolvedValue([
      { name: "category_promotions", count: 132193 },
      { name: "Ledger operational announcements", count: 1234567890 },
    ]);
    try {
      await renderApp();
      for (const width of [120, 80, 60]) {
        setup?.resize(width, 33);
        await flush();
        const sidebar = frame().split("\n").map((line) => line.slice(0, sidebarWidth(width)));
        for (const [label, count] of [
          ["Inbox", "≥132,193"], ["Unread", "≥7"], ["Priority", "≥1,000"],
          ["Starred", "≥999"], ["Sent", "≥1,234,567"], ["Archived", "≥0"],
          ["Spam", "≥12"], ["Trash", "≥5"], ["Promotions", "132,193"],
          ["Ledger", "1,234,567,890"],
        ]) {
          const row = sidebar.find((line) => line.includes(label!));
          expect(row).toBeDefined();
          expect(row).toContain(count!);
        }
      }
    } finally { counts.mockRestore(); labels.mockRestore(); }
  });

  it("shows a useful empty inbox without message actions or unavailable pagination", async () => {
    await renderApp();
    await setup?.waitForFrame((value) => value.includes("Your inbox is clear"));
    expect(frame()).toContain("Check for new mail");
    expect(frame()).not.toContain("Previous page");
    expect(frame()).not.toContain("Next page");
    expect(frame()).not.toContain("Subject / preview");
    expect(frame()).not.toContain("Newest first");
    expect(frame()).not.toMatch(/\bOpen\b/);
    expect(frame()).not.toMatch(/\bLabel\b/);
    await clickText("Check for new mail");
    expect(frame()).toContain("Your inbox is clear");
    await clickText("Compose");
    expect(frame()).toContain("Markdown enabled");
  });

  it("closes settings with Ctrl+C, then exits when no dialog is open", async () => {
    await renderApp();
    await clickText("Settings");
    await key("c", { ctrl: true });
    expect(setup?.renderer.isDestroyed).toBe(false);
    expect(frame()).not.toContain("Preferences");
    await clickText("Compose");
    await key("c", { ctrl: true });
    expect(frame()).not.toContain("Markdown enabled");
    expect(setup?.renderer.isDestroyed).toBe(false);
    setup?.mockInput.pressKey("c", { ctrl: true });
    await Bun.sleep(0);
    expect(setup?.renderer.isDestroyed).toBe(true);
  });

  it("distinguishes empty searches and clears the filters from the empty state", async () => {
    seedMessage("Find this message");
    await renderApp();
    await key("f", { ctrl: true });
    await typeText("no-matching-message");
    await key("enter");
    expect(frame()).toContain("No matching messages");
    expect(frame()).toContain("Clear filters");
    expect(frame()).not.toMatch(/\bOpen\b/);
    await clickText("Clear filters");
    expect(frame()).toContain("Find this message");
    expect(frame()).toMatch(/\bOpen\b/);
    expect(frame()).not.toContain("Next page");
  });

  it("applies settings with mouse and keyboard, preserves them when reopened, and expands mail on request", async () => {
    seedMessage("Reader preferences", undefined, undefined, [], [], { text: "Hello\n\n```sh\ncd settings-demo\n```\n\n> Previous conversation" });
    await renderApp();
    await clickText("Settings");
    expect(frame()).toContain("General");
    expect(frame()).toContain("Appearance");
    expect(frame()).toContain("Reading");
    expect(frame()).not.toContain("Auto-pull");
    await clickText("Appearance");
    expect(frame()).toContain("Color scheme");
    await clickText("Color scheme");
    expect(frame()).toContain("Dark");
    await clickText("Reading");
    await clickText("Expand code blocks");
    await key("down");
    await key("enter");
    expect(frame()).not.toContain("Off");
    await key("escape");
    await clickText("Settings");
    await clickText("Reading");
    expect(frame()).not.toContain("Off");
    setup?.resize(80, 24);
    await flush();
    expect(frame()).toContain("Expand code blocks");
    expect(frame()).toContain("Close");
    await key("escape");
    setup?.resize(120, 33);
    await flush();
    await key("enter");
    expect(frame()).toContain("cd settings-demo");
    expect(frame()).toContain("Previous conversation");
    expect(frame()).not.toContain("self_hosted API-only mode");
  });

  it("reloads saved appearance and reading preferences in a new App", async () => {
    await renderApp();
    await clickText("Settings");
    await clickText("Appearance");
    await clickText("Color scheme");
    await clickText("Reading");
    await clickText("Expand code blocks");
    setup?.renderer.destroy(); setup = null;
    await renderApp();
    await clickText("Settings");
    await clickText("Appearance");
    expect(frame()).toContain("Dark");
    await clickText("Reading");
    expect(frame()).toContain("On");
    expect(frame()).not.toContain("until you close");
  });

  it("keeps preference actions immediate and shows save failures", async () => {
    const root = getDataRoot();
    mkdirSync(root, { recursive: true, mode: 0o700 });
    writeFileSync(join(root, "config"), "synthetic config obstruction");
    await renderApp();
    await clickText("Settings");
    await clickText("Appearance");
    await clickText("Color scheme");
    expect(frame()).toContain("Dark");
    expect(frame()).toContain("Could not save your preference");
    await clickText("Attachments");
    await clickText("When selecting an attachment");
    expect(frame()).toContain("Copy link");
    expect(frame()).toContain("Could not save your preference");
    expect(readFileSync(join(root, "config"), "utf8")).toBe("synthetic config obstruction");
  });

  it("shows recoverable connection errors instead of an empty mailbox or message actions", async () => {
    const ds = resolveMailDataSource();
    const list = spyOn(ds, "listMailbox").mockRejectedValue(new Error("Connection unavailable"));
    try {
      await renderApp();
      expect(frame()).toContain("Couldn't load your mail");
      expect(frame()).not.toContain("Your inbox is clear");
      expect(frame()).not.toMatch(/\bOpen\b/);
      await key("r", { ctrl: true });
      expect(frame()).toContain("Couldn't refresh");
      list.mockRestore();
      await clickText("Try again");
      expect(frame()).toContain("Your inbox is clear");
    } finally { list.mockRestore(); }
  });

  it("lets the reader retry a failed body load without exposing message actions", async () => {
    seedMessage("Retry reading");
    const body = spyOn(resolveMailDataSource(), "getMessageBody").mockRejectedValue(new Error("Connection unavailable"));
    try {
      await renderApp();
      await key("enter");
      expect(frame()).toContain("Couldn't open this message");
      expect(frame()).toContain("Back to inbox");
      expect(frame()).not.toMatch(/\bReply\b/);
      expect(frame()).not.toMatch(/\bRaw\b/);
      body.mockRestore();
      await clickText("Try again");
      expect(frame()).toContain("body for Retry reading");
      expect(frame()).toContain("Reply");
    } finally { body.mockRestore(); }
  });

  it("shows a message-not-found screen with a working way back", async () => {
    seedMessage("Missing message");
    const body = spyOn(resolveMailDataSource(), "getMessageBody").mockResolvedValue(null);
    try {
      await renderApp();
      await key("enter");
      expect(frame()).toContain("Message not found");
      expect(frame()).not.toMatch(/\bReply\b/);
      await clickText("Back to inbox");
      expect(frame()).toContain("Subject / preview");
    } finally { body.mockRestore(); }
  });

  it("keeps focused priority text readable in the light theme", async () => {
    await renderApp();
    await clickText("Settings");
    await clickText("Appearance");
    for (let attempt = 0; attempt < 3 && !frame().includes("Light ▾"); attempt++) await clickText("Color scheme");
    await clickText("Priority Inbox");
    await typeText("contrast@example.com");
    const span = setup!.captureSpans().lines.flatMap((line) => line.spans).find((span) => span.text.includes("contrast@example.com"));
    expect(span).toBeDefined();
    expect(span!.fg.equals(RGBA.fromHex("#4c4f69"))).toBe(true);
    expect(span!.fg.equals(span!.bg)).toBe(false);
  });

  it("closes light settings with Escape after unnamed terminal events without logging keymap errors", async () => {
    await renderApp();
    await clickText("Settings");
    await clickText("Appearance");
    for (let attempt = 0; attempt < 3 && !frame().includes("Light ▾"); attempt++) await clickText("Color scheme");
    await clickText("Priority Inbox");
    await typeText("review@example.com");
    setup!.mockInput.pressKey("\x1b[999~");
    await flush();
    expect(frame()).toContain("review@example.com");
    await key("escape");
    expect(frame()).not.toContain("Preferences");
    expect(keymapErrors).toEqual([]);
  });

  it("saves the attachment default without a local mail database and restores it in a new app", async () => {
    await renderApp();
    await clickText("Settings");
    await clickText("Attachments");
    expect(frame()).toContain("Download ▾");
    await clickText("When selecting an attachment");
    expect(frame()).toContain("Copy link ▾");
    setup!.renderer.destroy(); setup = null;
    await renderApp();
    await clickText("Settings");
    await clickText("Attachments");
    expect(frame()).toContain("Copy link ▾");
  });

  it("saves and removes priority rules through the settings page", async () => {
    await renderApp();
    await clickText("Settings");
    await clickText("Priority Inbox");
    await typeText("important@example.com");
    await key("enter");
    expect((await stub.list("priority-sender-rules")).map((rule) => rule.value)).toContain("important@example.com");
    await clickText("Remove");
    expect(await stub.list("priority-sender-rules")).toHaveLength(0);
    await key("escape");
    expect(frame()).not.toContain("Preferences");
  });

  it("preserves mailbox choices when opening or searching fails and recovers on retry", async () => {
    await renderApp();
    const list = spyOn(mailboxData, "listInboxAddresses").mockImplementation(() => { throw new Error("Mailbox connection unavailable"); });
    try {
      await clickText("All mailboxes ▾");
      expect(frame()).toContain("Mailbox connection unavailable");
      expect(frame()).toContain("ops@example.com");
      await typeText("ops");
      await Bun.sleep(200); await flush();
      expect(frame()).toContain("Mailbox connection unavailable");
      expect(frame()).toContain("ops@example.com");
    } finally { list.mockRestore(); }
    await typeText("@example.com");
    await Bun.sleep(200); await flush();
    expect(frame()).not.toContain("Mailbox connection unavailable");
    expect(frame()).toContain("ops@example.com");
  });

  it("switches from the mailbox title, scopes messages, and returns from a reader to All mailboxes", async () => {
    const billing = createAddress({ provider_id: providerId, email: "billing@example.com" });
    markVerified(billing.id);
    seedMessage("Operations update", undefined, "ops@example.com");
    seedMessage("Billing update", undefined, "billing@example.com");
    await renderApp();
    await clickText("All mailboxes ▾");
    await typeText("ops@example.com");
    await key("enter");
    await setup?.waitForFrame(value => value.includes("ops@example.com ▾") && value.includes("Operations update") && !value.includes("Billing update"));
    expect(frame()).toContain("ops@example.com ▾");
    expect(frame()).toContain("Operations update");
    expect(frame()).not.toContain("Billing update");
    await clickText("Operations update");
    await key("enter");
    expect(frame()).toContain("From:");
    await clickText("ops@example.com ▾");
    await key("enter");
    expect(frame()).toContain("ops@example.com ▾");
    await clickText("ops@example.com ▾");
    await clickText("All mailboxes", 0);
    await setup?.waitForFrame(value => value.includes("All mailboxes ▾") && value.includes("Billing update"));
    expect(frame()).toContain("All mailboxes ▾");
    expect(frame()).toContain("Billing update");
    expect(frame()).not.toContain("No message selected");
  });

  it("renders rich mail and toggles code and reply history with mouse and keyboard", async () => {
    seedMessage("Rich mail", undefined, undefined, [], [], {
      text: "# Release notes\n\n**Ready** and `inline`\n\n```sh\ncd project\n  bun test\n```\n\n> Earlier message text\n",
    });
    await renderApp();
    await clickText("Rich mail");
    await key("enter");
    expect(frame()).toContain("Release notes");
    expect(frame()).not.toContain("**Ready**");
    expect(frame()).toContain("Ready and inline");
    expect(frame()).toContain("Code · sh");
    expect(frame()).not.toContain("cd project");
    expect(frame()).not.toContain("Earlier message text");
    await clickText("Code · sh");
    expect(frame()).toContain("cd project");
    const codeSpan = setup?.captureSpans().lines.flatMap((line) => line.spans).find((span) => span.text.includes("cd project"));
    expect(codeSpan).toBeDefined();
    expect(codeSpan!.fg.equals(codeSpan!.bg)).toBe(false);
    await key("enter");
    expect(frame()).not.toContain("cd project");
    await key("tab");
    await key("enter");
    expect(frame()).toContain("Earlier message text");
    await clickText("Quoted message");
    expect(frame()).not.toContain("Earlier message text");
  });

  it("expands and collapses embedded image previews with keyboard in the actual App", async () => {
    seedMessage("Image keyboard", undefined, undefined, [], [], {
      html: '<p>Attached chart</p><img alt="Keyboard chart" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAQCAYAAABQrvyxAAADtklEQVR4nBXPIQ7qBgAA0J1kYgKBQCAQiAoEAtEsCEQFolkQFRUIsiAQFQjyU4GoQDQLAlGBID+IigoEWRAVFQgyvWtsD/EO8H759fef//1Gjz4DhowYEzBhyoyQOQsilsSsSEhZs2HLjow9B3KOFJwoOXOh4sqNOzUND568aOl48+GXXyMBevQZMGTEmIAJU2aEzFkQsSRmRULKmg1bdmTsOZBzpOBEyZkLFVdu3KlpePDkRUvHm0/0DfwhQI8+A4aMGBMwYcqMkDkLIpbErEhIWbNhy46MPQdyjhScKDlzoeLKjTs1DQ+evGjpePP54xtIBejRZ8CQEWMCJkyZETJnQcSSmBUJKWs2bNmRsedAzpGCEyVnLlRcuXGnpuHBkxctHW8+6TfwpwA9+gwYMmJMwIQpM0LmLIhYErMiIWXNhi07MvYcyDlScKLkzIWKKzfu1DQ8ePKipePN589vIBOgR58BQ0aMCZgwZUbInAURS2JWJKSs2bBlR8aeAzlHCk6UnLlQceXGnZqGB09etHS8+WTfwA8BevQZMGTEmIAJU2aEzFkQsSRmRULKmg1bdmTsOZBzpOBEyZkLFVdu3KlpePDkRUvHm8+Pb6AQoEefAUNGjAmYMGVGyJwFEUtiViSkrNmwZUfGngM5RwpOlJy5UHHlxp2ahgdPXrR0vPkU38BfAvToM2DIiDEBE6bMCJmzIGJJzIqElDUbtuzI2HMg50jBiZIzFyqu3LhT0/DgyYuWjjefv76BSoAefQYMGTEmYMKUGSFzFkQsiVmRkLJmw5YdGXsO5BwpOFFy5kLFlRt3ahoePHnR0vHmU30DPwXo0WfAkBFjAiZMmREyZ0HEkpgVCSlrNmzZkbHnQM6RghMlZy5UXLlxp6bhwZMXLR1vPj+/gUaAHn0GDBkxJmDClBkhcxZELIlZkZCyZsOWHRl7DuQcKThRcuZCxZUbd2oaHjx50dLx5tN8A38L0KPPgCEjxgRMmDIjZM6CiCUxKxJS1mzYsiNjz4GcIwUnSs5cqLhy405Nw4MnL1o63nz+/gY6AXr0GTBkxJiACVNmhMxZELEkZkVCypoNW3Zk7DmQc6TgRMmZCxVXbtypaXjw5EVLx5tP9w38I0CPPgOGjBgTMGHKjJA5CyKWxKxISFmzYcuOjD0Hco4UnCg5c6Hiyo07NQ0Pnrxo6Xjz+ecb+FeAHn0GDBkxJmDClBkhcxZELIlZkZCyZsOWHRl7DuQcKThRcuZCxZUbd2oaHjx50dLx5sP/xj5eeU54dY8AAAAASUVORK5CYII=">',
    });
    await renderApp();
    await clickText("Image keyboard");
    await key("enter");
    expect(frame()).toContain("Image: Keyboard chart");
    const images = (): Renderable[] => {
      const visit = (node: Renderable): Renderable[] => [node, ...node.getChildren().flatMap(visit)];
      return visit(setup!.renderer.root).filter((node) => node instanceof ImageRenderable);
    };
    expect(images()).toHaveLength(0);
    await key("tab");
    await key("enter");
    for (let attempt = 0; attempt < 20 && images().length === 0; attempt++) {
      await Bun.sleep(10);
      await flush();
    }
    expect(images()).toHaveLength(1);
    await key(" ");
    expect(images()).toHaveLength(0);
  });

  it("scrolls the entire reader with keys, preserving the selected message and reflowing after resize", async () => {
    seedMessage("Long message", "2026-01-02T10:00:00.000Z", undefined, [], [], {
      text: Array.from({ length: 220 }, (_, i) => `Paragraph ${i}. This sentence wraps within the message pane.`).join("\n\n"),
    });
    seedMessage("Other message", "2026-01-01T10:00:00.000Z");
    await renderApp();
    await clickText("Long message");
    await key("enter");
    expect(frame()).toContain("Paragraph 0.");
    await key("pagedown");
    expect(frame()).not.toContain("Paragraph 0.");
    expect(frame()).toContain("Long message");
    await key("down");
    expect(frame()).toContain("Long message");
    setup?.mockInput.pressKey("\x1b[F");
    await flush();
    expect(frame()).toContain("Paragraph 219.");
    setup?.resize(80, 24);
    await flush();
    setup?.mockInput.pressKey("\x1b[H");
    await flush();
    expect(frame()).toContain("Paragraph 0.");
    expect(frame()).toContain("message pane.");
    await key("escape");
    expect(frame()).toContain("Other message");
  });

  it("keeps expanded content open while refreshing the mailbox", async () => {
    seedMessage("Refresh reading", undefined, undefined, [], [], { text: "Intro\n\n```sh\ncd keep-reading\n```" });
    await renderApp();
    await key("enter");
    await clickText("Code · sh");
    expect(frame()).toContain("cd keep-reading");
    await key("r", { ctrl: true });
    await Bun.sleep(80);
    await flush();
    expect(frame()).toContain("cd keep-reading");
  });

  it("renders an HTML email as rich text with a real table and trimmed Gmail history", async () => {
    seedMessage("HTML update", undefined, undefined, [], [], { html: '<h1>Deployment report</h1><p><b>Ready</b> for <a href="https://example.com/review">review</a>.</p><div style="display:none">invisible preview</div><table><tr><th>Service</th><th>Status</th></tr><tr><td>API</td><td>Healthy</td></tr></table><div class="gmail_quote"><p>Previous deployment report</p></div>' });
    await renderApp();
    await clickText("HTML update");
    await key("enter");
    expect(frame()).toContain("Deployment report");
    expect(frame()).toContain("Ready for review.");
    expect(frame()).toContain("Service");
    expect(frame()).toContain("Healthy");
    expect(frame()).not.toContain("<table>");
    expect(frame()).not.toContain("invisible preview");
    expect(frame()).not.toContain("Previous deployment report");
    await clickText("Quoted message");
    expect(frame()).toContain("Previous deployment report");
  });

  it("allows only web and mail links in native message chunks, including tables and images", async () => {
    seedMessage("Untrusted links", undefined, undefined, [], [], { text: [
      "[Safe prose](https://example.com/prose) [Bad prose](file:///tmp/prose.txt)",
      "| Action |\n| --- |\n| [Safe table](https://example.com/table) |\n| [Email](mailto:help@example.com) |\n| [Bad table](file:///tmp/test.txt) |\n| [App](custom-app://open) |\n| ![Unsafe image](file:///tmp/image.png) |\n| [Reference][bad] |",
      "![Standalone image](custom-app://image)",
      "<a href=\"file:///tmp/raw.txt\">Raw HTML</a>",
      "[bad]: javascript:alert(1)",
    ].join("\n\n") });
    await renderApp();
    await key("enter");
    await flush();
    const chunks: TextChunk[] = [];
    const collect = (node: Renderable) => {
      if (node instanceof TextTableRenderable) chunks.push(...node.content.flat(2).filter((chunk): chunk is TextChunk => !!chunk));
      if (node instanceof TextRenderable) chunks.push(...node.chunks);
      for (const child of node.getChildren()) collect(child);
    };
    collect(setup!.renderer.root);
    const urls = [...new Set(chunks.flatMap((chunk) => chunk.link ? [chunk.link.url] : []))].sort();
    expect(urls).toEqual(["https://example.com/prose", "https://example.com/table", "mailto:help@example.com"]);
    expect(chunks.map((chunk) => chunk.text).join(" ")).toContain("Bad table");
  });

  it("refreshes replies in the selected thread without collapsing its expanded code", async () => {
    seedMessage("Refresh thread", "2026-01-01T10:00:00.000Z", undefined, [], [], { text: "Earlier reply" });
    seedMessage("Re: Refresh thread", "2026-01-02T10:00:00.000Z", undefined, [], [], { text: "Intro\n\n```sh\ncd keep-thread-open\n```" });
    await renderApp();
    await clickText("Re: Refresh");
    await key("enter");
    await clickText("Code · sh");
    expect(frame()).toContain("cd keep-thread-open");
    seedMessage("Re: Re: Refresh thread", "2026-01-03T10:00:00.000Z", undefined, [], [], { text: "New reply after refresh" });
    bustScanCache();
    await key("r", { ctrl: true });
    await Bun.sleep(100);
    await flush();
    expect(frame()).toContain("cd keep-thread-open");
    await clickText("Sender Re: Re: Refresh");
    expect(frame()).toContain("New reply after refresh");
  });

  it("collapses older thread messages while keeping the selected message open", async () => {
    seedMessage("Thread story", "2026-01-01T10:00:00.000Z", undefined, [], [], { text: "Earlier thread body" });
    seedMessage("Re: Thread story", "2026-01-02T10:00:00.000Z", undefined, [], [], { text: "Latest thread body" });
    await renderApp();
    await clickText("Re: Thread");
    await key("enter");
    await setup?.waitForFrame((value) => value.includes("Latest thread body"));
    expect(frame()).not.toContain("Earlier thread body");
    await clickText("Sender Thread story");
    expect(frame()).toContain("Earlier thread body");
    await clickText("Sender Thread story");
    expect(frame()).not.toContain("Earlier thread body");
  });


  it("resolves a searched-for inbox to its real address, never falling back to All inboxes", () => {
    // Regression: the picker caps the address list (200). An address found by TYPING in the
    // search box but sitting beyond that cap used to make reload() fall back to list[0] =
    // "All inboxes", so selecting it showed every message instead of that inbox.
    expect(resolveAddressChoice("all", []).id).toBe("all");
    expect(resolveAddressChoice("", []).id).toBe("all");

    const inList = resolveAddressChoice("a:ops@example.com", [
      { id: "a:ops@example.com", label: "ops@example.com", address: "ops@example.com", configured: true, observed: false },
    ]);
    expect(inList.address).toBe("ops@example.com");

    // The bug: an id NOT in the candidate list must still resolve to its real address
    // (via the DB), not collapse to "All inboxes".
    const beyondCap = resolveAddressChoice("a:vlado0549196@mbox.contact.bg", []);
    expect(beyondCap.id).toBe("a:vlado0549196@mbox.contact.bg");
    expect(beyondCap.address).toBe("vlado0549196@mbox.contact.bg");
    expect(beyondCap.id).not.toBe("all");
  });

  it("renders the Solid/OpenTUI mailbox with open-aicopilot-style structure", async () => {
    seedMessage("hello inbox", new Date().toISOString(), "long.recipient@example.com");
    await renderApp();

    // The initial mailbox scan is a real /v1 round-trip against the stub;
    // a single event-loop yield can finish before it lands under CI load.
    // Wait for the seeded message, bounded, instead of racing the fetch.
    for (let attempt = 0; attempt < 100 && !frame().includes("hello inbox"); attempt++) {
      await Bun.sleep(25);
      await setup?.flush();
    }

    expect(frame()).toContain("All mailboxes ▾");
    expect(frame()).toContain("Mail");
    expect(frame()).toContain("Labels");
    expect(frame()).toContain("Actions");
    expect(frame()).toContain("hello inbox");
    expect(frame()).toContain("long.recipient@examp");
    expect(frame()).not.toContain("Today");
    expect(frame()).toContain("Newest first");
  });

  it("opens the keymap-backed command palette without printable shortcut conflicts", async () => {
    seedMessage("shortcut safety");
    await renderApp();

    await key("c");
    expect(frame()).not.toContain("Compose\nFrom");

    await key("p", { ctrl: true });
    expect(frame()).toContain("Shortcuts");
    expect(frame()).toContain("Compose");
    expect(frame()).toContain("Filter Mail");
    expect(frame()).toContain("Search Mail");

    await key("down");
    await key("enter");
    expect(frame()).toContain("Compose");
    expect(frame()).toContain("Markdown enabled");
  });

  it("opens messages only on click/enter, not hover-driven selection", async () => {
    seedMessage("first message", "2026-01-01T10:00:00.000Z");
    seedMessage("second message", "2026-01-02T10:00:00.000Z");
    await renderApp();

    await clickText("first message");
    expect(frame()).toContain("first message");
    expect(frame()).not.toContain("From:");

    await key("enter");
    expect(frame()).toContain("From:");
    expect(frame()).toContain("Reply");
    expect(frame()).toContain("Forward");
  });

  it("opens attachment details from the reader", async () => {
    // Self-hosted derives attachment metadata (filename/type/size) from the server;
    // local file paths (local_path/s3_url) have no /v1 equivalent, so the reader shows
    // the metadata but not a local `file://` link.
    seedMessage("has attachment", "2026-01-01T10:00:00.000Z", "ops@example.com", [], [
      { filename: "invoice.pdf", content_type: "application/pdf", size: 2048 },
    ]);
    await renderApp();

    await key("enter");
    expect(frame()).toContain("1 attachment available");
    expect(frame()).toContain("Attachments");

    await clickText("Attachments");
    expect(frame()).toContain("invoice.pdf");
    expect(frame()).toContain("application/pdf");
    expect(frame()).toContain("2 KB");
    expect(frame()).toContain("Download to Downloads");
    expect(frame()).toContain("Copy link");
    await clickText("Copy link");
    await key("enter");
    expect(frame()).toContain("Attachment link copied");
    expect(frame()).toContain("Requires authenticated API access");
  });

  // NOTE: the former "renders AI summaries below the email body" test was removed.
  // It validated a LOCAL-only join (the email_agents run summary folded into the
  // message body). The self-hosted mail data source builds the reader body straight
  // from the /v1 message row (v1ToMessageBody sets summary=""), so agent-run
  // summaries are not surfaced in the reader — surfacing them would be a separate
  // source feature, outside this migration's scope.

  it("searches through a dialog and keeps the search visible in the content area", async () => {
    seedMessage("alpha invoice");
    seedMessage("beta newsletter");
    await renderApp();

    await clickText("Search");
    expect(frame()).toContain("Search Mail");
    await typeText("invoice");
    setup?.mockInput.pressEnter();
    await flush();

    expect(frame()).toContain("alpha invoice");
    expect(frame()).not.toContain("beta newsletter");
    expect(frame()).toContain("Search: invoice");
  });

  it("filters from the compact filter dialog and clears filters", async () => {
    seedMessage("alpha invoice");
    seedMessage("beta newsletter");
    await renderApp();

    await clickText("Filter");
    expect(frame()).toContain("Filter Mail");
    expect(frame()).toContain("Unread");
    expect(frame()).toContain("Starred");
    await typeText("invoice");
    setup?.mockInput.pressEnter();
    await flush();

    expect(frame()).toContain("alpha invoice");
    expect(frame()).not.toContain("beta newsletter");
    expect(frame()).toContain("Search: invoice");

    await clickText("Filter");
    await clickText("Clear");
    expect(frame()).toContain("alpha invoice");
    expect(frame()).toContain("beta newslett");
    expect(frame()).not.toContain("Search: invoice");
  });

  it("filters mailbox content from sidebar labels and mail categories", async () => {
    seedMessage("urgent message", "2026-01-03T10:00:00.000Z", "ops@example.com", ["urgent"]);
    seedMessage("updates message", "2026-01-02T10:00:00.000Z", "ops@example.com", ["CATEGORY_UPDATES"]);
    seedMessage("plain message", "2026-01-01T10:00:00.000Z");
    await renderApp();

    expect(frame()).toContain("Categories");
    expect(frame()).toContain("Updates");
    expect(frame()).not.toContain("Category Updates");
    expect(frame()).toContain("Urgent");

    await clickText("Urgent");
    expect(frame()).toContain("Label: Urgent");
    expect(frame()).toContain("urgent message");
    expect(frame()).not.toContain("updates message");
    expect(frame()).not.toContain("plain message");

    await clickText("Inbox");
    expect(frame()).not.toContain("Label: Urgent");

    await clickText("Updates");
    expect(frame()).toContain("Label: Updates");
    expect(frame()).toContain("updates messa");
    expect(frame()).not.toContain("urgent message");
    expect(frame()).not.toContain("plain message");
  });

  it("saves, applies, reads back, and removes a saved inbox filter", async () => {
    seedMessage("support request", "2026-01-03T10:00:00.000Z");
    seedMessage("product newsletter", "2026-01-02T10:00:00.000Z");
    await renderApp();

    await clickText("Filter");
    await typeText("support");
    setup?.mockInput.pressEnter();
    await flush();
    expect(frame()).toContain("support request");
    expect(frame()).not.toContain("product newsletter");

    await clickText("Save filter");
    expect(frame()).toContain("Save Filter");
    await typeText("Support queue");
    setup?.mockInput.pressEnter();
    await flush();
    expect(frame()).toContain("Saved filter: Support queue");
    expect(await stub.list("mailbox-filters")).toHaveLength(1);

    await clickText("Manage saved filters");
    expect(frame()).toContain("Support queue");
    await clickText("Delete");
    await flush();
    expect(await stub.list("mailbox-filters")).toHaveLength(0);
    expect(frame()).not.toContain("Saved filter: Support queue");
  });

  it("opens inbox picker, compose, domains dialog, and settings dialog from visible buttons", async () => {
    // The local S3 "Sources" list is gone in the self-hosted-only client (ingestion
    // is a single server-owned store), so the former Sources sub-flow was removed.
    seedMessage("workspace smoke");
    createDomain(providerId, "example.com");
    await renderApp();
    expect(frame()).not.toContain("Profiles");

    await clickText("All mailboxes ▾");
    expect(frame()).toContain("Mailboxes");
    expect(frame()).toContain("ops@example.com");
    // The picker detail is a short receive-status token ("ready" for a verified
    // address); the provider now lives in the Domains view.
    expect(frame()).toContain("ready");
    expect(frame()).not.toContain("Profiles");
    await key("escape");

    await clickText("Compose");
    expect(frame()).toContain("Compose");
    expect(frame()).toContain("Markdown enabled");
    await typeText("client@example.com");
    await key("tab");
    await typeText("Subject Probe");
    await key("tab");
    await typeText("Body Probe");
    const composeLines = frame().split("\n");
    const subjectLine = composeLines.findIndex((line) => line.includes("Subject Probe"));
    const bodyLine = composeLines.findIndex((line) => line.includes("Body Probe"));
    expect(subjectLine).toBeGreaterThanOrEqual(0);
    expect(bodyLine).toBeGreaterThan(subjectLine);
    await key("escape");

    await clickText("Domains");
    expect(frame()).toContain("Domains");
    expect(frame()).toContain("example.com");
    expect(frame()).toContain("Provider");
    expect(frame()).toContain("Readiness");
    expect(frame()).toContain("Needs DNS");
    expect(frame()).not.toContain("Addr");
    expect(frame()).not.toContain("Needs Dns");
    await key("escape");

    await clickText("Settings");
    expect(frame()).toContain("Settings");
    expect(frame()).toContain("General");
    expect(frame()).toContain("Refresh automatically");
    expect(frame()).toContain("Current mailbox");
    await clickText("Appearance");
    expect(frame()).toContain("Dim read messages");
    expect(frame()).toContain("Color scheme");
    await clickText("Shortcuts");
    expect(frame()).toContain("Ctrl+F");
    await key("escape");
    expect(frame()).not.toContain("Preferences");
  });

  it("opens links, raw, and labels dialogs from the reader", async () => {
    seedMessage("links label");
    await renderApp();
    await key("enter");

    await clickText("Links");
    expect(frame()).toContain("Links");
    expect(frame()).toContain("https://example.com");
    expect(frame()).toContain("Open first link");
    await key("escape");

    await clickText("Raw");
    expect(frame()).toContain("Raw Email");
    expect(frame()).toContain("Subject: links label");
    expect(frame()).toContain("Text body");
    await key("escape");

    await clickText("Label", 1);
    expect(frame()).toContain("Labels");
    expect(frame()).toContain("Action Required");
  });

  // The manual Pull affordance triggered LOCAL S3→SQLite ingestion (autoPull) and no
  // longer exists in the self-hosted-only client: the server ingests and the client
  // syncs via the automatic delta. The toolbar row is isolated by the "Digest" line so
  // the empty-state "Pull mail…" copy can't be mistaken for a button.
  const toolbarLine = () => frame().split("\n").find((line) => line.includes("Digest")) ?? "";

  it("does not render the manual Pull affordance (self-hosted ingests server-side)", async () => {
    seedMessage("no manual pull");
    await renderApp();

    // The toolbar keeps its other actions but has no manual Pull button.
    const toolbar = toolbarLine();
    expect(toolbar).toContain("Digest");
    expect(toolbar).toContain("Newest first");
    expect(toolbar).not.toContain("Pull");

    // The command palette exposes no "Pull Now" command.
    await key("p", { ctrl: true });
    expect(frame()).toContain("Shortcuts");
    await typeText("Pull");
    expect(frame()).not.toContain("Pull Now");
    expect(frame()).toContain("No matches");
  });
});
