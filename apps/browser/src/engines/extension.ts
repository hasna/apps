import { randomUUID } from "node:crypto";
import type { Page } from "playwright";
import { BrowserError, type ConnectedExtensionStatus, type ExtExtractFormat, type ExtJob, type ExtResult } from "../types/index.js";
import { dispatchExtensionJob, getExtensionBridgeStatus, getPairedExtensionOrThrow, type ConnectedExtension } from "../lib/extension-bridge.js";
import { logEvent } from "../db/timeline.js";

export interface ExtensionPageOptions {
  sessionId?: string;
  tokenId?: string;
  serverUrl?: string;
  viewport?: { width: number; height: number };
  approvalToken?: string;
}

interface ExtensionPageInfoData {
  url: string;
  title: string;
  meta_description?: string;
  meta_keywords?: string;
  links_count: number;
  images_count: number;
  forms_count: number;
  text_length: number;
}

const EXTENSION_PAGE_MARKER = Symbol.for("@hasna/browser.extension-page");

function unwrapResult<T>(result: ExtResult): T {
  if (!result.ok) {
    throw new BrowserError(result.error, "EXTENSION_JOB_FAILED");
  }
  return (result.screenshot ?? result.data) as T;
}

class ExtensionElementHandle {
  constructor(
    private readonly page: ExtensionPage,
    private readonly selector: string,
    private readonly index = 0,
  ) {}

  private indexedSelector(): string {
    if (this.index === 0) return this.selector;
    return `${this.selector}:nth-of-type(${this.index + 1})`;
  }

  async textContent(): Promise<string | null> {
    return this.page.extractText(this.indexedSelector());
  }

  async innerHTML(): Promise<string | null> {
    return this.page.extractHtml(this.indexedSelector());
  }

  async isVisible(): Promise<boolean> {
    try {
      const snapshot = await this.page.extractSnapshot(this.indexedSelector());
      return Boolean((snapshot as { visible?: boolean } | null)?.visible);
    } catch {
      return false;
    }
  }

  async evaluate<T = unknown>(fnOrExpr: string | ((element: Element, ...args: unknown[]) => T), ...args: unknown[]): Promise<T> {
    const expression = typeof fnOrExpr === "function"
      ? `(${fnOrExpr.toString()})(document.querySelector(${JSON.stringify(this.indexedSelector())}), ...${JSON.stringify(args)})`
      : fnOrExpr;
    return this.page.evaluate(expression) as Promise<T>;
  }

  async screenshot(): Promise<Buffer> {
    return this.page.screenshot();
  }
}

class ExtensionLocator {
  constructor(private readonly page: ExtensionPage, private readonly selector: string) {}

  first(): ExtensionLocator {
    return this;
  }

  async click(opts?: { button?: "left" | "right" | "middle"; timeout?: number }): Promise<void> {
    await this.page.click(this.selector, opts);
  }

  async fill(value: string, opts?: { timeout?: number }): Promise<void> {
    await this.page.fill(this.selector, value, opts);
  }

  async pressSequentially(text: string, opts?: { delay?: number; timeout?: number }): Promise<void> {
    await this.page.type(this.selector, text, opts);
  }

  async scrollIntoViewIfNeeded(): Promise<void> {
    await this.page.dispatch("wait", { selector: this.selector, state: "visible" }, 10_000);
  }

  async elementHandle(): Promise<ExtensionElementHandle | null> {
    return this.page.$(this.selector);
  }

  async evaluate<T = unknown>(fnOrExpr: string | ((element: Element, ...args: unknown[]) => T), ...args: unknown[]): Promise<T> {
    const handle = new ExtensionElementHandle(this.page, this.selector);
    return handle.evaluate(fnOrExpr, ...args);
  }
}

type ExtensionDispatcher = (job: ExtJob, opts: { tokenId?: string; timeoutMs?: number; approvalToken?: string }) => Promise<ExtResult>;

function normalizeServerUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

async function remoteDispatch(serverUrl: string, job: ExtJob, opts: { tokenId?: string; timeoutMs?: number; approvalToken?: string }): Promise<ExtResult> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const apiKey = process.env["BROWSER_API_KEY"];
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
  const response = await fetch(`${normalizeServerUrl(serverUrl)}/api/extension/dispatch`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      job,
      token_id: opts.tokenId || undefined,
      timeout_ms: opts.timeoutMs,
      approval_token: opts.approvalToken,
    }),
  });
  if (!response.ok) {
    throw new BrowserError(`Extension server dispatch failed: ${response.status} ${await response.text()}`, "EXTENSION_SERVER_DISPATCH_FAILED");
  }
  const body = await response.json() as { result?: ExtResult };
  if (!body.result) throw new BrowserError("Extension server dispatch response did not include a result", "EXTENSION_SERVER_DISPATCH_FAILED");
  return body.result;
}

