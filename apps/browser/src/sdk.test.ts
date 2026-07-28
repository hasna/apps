import { describe, expect, it } from "bun:test";
import type { Page } from "playwright";
import { BrowserSDK, createBrowserSDK, type BrowserSDKDependencies } from "./sdk.js";
import type { PageInfo, Session, VideoRecording } from "./types/index.js";

function createFakePage(urlRef: { current: string }): Page {
  return {
    url: () => urlRef.current,
    title: async () => "Fake page",
    viewportSize: () => ({ width: 1280, height: 720 }),
    evaluate: async () => ({
      links_count: 0,
      images_count: 0,
      forms_count: 0,
      text_length: 9,
    }),
  } as unknown as Page;
}

function createDeps() {
  const calls: string[] = [];
  const urlRef = { current: "about:blank" };
  const page = createFakePage(urlRef);
  const session: Session = {
    id: "session-1",
    engine: "playwright",
    status: "active",
    created_at: "2026-01-01T00:00:00.000Z",
  };

  const pageInfo = async (): Promise<PageInfo> => ({
    url: urlRef.current,
    title: "Fake page",
    links_count: 0,
    images_count: 0,
    forms_count: 0,
    text_length: 9,
    has_console_errors: false,
    viewport: { width: 1280, height: 720 },
  });

  const videoRecording = (): VideoRecording => ({
    id: "video-1",
    session_id: session.id,
    name: "sdk-video",
    status: "recording",
    format: "webm",
    width: 1280,
    height: 720,
    started_at: "2026-01-01T00:00:00.000Z",
  });

  const deps = {
    createSession: async () => {
      calls.push("createSession");
      return { session, page };
    },
    closeSession: async (sessionId: string) => {
      calls.push(`closeSession:${sessionId}`);
      return { ...session, status: "closed" as const };
    },
    getSessionPage: () => page,
    getPageInfo: pageInfo,
    navigate: async (_page: Page, url: string) => {
      calls.push(`navigate:${url}`);
      urlRef.current = url;
    },
    click: async (_page: Page, selector: string) => {
      calls.push(`click:${selector}`);
      return {};
    },
    typeText: async (_page: Page, selector: string, text: string) => {
      calls.push(`type:${selector}:${text}`);
      return {};
    },
    fill: async (_page: Page, selector: string, value: string) => {
      calls.push(`fill:${selector}:${value}`);
      return {};
    },
    pressKey: async (_page: Page, key: string) => {
      calls.push(`press:${key}`);
    },
    waitForSelector: async (_page: Page, selector: string) => {
      calls.push(`wait:${selector}`);
    },
    takeScreenshot: async () => {
      calls.push("screenshot");
      return {
        path: "/tmp/screenshot.webp",
        base64: "abc",
        width: 1280,
        height: 720,
        size_bytes: 3,
        original_size_bytes: 3,
        compressed_size_bytes: 3,
        compression_ratio: 1,
      };
    },
    startVideoRecording: async (sessionId: string) => {
      calls.push(`startVideo:${sessionId}`);
      return videoRecording();
    },
    stopVideoRecording: async (recordingId: string) => {
      calls.push(`stopVideo:${recordingId}`);
      return {
        ...videoRecording(),
        id: recordingId,
        status: "completed" as const,
        path: "/tmp/sdk-video.webm",
        size_bytes: 2048,
        duration_ms: 1000,
        stopped_at: "2026-01-01T00:00:01.000Z",
      };
    },
    listVideos: () => {
      calls.push("listVideos");
      return [videoRecording()];
    },
  } satisfies BrowserSDKDependencies;

  return { calls, deps };
}

