import { executeDomJob } from "./executor";
import type { ExtBridgeMessage, ExtJob, ExtResult, ExtensionStorageState } from "./protocol";

const KEEPALIVE_MS = 20_000;
const ALARM_NAME = "hasna-browser-bridge";
const DEFAULT_SERVER_URL = "ws://127.0.0.1:7030";

let socket: WebSocket | null = null;
let keepaliveTimer: ReturnType<typeof setInterval> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelayMs = 1_000;
let connecting = false;

function toWebSocketUrl(serverUrl: string): string {
  const trimmed = serverUrl.replace(/\/+$/, "");
  if (trimmed.startsWith("ws://") || trimmed.startsWith("wss://")) return trimmed;
  if (trimmed.startsWith("https://")) return `wss://${trimmed.slice("https://".length)}`;
  if (trimmed.startsWith("http://")) return `ws://${trimmed.slice("http://".length)}`;
  return trimmed;
}

async function getState(): Promise<ExtensionStorageState> {
  return chrome.storage.local.get<ExtensionStorageState>(null);
}

async function setStatus(status: ExtensionStorageState["status"], lastError?: string): Promise<void> {
  await chrome.storage.local.set({
    status,
    lastError: lastError ?? "",
    lastSeenAt: new Date().toISOString(),
  });
  await chrome.action.setBadgeText({ text: status === "connected" ? "ON" : "" });
  await chrome.action.setBadgeBackgroundColor({ color: status === "connected" ? "#16833a" : "#9a3412" });
}

function clearKeepalive(): void {
  if (keepaliveTimer) clearInterval(keepaliveTimer);
  keepaliveTimer = null;
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void connect();
  }, reconnectDelayMs);
  reconnectDelayMs = Math.min(reconnectDelayMs * 2, 30_000);
}

function stopSocket(): void {
  clearKeepalive();
  if (socket) {
    try { socket.close(); } catch {}
    socket = null;
  }
}

function socketReady(): boolean {
  return Boolean(socket && socket.readyState === WebSocket.OPEN);
}

function send(message: ExtBridgeMessage): void {
  if (!socketReady()) throw new Error("Extension bridge WebSocket is not connected");
  socket!.send(JSON.stringify(message));
}

async function activeTab(url?: string): Promise<chrome.tabs.Tab> {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const current = tabs.find((tab) => typeof tab.id === "number");
  if (current) return current;
  return chrome.tabs.create({ url: url ?? "about:blank", active: true });
}

async function waitForTabComplete(tabId: number, timeoutMs: number): Promise<chrome.tabs.Tab> {
  const existing = await chrome.tabs.get(tabId);
  if (existing.status === "complete") return existing;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error(`Timed out waiting for tab ${tabId} to finish loading`));
    }, timeoutMs);

    const listener = (updatedTabId: number, changeInfo: { status?: string }, tab: chrome.tabs.Tab) => {
      if (updatedTabId !== tabId || changeInfo.status !== "complete") return;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(tab);
    };

    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function executeScriptJob<T = unknown>(tabId: number, job: ExtJob): Promise<T> {
  const result = await chrome.scripting.executeScript<T>({
    target: { tabId },
    func: executeDomJob as (...args: unknown[]) => T | Promise<T>,
    args: [job],
  });
  return result[0]?.result as T;
}

function dataUrlToBase64(dataUrl: string): string {
  const index = dataUrl.indexOf(",");
  return index >= 0 ? dataUrl.slice(index + 1) : dataUrl;
}

async function executeJob(job: ExtJob): Promise<ExtResult> {
  const logs: string[] = [`${new Date().toISOString()} ${job.type}`];
  try {
    let tab = await activeTab(job.type === "navigate" && "payload" in job ? (job.payload as { url?: string }).url : undefined);
    if (typeof tab.id !== "number") throw new Error("No active tab available");

    let data: unknown;
    let screenshot: string | undefined;

    if (job.type === "navigate") {
      const url = job.payload.url;
      tab = await chrome.tabs.update(tab.id, { url, active: true });
      tab = await waitForTabComplete(tab.id!, job.timeout_ms ?? 30_000);
      data = { url: tab.url ?? url, title: tab.title ?? "" };
    } else if (job.type === "screenshot") {
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
      screenshot = dataUrlToBase64(dataUrl);
      data = { captured: true };
    } else {
      data = await executeScriptJob(tab.id, job);
      tab = await chrome.tabs.get(tab.id);
    }

    return {
      id: job.id,
      ok: true,
      data,
      screenshot,
      url: tab.url,
      title: tab.title,
      tab_id: tab.id,
      logs,
    };
  } catch (error) {
    const tab = await activeTab().catch(() => null);
    return {
      id: job.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      url: tab?.url,
      title: tab?.title,
      tab_id: tab?.id,
      logs,
    };
  }
}