export class ExtensionPage {
  readonly [EXTENSION_PAGE_MARKER] = true;
  readonly keyboard = {
    press: async (key: string) => this.press(key),
  };

  private lastUrl = "";
  private lastTitle = "";
  private readonly sessionId?: string;
  private readonly tokenId?: string;
  private readonly viewport: { width: number; height: number };
  private readonly approvalToken?: string;
  private readonly dispatcher: ExtensionDispatcher;

  constructor(connection: Pick<ConnectedExtension, "token_id">, opts: ExtensionPageOptions & { dispatcher?: ExtensionDispatcher } = {}) {
    this.sessionId = opts.sessionId;
    this.tokenId = opts.tokenId || connection.token_id || undefined;
    this.viewport = opts.viewport ?? { width: 1280, height: 720 };
    this.approvalToken = opts.approvalToken;
    this.dispatcher = opts.dispatcher ?? dispatchExtensionJob;
  }

  async dispatch<T = unknown>(type: ExtJob["type"], payload: Record<string, unknown> = {}, timeoutMs = 30_000): Promise<T> {
    const job = {
      id: randomUUID(),
      type,
      session_id: this.sessionId,
      payload,
      timeout_ms: timeoutMs,
    } as ExtJob;
    if (this.sessionId) {
      try {
        logEvent(this.sessionId, "extension_job", { engine: "extension", job_id: job.id, job_type: type, payload });
      } catch {}
    }
    const result = await this.dispatcher(job, { tokenId: this.tokenId, timeoutMs, approvalToken: this.approvalToken });
    if (result.ok) {
      if (result.url) this.lastUrl = result.url;
      if (result.title) this.lastTitle = result.title;
    }
    if (this.sessionId) {
      try {
        logEvent(this.sessionId, "extension_result", {
          engine: "extension",
          job_id: job.id,
          job_type: type,
          ok: result.ok,
          error: result.ok ? undefined : result.error,
          url: result.url,
          title: result.title,
        });
      } catch {}
    }
    return unwrapResult<T>(result);
  }

  async goto(url: string, opts?: { waitUntil?: string; timeout?: number }): Promise<null> {
    await this.dispatch("navigate", { url }, opts?.timeout ?? 30_000);
    this.lastUrl = url;
    return null;
  }

  async click(selector: string, opts?: { button?: "left" | "right" | "middle"; clickCount?: number; delay?: number; timeout?: number }): Promise<void> {
    await this.dispatch("click", {
      selector,
      button: opts?.button ?? "left",
      clickCount: opts?.clickCount ?? 1,
    }, opts?.timeout ?? 10_000);
  }

  async type(selector: string, text: string, opts?: { delay?: number; timeout?: number; clear?: boolean }): Promise<void> {
    await this.dispatch("type", {
      selector,
      text,
      delay: opts?.delay,
      clear: opts?.clear,
    }, opts?.timeout ?? 10_000);
  }

  async fill(selector: string, value: string, opts?: { timeout?: number }): Promise<void> {
    await this.dispatch("fill", { selector, value }, opts?.timeout ?? 10_000);
  }

  async press(key: string): Promise<void> {
    await this.dispatch("press", { key }, 10_000);
  }

  async waitForSelector(selector: string, opts?: { state?: "attached" | "detached" | "visible" | "hidden"; timeout?: number }): Promise<ExtensionElementHandle | null> {
    await this.dispatch("wait", {
      selector,
      state: opts?.state ?? "visible",
    }, opts?.timeout ?? 10_000);
    return new ExtensionElementHandle(this, selector);
  }

  async scroll(direction: "up" | "down" | "left" | "right" = "down", amount = 300): Promise<void> {
    const x = direction === "left" ? -amount : direction === "right" ? amount : 0;
    const y = direction === "up" ? -amount : direction === "down" ? amount : 0;
    await this.dispatch("scroll", { x, y }, 10_000);
  }

  async hover(selector: string): Promise<void> {
    await this.dispatch("wait", { selector, state: "visible" }, 10_000);
  }

  async textContent(selector: string): Promise<string | null> {
    return this.extractText(selector);
  }

  async innerText(selector: string): Promise<string | null> {
    return this.extractText(selector);
  }

  async content(): Promise<string> {
    return (await this.extractHtml()) ?? "";
  }

  async extractText(selector?: string): Promise<string | null> {
    return this.extract("text", selector);
  }

  async extractHtml(selector?: string): Promise<string | null> {
    return this.extract("html", selector);
  }

  async extractLinks(baseUrl?: string): Promise<string[]> {
    return this.dispatch("extract", { format: "links", baseUrl: baseUrl ?? this.url() }, 10_000);
  }

