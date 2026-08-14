// Session recording types

export type EntryType = "navigation" | "console" | "error" | "snapshot" | "network";

export interface NavigationEntry {
  type: "navigation";
  url: string;
  referrer: string;
  timestamp: string;
  transition: string;
  tabId: number;
}

export interface ConsoleEntry {
  type: "console";
  level: "log" | "warn" | "error" | "info" | "debug";
  messages: string[];
  timestamp: string;
  stack?: string;
  url: string;
  tabId: number;
}

export interface ErrorEntry {
  type: "error";
  message: string;
  stack: string;
  timestamp: string;
  url: string;
  tabId: number;
  screenshotDataUrl?: string; // base64 PNG
}

export interface NetworkEntry {
  type: "network";
  method: string;
  url: string;
  status: number;
  statusText: string;
  timestamp: string;
  durationMs?: number;
  tabId: number;
}

export type SessionEntry = NavigationEntry | ConsoleEntry | ErrorEntry | NetworkEntry;

export interface SessionRecord {
  sessionId: string;
  tabId: number;
  startTime: string;
  endTime?: string;
  status: "live" | "saved" | "exported";
  entries: SessionEntry[];
}

export interface ExtensionMessage {
  type: "console" | "error" | "navigation" | "network" | "screenshot" | "start-recording" | "stop-recording" | "get-status";
  payload: any;
  tabId?: number;
}
