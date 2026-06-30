import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Page } from "playwright";
import { UseCase, type ExtJob } from "../types/index.js";
import { resetDatabase } from "../db/schema.js";
import {
  attachExtensionSocket,
  consumeExtensionPairingCode,
  createExtensionPairing,
  resetExtensionBridgeForTests,
  validateExtensionToken,
} from "../lib/extension-bridge.js";
import { ExtensionPage, createExtensionPage } from "./extension.js";
import { isEngineAvailable, selectEngine } from "./selector.js";

let tmpDir: string;

function setupPage(onJob?: (job: ExtJob) => unknown): { page: Page; jobs: ExtJob[] } {
  const pairing = createExtensionPairing();
  const token = consumeExtensionPairingCode(pairing.code);
  const data = validateExtensionToken(token.token);
  const jobs: ExtJob[] = [];
  attachExtensionSocket({
    send(raw: string) {
      const message = JSON.parse(raw);
      if (message.type !== "job") return;
      const job = message.job as ExtJob;
      jobs.push(job);
      queueMicrotask(async () => {
        const dataPayload = onJob?.(job) ?? (
          job.type === "screenshot"
            ? undefined
            : { url: "https://example.test/", title: "Example" }
        );
        const result = job.type === "screenshot"
          ? { id: job.id, ok: true, screenshot: Buffer.from("png").toString("base64"), url: "https://example.test/", title: "Example" }
          : { id: job.id, ok: true, data: dataPayload, url: "https://example.test/", title: "Example" };
        const { handleExtensionSocketMessage } = await import("../lib/extension-bridge.js");
        handleExtensionSocketMessage(data.token_id, JSON.stringify({ type: "result", result }));
      });
    },
  }, data);

  return { page: createExtensionPage({ sessionId: "session-test" }), jobs };
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "browser-extension-engine-"));
  process.env["BROWSER_DB_PATH"] = join(tmpDir, "test.db");
  process.env["BROWSER_DATA_DIR"] = tmpDir;
  resetDatabase();
  resetExtensionBridgeForTests({ deleteTokens: true });
});

afterEach(() => {
  resetExtensionBridgeForTests({ deleteTokens: true });
  resetDatabase();
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  delete process.env["BROWSER_DB_PATH"];
  delete process.env["BROWSER_DATA_DIR"];
});

describe("extension engine selection", () => {
  it("is explicit-only and never auto-selected", () => {
    expect(selectEngine(UseCase.SPA_NAVIGATE)).not.toBe("extension");
    expect(selectEngine(UseCase.SPA_NAVIGATE, "extension")).toBe("extension");
  });

  it("is available only when a bridge connection exists", () => {
    expect(isEngineAvailable("extension")).toBe(false);
    setupPage();
    expect(isEngineAvailable("extension")).toBe(true);
  });
});

describe("ExtensionPage proxy", () => {
  it("maps navigation, click, fill, and screenshot to extension jobs", async () => {
    const { page, jobs } = setupPage();

    await page.goto("https://example.test/");
    await page.click("#go");
    await page.fill("input[name=q]", "hello");
    const screenshot = await page.screenshot();

    expect(jobs.map((job) => job.type)).toEqual(["navigate", "click", "fill", "screenshot"]);
    expect((jobs[0] as Extract<ExtJob, { type: "navigate" }>).payload.url).toBe("https://example.test/");
    expect((jobs[1] as Extract<ExtJob, { type: "click" }>).payload.selector).toBe("#go");
    expect((jobs[2] as Extract<ExtJob, { type: "fill" }>).payload.value).toBe("hello");
    expect(Buffer.isBuffer(screenshot)).toBe(true);
  });

  it("unwraps extension extract results", async () => {
    const { page } = setupPage((job) => {
      if (job.type === "extract" && job.payload.format === "text") return "Hello extension";
      if (job.type === "extract" && job.payload.format === "links") return ["https://example.test/a"];
      return {};
    });

    expect(await (page as any).extractText()).toBe("Hello extension");
    expect(await (page as any).extractLinks()).toEqual(["https://example.test/a"]);
  });

  it("does not expose arbitrary evaluate dispatch", async () => {
    const { page } = setupPage();
    await expect(page.evaluate(() => 1)).rejects.toThrow(/not supported/);
  });

  it("selectOption uses the closed select job without enabling arbitrary evaluate", async () => {
    const { page, jobs } = setupPage(() => ({ value: "US" }));
    expect(await page.selectOption("#country", "US")).toEqual(["US"]);
    expect(jobs[0].type).toBe("select");
    expect((jobs[0] as Extract<ExtJob, { type: "select" }>).payload).toEqual({
      selector: "#country",
      value: "US",
    });
  });

  it("omits blank token ids and forwards approval tokens to remote dispatchers", async () => {
    const dispatches: Array<{ tokenId?: string; approvalToken?: string }> = [];
    const page = new ExtensionPage({ token_id: "" }, {
      approvalToken: "approved",
      dispatcher: async (_job, opts) => {
        dispatches.push({ tokenId: opts.tokenId, approvalToken: opts.approvalToken });
        return { id: _job.id, ok: true, data: 7 };
      },
    });

    expect(await page.dispatch("ping")).toBe(7);
    expect(dispatches).toEqual([{ tokenId: undefined, approvalToken: "approved" }]);
  });
});
