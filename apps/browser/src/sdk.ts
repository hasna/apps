import type { Page } from "playwright";
import type {
  PageInfo,
  ScreenshotOptions,
  ScreenshotResult,
  Session,
  SessionOptions,
  VideoRecording,
  VideoRecordingOptions,
  VideoRecordingStatus,
} from "./types/index.js";
import type { VideoRecordingFilter } from "./db/video-recordings.js";
import {
  closeSession as closeBrowserSession,
  createSession as createBrowserSession,
  getSessionPage as getBrowserSessionPage,
  resolveKernelRemoteSessionId,
} from "./lib/session.js";
import {
  click as clickAction,
  fill as fillAction,
  navigate as navigateAction,
  pressKey as pressKeyAction,
  type as typeTextAction,
  waitForSelector as waitForSelectorAction,
} from "./lib/actions.js";
import { getPageInfo as getBrowserPageInfo } from "./lib/extractor.js";
import { takeScreenshot as takeBrowserScreenshot } from "./lib/screenshot.js";
import { listVideoRecordings as listBrowserVideos } from "./db/video-recordings.js";
import {
  captureKernelComputerScreenshotToDownloads,
  deleteKernelBrowser,
  downloadKernelFileToDownloads,
  downloadKernelReplayToDownloads,
  executeKernelPlaywright,
  getKernelFileInfo,
  getKernelStatus,
  listKernelBrowsers,
  listKernelFiles,
  listKernelReplays,
  retrieveKernelBrowser,
  runKernelComputerAction,
  startKernelReplay,
  stopKernelReplay,
} from "./engines/kernel.js";

type StartVideoRecordingFn = (sessionId: string, options?: VideoRecordingOptions) => Promise<VideoRecording>;
type StopVideoRecordingFn = (recordingId: string) => Promise<VideoRecording>;
type ListVideosFn = (filter?: VideoRecordingFilter & { status?: VideoRecordingStatus }) => VideoRecording[];

export interface BrowserSDKSession {
  id: string;
  session: Session;
  page: Page;
}

export type BrowserSDKSessionRef = string | BrowserSDKSession;

export interface BrowserSDKDependencies {
  createSession?: (opts?: SessionOptions) => Promise<{ session: Session; page: Page }>;
  closeSession?: (sessionId: string) => Promise<Session>;
  getSessionPage?: (sessionId: string) => Page;
  getPageInfo?: (page: Page) => Promise<PageInfo>;
  navigate?: (page: Page, url: string, timeout?: number) => Promise<void>;
  click?: typeof clickAction;
  typeText?: typeof typeTextAction;
  fill?: typeof fillAction;
  pressKey?: typeof pressKeyAction;
  waitForSelector?: typeof waitForSelectorAction;
  takeScreenshot?: typeof takeBrowserScreenshot;
  startVideoRecording?: StartVideoRecordingFn;
  stopVideoRecording?: StopVideoRecordingFn;
  listVideos?: ListVideosFn;
}

export interface BrowserSDKOptions {
  dependencies?: BrowserSDKDependencies;
}

export type BrowserSDKStep =
  | { type: "navigate"; url: string; timeout?: number }
  | { type: "click"; selector: string; timeout?: number; selfHeal?: boolean }
  | { type: "fill"; selector: string; value: string; timeout?: number; selfHeal?: boolean }
  | { type: "type"; selector: string; text: string; timeout?: number; clear?: boolean; selfHeal?: boolean }
  | { type: "press"; key: string }
  | { type: "wait"; selector: string; timeout?: number; state?: "attached" | "detached" | "visible" | "hidden" }
  | { type: "screenshot"; options?: ScreenshotOptions }
  | { type: "pageInfo" };

export interface BrowserSDKStepResult {
  type: BrowserSDKStep["type"];
  ok: true;
  info?: PageInfo;
  screenshot?: ScreenshotResult;
}

export interface BrowserSDKRunOptions {
  session?: BrowserSDKSessionRef;
  sessionOptions?: SessionOptions;
  steps: BrowserSDKStep[];
  autoClose?: boolean;
}