async function handleMessage(raw: MessageEvent<string>): Promise<void> {
  let message: ExtBridgeMessage;
  try {
    message = JSON.parse(raw.data) as ExtBridgeMessage;
  } catch {
    return;
  }

  if (message.type === "paired") {
    await chrome.storage.local.set({ token: message.token, code: "", status: "connected" });
    await setStatus("connected");
    return;
  }
  if (message.type === "connected") {
    await setStatus("connected");
    return;
  }
  if (message.type === "ping") {
    send({ type: "pong", at: Date.now() });
    return;
  }
  if (message.type !== "job") return;

  const result = await executeJob(message.job);
  send({ type: "result", result });
}

async function connect(): Promise<void> {
  if (connecting || socketReady()) return;
  connecting = true;
  try {
    const state = await getState();
    const serverUrl = state.serverUrl ?? DEFAULT_SERVER_URL;
    const base = `${toWebSocketUrl(serverUrl)}/extension/ws`;
    const params = new URLSearchParams();
    if (state.token) params.set("token", state.token);
    else if (state.code) params.set("code", state.code);
    else return;
    if (state.name) params.set("name", state.name);

    stopSocket();
    await setStatus(state.token ? "disconnected" : "pairing");

    socket = new WebSocket(`${base}?${params.toString()}`);
    socket.onopen = () => {
      reconnectDelayMs = 1_000;
      clearKeepalive();
      keepaliveTimer = setInterval(() => {
        if (!socketReady()) return;
        try { send({ type: "ping", at: Date.now() }); } catch {}
      }, KEEPALIVE_MS);
      void setStatus("connected");
    };
    socket.onmessage = (event) => { void handleMessage(event as MessageEvent<string>); };
    socket.onerror = () => { void setStatus("error", "WebSocket error"); };
    socket.onclose = () => {
      clearKeepalive();
      socket = null;
      void setStatus("disconnected");
      scheduleReconnect();
    };
  } finally {
    connecting = false;
  }
}

async function pair(serverUrl: string, code: string, name?: string): Promise<ExtensionStorageState> {
  stopSocket();
  await chrome.storage.local.set({
    serverUrl: toWebSocketUrl(serverUrl || DEFAULT_SERVER_URL),
    code: code.trim(),
    name: name?.trim() || "Chrome",
    token: "",
    status: "pairing",
    lastError: "",
  });
  await connect();
  return getState();
}

async function unpair(): Promise<ExtensionStorageState> {
  stopSocket();
  await chrome.storage.local.remove(["token", "code"]);
  await setStatus("idle");
  return getState();
}

chrome.runtime.onInstalled.addListener(() => {
  void chrome.alarms.create(ALARM_NAME, { delayInMinutes: 1, periodInMinutes: 1 });
  void connect();
});

chrome.runtime.onStartup.addListener(() => {
  void chrome.alarms.create(ALARM_NAME, { delayInMinutes: 1, periodInMinutes: 1 });
  void connect();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) void connect();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const msg = message as { type?: string; serverUrl?: string; code?: string; name?: string };
  if (msg.type === "STATUS") {
    getState().then(sendResponse);
    return true;
  }
  if (msg.type === "PAIR") {
    pair(msg.serverUrl ?? DEFAULT_SERVER_URL, msg.code ?? "", msg.name).then(sendResponse);
    return true;
  }
  if (msg.type === "UNPAIR") {
    unpair().then(sendResponse);
    return true;
  }
  return false;
});

void chrome.alarms.create(ALARM_NAME, { delayInMinutes: 1, periodInMinutes: 1 });
void connect();