  async extractSnapshot(selector?: string): Promise<unknown> {
    return this.extract("snapshot", selector);
  }

  async pageInfo(): Promise<ExtensionPageInfoData> {
    const snapshot = await this.extractSnapshot();
    const info = snapshot as Partial<ExtensionPageInfoData> | null;
    const data: ExtensionPageInfoData = {
      url: typeof info?.url === "string" ? info.url : this.url(),
      title: typeof info?.title === "string" ? info.title : await this.title(),
      meta_description: typeof info?.meta_description === "string" ? info.meta_description : undefined,
      meta_keywords: typeof info?.meta_keywords === "string" ? info.meta_keywords : undefined,
      links_count: typeof info?.links_count === "number" ? info.links_count : 0,
      images_count: typeof info?.images_count === "number" ? info.images_count : 0,
      forms_count: typeof info?.forms_count === "number" ? info.forms_count : 0,
      text_length: typeof info?.text_length === "number" ? info.text_length : 0,
    };
    this.lastUrl = data.url;
    this.lastTitle = data.title;
    return data;
  }

  private async extract<T = unknown>(format: ExtExtractFormat, selector?: string): Promise<T> {
    return this.dispatch("extract", { format, selector }, 10_000);
  }

  async screenshot(opts?: { path?: string; type?: string; fullPage?: boolean; quality?: number }): Promise<Buffer> {
    const base64 = await this.dispatch<string>("screenshot", { fullPage: opts?.fullPage ?? false }, 30_000);
    return Buffer.from(base64, "base64");
  }

  async evaluate<T = unknown>(fnOrExpr: string | ((...args: unknown[]) => T), ...args: unknown[]): Promise<T> {
    void fnOrExpr;
    void args;
    throw new BrowserError(
      "Extension evaluate is not supported. Use bounded extension jobs such as extract, click, fill, select, screenshot, or semantic actions.",
      "EXTENSION_EVAL_UNSUPPORTED",
    );
  }

  url(): string {
    return this.lastUrl;
  }

  async title(): Promise<string> {
    if (this.lastTitle) return this.lastTitle;
    try {
      const info = await this.pageInfo();
      return info.title;
    } catch {
      return "";
    }
  }

  viewportSize(): { width: number; height: number } {
    return this.viewport;
  }

  async $(selector: string): Promise<ExtensionElementHandle | null> {
    try {
      await this.waitForSelector(selector, { state: "attached", timeout: 1_000 });
      return new ExtensionElementHandle(this, selector);
    } catch {
      return null;
    }
  }

  async $$(selector: string): Promise<ExtensionElementHandle[]> {
    const snapshot = await this.extractSnapshot(selector) as { count?: number } | null;
    const count = Math.max(0, snapshot?.count ?? 0);
    return Array.from({ length: count }, (_, index) => new ExtensionElementHandle(this, selector, index));
  }

  locator(selector: string): ExtensionLocator {
    return new ExtensionLocator(this, selector);
  }

  async inputValue(selector: string): Promise<string> {
    const snapshot = await this.extractSnapshot(selector) as { value?: string } | null;
    return snapshot?.value ?? "";
  }

  async isVisible(selector: string): Promise<boolean> {
    const el = await this.$(selector);
    return el ? el.isVisible() : false;
  }

  async isEnabled(selector: string): Promise<boolean> {
    const snapshot = await this.extractSnapshot(selector) as { enabled?: boolean } | null;
    return snapshot?.enabled ?? false;
  }

  async selectOption(selector: string, value: string): Promise<string[]> {
    await this.dispatch("select", { selector, value }, 10_000);
    return [value];
  }

  async check(selector: string): Promise<void> {
    await this.fill(selector, "true");
  }

  async uncheck(selector: string): Promise<void> {
    await this.fill(selector, "false");
  }
}

export function createExtensionPage(opts: ExtensionPageOptions = {}): Page {
  const serverUrl = opts.serverUrl ?? process.env["BROWSER_EXTENSION_SERVER_URL"];
  if (serverUrl) {
    return new ExtensionPage(
      { token_id: opts.tokenId ?? "" },
      {
        ...opts,
        dispatcher: (job, dispatchOpts) => remoteDispatch(serverUrl, job, dispatchOpts),
      },
    ) as unknown as Page;
  }

  const connection = getPairedExtensionOrThrow(opts.tokenId);
  return new ExtensionPage(connection, opts) as unknown as Page;
}

export function isExtensionPage(page: unknown): page is ExtensionPage {
  return Boolean(page && typeof page === "object" && (page as Record<symbol, unknown>)[EXTENSION_PAGE_MARKER]);
}

export function getExtensionStatuses(): ConnectedExtensionStatus[] {
  return getExtensionBridgeStatus().extensions;
}

export { getPairedExtensionOrThrow };