export interface BrowserSDKRunResult {
  session: Session;
  pageInfo: PageInfo;
  steps: BrowserSDKStepResult[];
}

type RequiredBrowserSDKDependencies = Required<BrowserSDKDependencies>;

function buildDependencies(input?: BrowserSDKDependencies): RequiredBrowserSDKDependencies {
  return {
    createSession: input?.createSession ?? createBrowserSession,
    closeSession: input?.closeSession ?? closeBrowserSession,
    getSessionPage: input?.getSessionPage ?? getBrowserSessionPage,
    getPageInfo: input?.getPageInfo ?? getBrowserPageInfo,
    navigate: input?.navigate ?? navigateAction,
    click: input?.click ?? clickAction,
    typeText: input?.typeText ?? typeTextAction,
    fill: input?.fill ?? fillAction,
    pressKey: input?.pressKey ?? pressKeyAction,
    waitForSelector: input?.waitForSelector ?? waitForSelectorAction,
    takeScreenshot: input?.takeScreenshot ?? takeBrowserScreenshot,
    startVideoRecording: input?.startVideoRecording ?? (async (sessionId, options) => {
      const mod = await import("./lib/video-recording.js");
      return mod.startVideoRecording(sessionId, options);
    }),
    stopVideoRecording: input?.stopVideoRecording ?? (async (recordingId) => {
      const mod = await import("./lib/video-recording.js");
      return mod.stopVideoRecording(recordingId);
    }),
    listVideos: input?.listVideos ?? listBrowserVideos,
  };
}

export class BrowserSDK {
  private readonly deps: RequiredBrowserSDKDependencies;
  private readonly sessions = new Map<string, BrowserSDKSession>();

  constructor(options: BrowserSDKOptions = {}) {
    this.deps = buildDependencies(options.dependencies);
  }

  async open(options: SessionOptions = {}): Promise<BrowserSDKSession> {
    const { session, page } = await this.deps.createSession(options);
    const handle = { id: session.id, session, page };
    this.sessions.set(handle.id, handle);
    return handle;
  }

  async createSession(options: SessionOptions = {}): Promise<BrowserSDKSession> {
    return this.open(options);
  }

  getPage(ref: BrowserSDKSessionRef): Page {
    if (typeof ref !== "string") return ref.page;
    return this.sessions.get(ref)?.page ?? this.deps.getSessionPage(ref);
  }

  async pageInfo(ref: BrowserSDKSessionRef): Promise<PageInfo> {
    return this.deps.getPageInfo(this.getPage(ref));
  }

  async navigate(ref: BrowserSDKSessionRef, url: string, opts?: { timeout?: number }): Promise<PageInfo> {
    await this.deps.navigate(this.getPage(ref), url, opts?.timeout);
    return this.pageInfo(ref);
  }

  async click(ref: BrowserSDKSessionRef, selector: string, opts?: { timeout?: number; selfHeal?: boolean }): ReturnType<typeof clickAction> {
    return this.deps.click(this.getPage(ref), selector, {
      timeout: opts?.timeout,
      selfHeal: opts?.selfHeal,
    });
  }

  async fill(ref: BrowserSDKSessionRef, selector: string, value: string, opts?: { timeout?: number; selfHeal?: boolean }): ReturnType<typeof fillAction> {
    return this.deps.fill(this.getPage(ref), selector, value, opts?.timeout, opts?.selfHeal);
  }

  async type(ref: BrowserSDKSessionRef, selector: string, text: string, opts?: { timeout?: number; clear?: boolean; selfHeal?: boolean }): ReturnType<typeof typeTextAction> {
    return this.deps.typeText(this.getPage(ref), selector, text, {
      timeout: opts?.timeout,
      clear: opts?.clear,
      selfHeal: opts?.selfHeal,
    });
  }

  async pressKey(ref: BrowserSDKSessionRef, key: string): ReturnType<typeof pressKeyAction> {
    return this.deps.pressKey(this.getPage(ref), key);
  }

