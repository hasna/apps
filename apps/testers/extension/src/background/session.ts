// Background service worker for Testers Session Recorder.
// Manages session lifecycle: tracks navigations, receives console/error events
// from content scripts, captures screenshots on errors, and persists sessions.

import type { SessionEntry, SessionRecord, NavigationEntry, ConsoleEntry, ErrorEntry } from "../../types/index.js";

// ─── Session State ───────────────────────────────────────────────────────────

const sessions = new Map<number, SessionRecord>(); // tabId -> SessionRecord
let recordingEnabled = true;

function getOrCreateSession(tabId: number): SessionRecord {
  if (!sessions.has(tabId)) {
    sessions.set(tabId, {
      sessionId: crypto.randomUUID(),
      tabId,
      startTime: new Date().toISOString(),
      status: "live",
      entries: [],
    });
  }
  return sessions.get(tabId)!;
}

function addEntry(tabId: number, entry: SessionEntry) {
  if (!recordingEnabled) return;
  const session = getOrCreateSession(tabId);
  session.entries.push(entry);

  // Cap entries at 10k per session to avoid memory issues
  if (session.entries.length > 10000) {
    session.entries = session.entries.slice(-8000);
  }
}

// ─── Navigation Tracking ─────────────────────────────────────────────────────

chrome.webNavigation.onCommitted.addListener((details) => {
  // Only track main frame navigations
  if (details.frameId !== 0) return;

  const entry: NavigationEntry = {
    type: "navigation",
    url: details.url,
    referrer: "", // not available in onCommitted
    timestamp: new Date().toISOString(),
    transition: details.transitionType,
    tabId: details.tabId,
  };

  addEntry(details.tabId, entry);

  // Update badge to show recording state
  updateBadge(details.tabId);
});

// Track referrer via onBeforeNavigate
const navCache = new Map<number, string>(); // tabId -> last URL
chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId !== 0) return;
  navCache.set(details.tabId, details.url);
});

chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) return;
  const referrer = navCache.get(details.tabId);
  if (referrer) {
    // Patch the last entry with referrer
    const session = sessions.get(details.tabId);
    if (session && session.entries.length > 0) {
      const last = session.entries[session.entries.length - 1];
      if (last.type === "navigation") {
        (last as NavigationEntry).referrer = referrer;
      }
    }
  }
});

// ─── Console Messages from Content Scripts ───────────────────────────────────

chrome.runtime.onMessage.addListener((message: any, sender: chrome.runtime.MessageSender, sendResponse) => {
  const tabId = sender.tab?.id;
  if (!tabId) return;

  switch (message.type) {
    case "console-batch": {
      const { entries } = message.payload;
      const url = message.payload.url || sender.tab?.url || "";
      for (const entry of entries) {
        addEntry(tabId, {
          type: "console",
          level: entry.level,
          messages: entry.messages,
          timestamp: entry.timestamp,
          stack: entry.stack,
          url,
          tabId,
        } as ConsoleEntry);
      }
      break;
    }

    case "error": {
      const { message: errorMsg, stack, timestamp } = message.payload;

      // Capture screenshot for errors
      chrome.tabs.captureVisibleTab(
        sender.tab!.windowId!,
        { format: "png" },
        (dataUrl) => {
          addEntry(tabId, {
            type: "error",
            message: errorMsg,
            stack,
            timestamp,
            url: sender.tab?.url || "",
            tabId,
            screenshotDataUrl: chrome.runtime.lastError ? undefined : dataUrl,
          } as ErrorEntry);
        }
      );
      break;
    }

    case "get-status": {
      const session = sessions.get(tabId);
      sendResponse({
        recording: recordingEnabled,
        sessionId: session?.sessionId,
        entryCount: session?.entries.length ?? 0,
      });
      return true; // keep channel open for async response
    }
  }
});

// ─── Tab Lifecycle ───────────────────────────────────────────────────────────

chrome.tabs.onRemoved.addListener((tabId) => {
  const session = sessions.get(tabId);
  if (session) {
    session.endTime = new Date().toISOString();
    session.status = "saved";
    persistSession(session);
  }
});

// ─── Badge Updates ───────────────────────────────────────────────────────────

function updateBadge(tabId: number) {
  const session = sessions.get(tabId);
  if (!session || !recordingEnabled) {
    chrome.action.setBadgeText({ text: "", tabId });
    return;
  }

  const count = session.entries.length;
  chrome.action.setBadgeText({
    text: count > 999 ? "999+" : count.toString(),
    tabId,
  });
  chrome.action.setBadgeBackgroundColor({ color: "#4CAF50", tabId });
}

// ─── Session Persistence ─────────────────────────────────────────────────────

async function persistSession(session: SessionRecord) {
  // Store in chrome.storage.local (with size management)
  const key = `session:${session.sessionId}`;
  const data = {
    ...session,
    entries: session.entries.map(e => {
      // Strip large screenshot data from storage, keep in memory
      const { screenshotDataUrl, ...rest } = e as any;
      return screenshotDataUrl ? { ...rest, hasScreenshot: true } : rest;
    }),
  };

  try {
    await chrome.storage.local.set({ [key]: data });

    // Also keep a list of session IDs for easy listing
    const ids = (await chrome.storage.local.get("sessionIds")).sessionIds || [];
    if (!ids.includes(session.sessionId)) {
      ids.push(session.sessionId);
      await chrome.storage.local.set({ sessionIds: ids });
    }
  } catch (err) {
    console.error("Failed to persist session:", err);
  }
}

// ─── Export Session ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message: any, sender, sendResponse) => {
  if (message.type === "export-session") {
    const session = sessions.get(message.tabId);
    if (session) {
      sendResponse(session);
    } else {
      // Try from storage
      const key = `session:${message.sessionId}`;
      chrome.storage.local.get([key], (result) => {
        sendResponse(result[key] || null);
      });
    }
    return true;
  }

  if (message.type === "list-sessions") {
    chrome.storage.local.get(["sessionIds"], (result) => {
      sendResponse(result.sessionIds || []);
    });
    return true;
  }

  if (message.type === "get-errors") {
    const session = sessions.get(message.tabId);
    if (!session) {
      sendResponse({ errors: [] });
      return;
    }
    const errors = session.entries.filter(e => e.type === "error");
    sendResponse({ errors });
    return;
  }

  if (message.type === "clear-session") {
    const tabId = message.tabId ?? sender.tab?.id;
    if (tabId) {
      sessions.delete(tabId);
      chrome.action.setBadgeText({ text: "", tabId });
      sendResponse({ cleared: true });
    } else {
      sendResponse({ cleared: false });
    }
    return;
  }
});

// ─── Init ────────────────────────────────────────────────────────────────────

// Restore badge on existing tabs when service worker wakes up
chrome.tabs.query({}, (tabs) => {
  for (const tab of tabs) {
    if (tab.id) updateBadge(tab.id);
  }
});
