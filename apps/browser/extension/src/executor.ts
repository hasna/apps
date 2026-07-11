import type { ExtJob } from "./protocol";

interface Snapshot {
  url?: string;
  title?: string;
  meta_description?: string;
  meta_keywords?: string;
  links_count?: number;
  images_count?: number;
  forms_count?: number;
  text_length?: number;
  count?: number;
  visible?: boolean;
  enabled?: boolean;
  value?: string;
  tag?: string;
  text?: string;
}

export async function executeDomJob(job: ExtJob): Promise<unknown> {
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const payload = "payload" in job && job.payload ? job.payload as Record<string, unknown> : {};

  const query = (selector: unknown): Element => {
    if (typeof selector !== "string" || !selector) throw new Error("selector required");
    const el = document.querySelector(selector);
    if (!el) throw new Error(`Element not found: ${selector}`);
    return el;
  };

  const isVisible = (el: Element): boolean => {
    const style = getComputedStyle(el);
    const rect = (el as HTMLElement).getBoundingClientRect();
    return style.display !== "none"
      && style.visibility !== "hidden"
      && Number(style.opacity || "1") > 0
      && rect.width > 0
      && rect.height > 0;
  };

  const dispatchInputEvents = (el: Element) => {
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };

  const setElementValue = (el: Element, value: string | boolean) => {
    const input = el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    const tag = el.tagName.toLowerCase();
    const type = (input as HTMLInputElement).type?.toLowerCase();

    if (tag === "input" && (type === "checkbox" || type === "radio")) {
      (input as HTMLInputElement).checked = value === true || value === "true" || value === "1";
      dispatchInputEvents(el);
      return;
    }

    input.value = String(value);
    dispatchInputEvents(el);
  };

  const clickElement = (el: Element) => {
    (el as HTMLElement).scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    (el as HTMLElement).focus?.();
    el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse", isPrimary: true }));
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, buttons: 1 }));
    el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerType: "mouse", isPrimary: true }));
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    (el as HTMLElement).click();
  };

  const extractText = (selector?: unknown): string | null => {
    const el = typeof selector === "string" && selector ? document.querySelector(selector) : document.body;
    if (!el) return null;
    return ((el as HTMLElement).innerText ?? el.textContent ?? "").trim();
  };

  const extractHtml = (selector?: unknown): string | null => {
    if (typeof selector === "string" && selector) {
      const el = document.querySelector(selector);
      return el ? el.innerHTML : null;
    }
    return document.documentElement.outerHTML;
  };

  const extractLinks = (baseUrl?: unknown): string[] => {
    const base = typeof baseUrl === "string" && baseUrl ? baseUrl : location.href;
    return Array.from(document.querySelectorAll("a[href]"))
      .map((a) => {
        const href = (a as HTMLAnchorElement).getAttribute("href");
        if (!href) return null;
        try { return new URL(href, base).href; } catch { return null; }
      })
      .filter((href): href is string => Boolean(href));
  };

  const snapshot = (selector?: unknown): Snapshot => {
    if (typeof selector === "string" && selector) {
      const elements = Array.from(document.querySelectorAll(selector));
      const first = elements[0] as HTMLElement | HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | undefined;
      return {
        count: elements.length,
        visible: first ? isVisible(first) : false,
        enabled: first ? !(first as HTMLButtonElement | HTMLInputElement).disabled : false,
        value: first && "value" in first ? String(first.value ?? "") : undefined,
        tag: first?.tagName.toLowerCase(),
        text: first ? ((first as HTMLElement).innerText ?? first.textContent ?? "").trim() : undefined,
      };
    }

    return {
      url: location.href,
      title: document.title,
      meta_description: document.querySelector('meta[name="description"]')?.getAttribute("content") ?? undefined,
      meta_keywords: document.querySelector('meta[name="keywords"]')?.getAttribute("content") ?? undefined,
      links_count: document.querySelectorAll("a[href]").length,
      images_count: document.querySelectorAll("img").length,
      forms_count: document.querySelectorAll("form").length,
      text_length: (document.body?.innerText ?? document.body?.textContent ?? "").length,
    };
  };

  switch (job.type) {
    case "ping":
      return { pong: true };
    case "click":
      clickElement(query(payload.selector));
      return snapshot(payload.selector);
    case "type": {
      const el = query(payload.selector);
      const input = el as HTMLInputElement | HTMLTextAreaElement;
      const text = String(payload.text ?? "");
      (el as HTMLElement).focus?.();
      if (payload.clear) setElementValue(el, "");
      for (const char of text) {
        el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: char }));
        input.value = `${input.value ?? ""}${char}`;
        el.dispatchEvent(new InputEvent("input", { bubbles: true, data: char, inputType: "insertText" }));
        el.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: char }));
        const delay = Number(payload.delay ?? 0);
        if (delay > 0) await wait(delay);
      }
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return snapshot(payload.selector);
    }
    case "fill": {
      const el = query(payload.selector);
      (el as HTMLElement).focus?.();
      setElementValue(el, String(payload.value ?? ""));
      return snapshot(payload.selector);
    }
    case "select": {
      const el = query(payload.selector);
      if (el.tagName.toLowerCase() !== "select") {
        throw new Error(`Element is not a select: ${String(payload.selector)}`);
      }
      (el as HTMLElement).focus?.();
      setElementValue(el, String(payload.value ?? ""));
      return snapshot(payload.selector);
    }
    case "press": {
      const key = String(payload.key ?? "");
      const target = document.activeElement ?? document.body;
      target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key }));
      target.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key }));
      return { key };
    }
    case "wait": {
      const selector = String(payload.selector ?? "");
      const state = String(payload.state ?? "visible");
      const deadline = Date.now() + (job.timeout_ms ?? 10_000);
      while (Date.now() < deadline) {
        const el = document.querySelector(selector);
        const visible = el ? isVisible(el) : false;
        if (state === "attached" && el) return snapshot(selector);
        if (state === "visible" && el && visible) return snapshot(selector);
        if (state === "hidden" && (!el || !visible)) return snapshot(selector);
        if (state === "detached" && !el) return snapshot(selector);
        await wait(100);
      }
      throw new Error(`Timed out waiting for ${selector} to be ${state}`);
    }
    case "scroll":
      window.scrollBy(Number(payload.x ?? 0), Number(payload.y ?? 0));
      return snapshot();
    case "extract":
      if (payload.format === "text") return extractText(payload.selector);
      if (payload.format === "html") return extractHtml(payload.selector);
      if (payload.format === "links") return extractLinks(payload.baseUrl);
      if (payload.format === "snapshot") return snapshot(payload.selector);
      throw new Error(`Unsupported extract format: ${String(payload.format)}`);
    default:
      throw new Error(`Unsupported DOM job: ${(job as ExtJob).type}`);
  }
}