  async waitForSelector(ref: BrowserSDKSessionRef, selector: string, opts?: { timeout?: number; state?: "attached" | "detached" | "visible" | "hidden" }): ReturnType<typeof waitForSelectorAction> {
    return this.deps.waitForSelector(this.getPage(ref), selector, opts);
  }

  async screenshot(ref: BrowserSDKSessionRef, options?: ScreenshotOptions): Promise<ScreenshotResult> {
    const sessionId = typeof ref === "string" ? ref : ref.id;
    return this.deps.takeScreenshot(this.getPage(ref), {
      ...options,
      sessionId,
    });
  }

  async startVideo(ref: BrowserSDKSessionRef, options?: VideoRecordingOptions): Promise<VideoRecording> {
    const sessionId = typeof ref === "string" ? ref : ref.id;
    const recording = await this.deps.startVideoRecording(sessionId, options);
    const cached = this.sessions.get(sessionId);
    if (cached) cached.page = this.deps.getSessionPage(sessionId);
    if (typeof ref !== "string") ref.page = this.deps.getSessionPage(sessionId);
    return recording;
  }

  async stopVideo(recordingId: string): Promise<VideoRecording> {
    const recording = await this.deps.stopVideoRecording(recordingId);
    if (recording.session_id) {
      const cached = this.sessions.get(recording.session_id);
      if (cached) cached.page = this.deps.getSessionPage(recording.session_id);
    }
    return recording;
  }

  listVideos(filter?: VideoRecordingFilter & { status?: VideoRecordingStatus }): VideoRecording[] {
    return this.deps.listVideos(filter);
  }

  async kernelStatus(options?: { remote?: boolean; limit?: number }) {
    return getKernelStatus({ checkRemote: options?.remote, listLimit: options?.limit });
  }

  async kernelSessions(options?: { status?: string; limit?: number }) {
    return listKernelBrowsers(options);
  }

  async kernelSession(ref: BrowserSDKSessionRef) {
    return retrieveKernelBrowser(this.kernelRemoteId(ref));
  }

  async closeKernel(ref: BrowserSDKSessionRef) {
    return deleteKernelBrowser(this.kernelRemoteId(ref));
  }

  async kernelFiles(ref: BrowserSDKSessionRef, path = "/") {
    return listKernelFiles(this.kernelRemoteId(ref), path);
  }

  async kernelFileInfo(ref: BrowserSDKSessionRef, path: string) {
    return getKernelFileInfo(this.kernelRemoteId(ref), path);
  }

  async downloadKernelFile(ref: BrowserSDKSessionRef, path: string, opts?: { filename?: string; localSessionId?: string }) {
    return downloadKernelFileToDownloads(this.kernelRemoteId(ref), path, {
      filename: opts?.filename,
      localSessionId: opts?.localSessionId ?? this.localSessionId(ref),
    });
  }

  async executeKernel(ref: BrowserSDKSessionRef, code: string, opts?: { timeoutSec?: number }) {
    return executeKernelPlaywright(this.kernelRemoteId(ref), code, { timeoutSec: opts?.timeoutSec });
  }

  async kernelComputerScreenshot(ref: BrowserSDKSessionRef, opts?: { filename?: string; region?: { x: number; y: number; width: number; height: number } }) {
    return captureKernelComputerScreenshotToDownloads(this.kernelRemoteId(ref), {
      filename: opts?.filename,
      region: opts?.region,
      localSessionId: this.localSessionId(ref),
    });
  }

  async kernelComputerAction(ref: BrowserSDKSessionRef, action: "click" | "move" | "type" | "press" | "scroll" | "batch", params: Record<string, unknown>) {
    return runKernelComputerAction(this.kernelRemoteId(ref), action, params);
  }

  async kernelReplays(ref: BrowserSDKSessionRef) {
    return listKernelReplays(this.kernelRemoteId(ref));
  }

