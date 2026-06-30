import { describe, it, expect, mock } from "bun:test";
import { OPEN_BROWSER_BACKEND_ENV, OPEN_BROWSER_REMOTE_ENV, resolveEnginePreference, selectEngine, isEngineAvailable, inferUseCase } from "./selector.js";
import { UseCase } from "../types/index.js";
import { isBunWebViewAvailable } from "./bun-webview.js";

const bunAvailable = isBunWebViewAvailable();

describe("engine selector", () => {
  describe("selectEngine", () => {
    it("returns playwright for form fill (bun doesn't support multi-tab/upload)", () => {
      expect(selectEngine(UseCase.FORM_FILL)).toBe("playwright");
    });

    it("returns bun or playwright for screenshot depending on availability", () => {
      const engine = selectEngine(UseCase.SCREENSHOT);
      expect(["bun", "playwright"]).toContain(engine);
      if (bunAvailable) expect(engine).toBe("bun");
    });

    it("returns bun or playwright for SPA navigate depending on availability", () => {
      const engine = selectEngine(UseCase.SPA_NAVIGATE);
      expect(["bun", "playwright"]).toContain(engine);
    });

    it("returns playwright for auth flow", () => {
      expect(selectEngine(UseCase.AUTH_FLOW)).toBe("playwright");
    });

    it("returns cdp for network monitor", () => {
      expect(selectEngine(UseCase.NETWORK_MONITOR)).toBe("cdp");
    });

    it("returns cdp for HAR capture", () => {
      expect(selectEngine(UseCase.HAR_CAPTURE)).toBe("cdp");
    });

    it("returns cdp for perf profile", () => {
      expect(selectEngine(UseCase.PERF_PROFILE)).toBe("cdp");
    });

    it("returns cdp for coverage", () => {
      expect(selectEngine(UseCase.COVERAGE)).toBe("cdp");
    });

    it("prefers bun for scrape if available, falls back to lightpanda or playwright", () => {
      const engine = selectEngine(UseCase.SCRAPE);
      // Priority: bun > lightpanda > playwright
      expect(["bun", "lightpanda", "playwright"]).toContain(engine);
      if (bunAvailable) expect(engine).toBe("bun");
    });

    it("explicit engine overrides use case", () => {
      expect(selectEngine(UseCase.SCRAPE, "playwright")).toBe("playwright");
      expect(selectEngine(UseCase.SCREENSHOT, "cdp")).toBe("cdp");
      expect(selectEngine(UseCase.SCREENSHOT, "kernel")).toBe("kernel");
    });

    it("auto explicit falls back to use-case selection", () => {
      const engine = selectEngine(UseCase.FORM_FILL, "auto");
      expect(engine).toBe("playwright");
    });
  });

  describe("isEngineAvailable", () => {
    it("playwright is always available", () => {
      expect(isEngineAvailable("playwright")).toBe(true);
    });

    it("cdp is always available", () => {
      expect(isEngineAvailable("cdp")).toBe(true);
    });

    it("auto is always available", () => {
      expect(isEngineAvailable("auto")).toBe(true);
    });

    it("kernel is explicit-only and available through remote credentials at runtime", () => {
      expect(selectEngine(UseCase.SPA_NAVIGATE)).not.toBe("kernel");
      expect(isEngineAvailable("kernel")).toBe(true);
    });

    it("lightpanda depends on binary", () => {
      const available = isEngineAvailable("lightpanda");
      expect(typeof available).toBe("boolean");
    });
  });

  describe("inferUseCase", () => {
    it("maps scrape to SCRAPE", () => {
      expect(inferUseCase("scrape")).toBe(UseCase.SCRAPE);
    });

    it("maps screenshot to SCREENSHOT", () => {
      expect(inferUseCase("screenshot")).toBe(UseCase.SCREENSHOT);
    });

    it("maps network to NETWORK_MONITOR", () => {
      expect(inferUseCase("network")).toBe(UseCase.NETWORK_MONITOR);
    });

    it("maps har to HAR_CAPTURE", () => {
      expect(inferUseCase("har")).toBe(UseCase.HAR_CAPTURE);
    });

    it("defaults to SPA_NAVIGATE for unknown", () => {
      expect(inferUseCase("unknown-thing")).toBe(UseCase.SPA_NAVIGATE);
    });

    it("is case-insensitive", () => {
      expect(inferUseCase("SCRAPE")).toBe(UseCase.SCRAPE);
    });
  });

  describe("resolveEnginePreference", () => {
    it("prefers explicit non-auto engine over env", () => {
      expect(resolveEnginePreference("playwright", { [OPEN_BROWSER_BACKEND_ENV]: "kernel" })).toBe("playwright");
    });

    it("uses OPEN_BROWSER_BACKEND=kernel when caller leaves engine auto", () => {
      expect(resolveEnginePreference("auto", { [OPEN_BROWSER_BACKEND_ENV]: "kernel" })).toBe("kernel");
      expect(resolveEnginePreference(undefined, { [OPEN_BROWSER_BACKEND_ENV]: "kernel" })).toBe("kernel");
    });

    it("uses OPEN_BROWSER_REMOTE=1 as explicit remote kernel selection", () => {
      expect(resolveEnginePreference("auto", { [OPEN_BROWSER_REMOTE_ENV]: "1" })).toBe("kernel");
    });
  });
});
