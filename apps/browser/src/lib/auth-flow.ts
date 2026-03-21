/**
 * Auth flow recording — record a login flow once, auto-replay when auth expires.
 * Combines the recording system with storage-state persistence.
 */

import { randomUUID } from "node:crypto";
import { getDatabase } from "../db/schema.js";
import type { Page } from "playwright";

export interface AuthFlow {
  id: string;
  name: string;
  domain: string;
  recording_id: string | null;
  storage_state_path: string | null;
  created_at: string;
  last_used: string | null;
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

export function saveAuthFlow(data: { name: string; domain: string; recordingId?: string; storageStatePath?: string }): AuthFlow {
  const db = getDatabase();
  const id = randomUUID();
  db.prepare(
    "INSERT OR REPLACE INTO auth_flows (id, name, domain, recording_id, storage_state_path) VALUES (?, ?, ?, ?, ?)"
  ).run(id, data.name, data.domain, data.recordingId ?? null, data.storageStatePath ?? null);
  return getAuthFlow(id)!;
}

export function getAuthFlow(id: string): AuthFlow | null {
  const db = getDatabase();
  return db.query<AuthFlow, string>("SELECT * FROM auth_flows WHERE id = ?").get(id) ?? null;
}

export function getAuthFlowByName(name: string): AuthFlow | null {
  const db = getDatabase();
  return db.query<AuthFlow, string>("SELECT * FROM auth_flows WHERE name = ?").get(name) ?? null;
}

export function getAuthFlowByDomain(domain: string): AuthFlow | null {
  const db = getDatabase();
  return db.query<AuthFlow, string>("SELECT * FROM auth_flows WHERE domain = ? ORDER BY last_used DESC LIMIT 1").get(domain) ?? null;
}

export function listAuthFlows(): AuthFlow[] {
  const db = getDatabase();
  return db.query<AuthFlow, []>("SELECT * FROM auth_flows ORDER BY last_used DESC, created_at DESC").all();
}

export function deleteAuthFlow(name: string): boolean {
  const db = getDatabase();
  const result = db.prepare("DELETE FROM auth_flows WHERE name = ?").run(name);
  return result.changes > 0;
}

export function touchAuthFlow(id: string): void {
  const db = getDatabase();
  db.prepare("UPDATE auth_flows SET last_used = datetime('now') WHERE id = ?").run(id);
}

// ─── Auth detection ──────────────────────────────────────────────────────────

const AUTH_URL_PATTERNS = [
  /\/login/i, /\/signin/i, /\/sign-in/i, /\/auth/i,
  /\/sso/i, /\/oauth/i, /\/cas\/login/i,
  /accounts\.google\.com/i, /login\.microsoftonline\.com/i,
  /github\.com\/login/i, /auth0\.com/i,
];

/**
 * Detect if the current page is an auth/login page.
 */
export function isAuthPage(url: string): boolean {
  return AUTH_URL_PATTERNS.some(pattern => pattern.test(url));
}

/**
 * Detect if a navigation was a redirect to an auth page.
 */
export function isAuthRedirect(fromUrl: string, toUrl: string): boolean {
  if (fromUrl === toUrl) return false;
  return isAuthPage(toUrl) && !isAuthPage(fromUrl);
}

// ─── Replay ──────────────────────────────────────────────────────────────────

/**
 * Try to replay an auth flow for a domain. Returns true if replay succeeded.
 */
export async function tryReplayAuth(page: Page, domain: string): Promise<{ replayed: boolean; flow?: AuthFlow; method?: string }> {
  const flow = getAuthFlowByDomain(domain);
  if (!flow) return { replayed: false };

  // Method 1: Try storage state first (fastest — just load cookies)
  if (flow.storage_state_path) {
    try {
      const { existsSync, readFileSync } = await import("node:fs");
      if (existsSync(flow.storage_state_path)) {
        const state = JSON.parse(readFileSync(flow.storage_state_path, "utf8"));
        // Apply cookies from storage state
        if (state.cookies?.length) {
          await page.context().addCookies(state.cookies);
          await page.reload();
          // Check if we're still on auth page after cookie restore
          await new Promise(r => setTimeout(r, 1000));
          if (!isAuthPage(page.url())) {
            touchAuthFlow(flow.id);
            return { replayed: true, flow, method: "storage_state" };
          }
        }
      }
    } catch {}
  }

  // Method 2: Replay the recorded login flow
  if (flow.recording_id) {
    try {
      const { replayRecording } = await import("./recorder.js");
      const result = await replayRecording(flow.recording_id, page);
      if (result.success) {
        // Save fresh storage state after successful replay
        try {
          const { saveStateFromPage } = await import("./storage-state.js");
          const path = await saveStateFromPage(page, flow.name);
          const db = getDatabase();
          db.prepare("UPDATE auth_flows SET storage_state_path = ?, last_used = datetime('now') WHERE id = ?").run(path, flow.id);
        } catch {}
        touchAuthFlow(flow.id);
        return { replayed: true, flow, method: "recording_replay" };
      }
    } catch {}
  }

  return { replayed: false, flow };
}