  async startKernelReplay(ref: BrowserSDKSessionRef, opts?: { framerate?: number; maxDurationSeconds?: number; recordAudio?: boolean }) {
    return startKernelReplay(this.kernelRemoteId(ref), opts);
  }

  async stopKernelReplay(ref: BrowserSDKSessionRef, replayId: string) {
    return stopKernelReplay(this.kernelRemoteId(ref), replayId);
  }

  async downloadKernelReplay(ref: BrowserSDKSessionRef, replayId: string, opts?: { filename?: string; localSessionId?: string }) {
    return downloadKernelReplayToDownloads(this.kernelRemoteId(ref), replayId, {
      filename: opts?.filename,
      localSessionId: opts?.localSessionId ?? this.localSessionId(ref),
    });
  }

  async close(ref: BrowserSDKSessionRef): Promise<Session> {
    const sessionId = typeof ref === "string" ? ref : ref.id;
    this.sessions.delete(sessionId);
    return this.deps.closeSession(sessionId);
  }

  async run(options: BrowserSDKRunOptions): Promise<BrowserSDKRunResult> {
    const ownsSession = !options.session;
    const handle = options.session
      ? this.resolveHandle(options.session)
      : await this.open(options.sessionOptions);
    const stepResults: BrowserSDKStepResult[] = [];

    try {
      for (const step of options.steps) {
        stepResults.push(await this.runStep(handle, step));
      }

      return {
        session: handle.session,
        pageInfo: await this.pageInfo(handle),
        steps: stepResults,
      };
    } finally {
      const shouldClose = options.autoClose ?? ownsSession;
      if (shouldClose) {
        await this.close(handle);
      }
    }
  }

  private resolveHandle(ref: BrowserSDKSessionRef): BrowserSDKSession {
    if (typeof ref !== "string") return ref;
    const cached = this.sessions.get(ref);
    if (cached) return cached;
    return {
      id: ref,
      session: {
        id: ref,
        engine: "playwright",
        status: "active",
        created_at: new Date(0).toISOString(),
      },
      page: this.deps.getSessionPage(ref),
    };
  }

  private localSessionId(ref: BrowserSDKSessionRef): string | undefined {
    return typeof ref === "string" ? ref : ref.id;
  }

  private kernelRemoteId(ref: BrowserSDKSessionRef): string {
    if (typeof ref !== "string") {
      return ref.session.remote_session_id ?? ref.session.id;
    }
    const cached = this.sessions.get(ref);
    if (cached?.session.remote_session_id) return cached.session.remote_session_id;
    return resolveKernelRemoteSessionId(ref);
  }

  private async runStep(handle: BrowserSDKSession, step: BrowserSDKStep): Promise<BrowserSDKStepResult> {
    switch (step.type) {
      case "navigate":
        await this.navigate(handle, step.url, { timeout: step.timeout });
        return { type: step.type, ok: true };
      case "click":
        await this.click(handle, step.selector, { timeout: step.timeout, selfHeal: step.selfHeal });
        return { type: step.type, ok: true };
      case "fill":
        await this.fill(handle, step.selector, step.value, { timeout: step.timeout, selfHeal: step.selfHeal });
        return { type: step.type, ok: true };
      case "type":
        await this.type(handle, step.selector, step.text, {
          timeout: step.timeout,
          clear: step.clear,
          selfHeal: step.selfHeal,
        });
        return { type: step.type, ok: true };
      case "press":
        await this.pressKey(handle, step.key);
        return { type: step.type, ok: true };
      case "wait":
        await this.waitForSelector(handle, step.selector, {
          timeout: step.timeout,
          state: step.state,
        });
        return { type: step.type, ok: true };
      case "screenshot":
        return {
          type: step.type,
          ok: true,
          screenshot: await this.screenshot(handle, step.options),
        };
      case "pageInfo":
        return {
          type: step.type,
          ok: true,
          info: await this.pageInfo(handle),
        };
    }
  }
}

export function createBrowserSDK(options?: BrowserSDKOptions): BrowserSDK {
  return new BrowserSDK(options);
}