describe("BrowserSDK", () => {
  it("opens sessions and exposes page info through a package-level facade", async () => {
    const { calls, deps } = createDeps();
    const sdk = new BrowserSDK({ dependencies: deps });

    const handle = await sdk.open({ startUrl: "about:blank" });
    const info = await sdk.navigate(handle, "https://example.com/dashboard");

    expect(handle.id).toBe("session-1");
    expect(info.url).toBe("https://example.com/dashboard");
    expect(calls).toEqual(["createSession", "navigate:https://example.com/dashboard"]);
  });

  it("runs ordered SDK steps and auto-closes sessions it owns", async () => {
    const { calls, deps } = createDeps();
    const sdk = createBrowserSDK({ dependencies: deps });

    const result = await sdk.run({
      sessionOptions: { headless: true },
      steps: [
        { type: "navigate", url: "https://example.com/login" },
        { type: "fill", selector: "#email", value: "user@example.com" },
        { type: "type", selector: "#password", text: "secret" },
        { type: "click", selector: "button[type=submit]" },
        { type: "press", key: "Enter" },
        { type: "wait", selector: "[data-ready=true]" },
        { type: "screenshot" },
      ],
    });

    expect(result.session.id).toBe("session-1");
    expect(result.pageInfo.url).toBe("https://example.com/login");
    expect(result.steps.map((step) => step.type)).toEqual([
      "navigate",
      "fill",
      "type",
      "click",
      "press",
      "wait",
      "screenshot",
    ]);
    expect(calls).toEqual([
      "createSession",
      "navigate:https://example.com/login",
      "fill:#email:user@example.com",
      "type:#password:secret",
      "click:button[type=submit]",
      "press:Enter",
      "wait:[data-ready=true]",
      "screenshot",
      "closeSession:session-1",
    ]);
  });

  it("can keep owned sessions open for callers that need reuse", async () => {
    const { calls, deps } = createDeps();
    const sdk = createBrowserSDK({ dependencies: deps });

    await sdk.run({
      autoClose: false,
      steps: [{ type: "navigate", url: "https://example.com" }],
    });

    expect(calls).not.toContain("closeSession:session-1");
  });

  it("starts, stops, and lists video recordings", async () => {
    const { calls, deps } = createDeps();
    const sdk = createBrowserSDK({ dependencies: deps });
    const handle = await sdk.open();

    const started = await sdk.startVideo(handle, { quality: "high" });
    const stopped = await sdk.stopVideo(started.id);
    const videos = sdk.listVideos();

    expect(started.status).toBe("recording");
    expect(stopped.status).toBe("completed");
    expect(videos).toHaveLength(1);
    expect(calls).toContain("startVideo:session-1");
    expect(calls).toContain("stopVideo:video-1");
    expect(calls).toContain("listVideos");
  });

  it("exposes Kernel helpers through the SDK facade", async () => {
    const {
      setKernelClientFactoryForTests,
      setKernelSecretsProviderForTests,
    } = await import("./engines/kernel.js");
    setKernelSecretsProviderForTests({
      async getSecretValue(key) {
        return key.includes("kernel_api_key") ? "kernel-test-key" : undefined;
      },
      async matchVaultItemsForUrl() {
        return [];
      },
      async getVaultItem() {
        return undefined;
      },
    });
    setKernelClientFactoryForTests(() => ({
      browsers: {
        async create() {
          throw new Error("not used");
        },
        async deleteByID() {},
        async list() {
          return { items: [{ session_id: "remote-sdk", cdp_ws_url: "wss://kernel.test/cdp?jwt=secret" }] };
        },
        playwright: {
          async execute() {
            return { success: true, result: "ok" };
          },
        },
      },
    }));

    try {
      const sdk = createBrowserSDK();
      const sessions = await sdk.kernelSessions();
      const result = await sdk.executeKernel("remote-sdk", "return 'ok';");

      expect(sessions[0].session_id).toBe("remote-sdk");
      expect(sessions[0].close_id).toBe("remote-sdk");
      expect(result).toEqual({ success: true, exec_id: "remote-sdk", result: "ok" });
      expect(JSON.stringify(sessions)).not.toContain("jwt=secret");
    } finally {
      setKernelClientFactoryForTests(undefined);
      setKernelSecretsProviderForTests(undefined);
    }
  });
});
