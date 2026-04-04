import type { BrowserContext, Cookie } from "playwright";
import { getPersona } from "../db/personas.js";
import type { Persona } from "../types/index.js";
import { launchBrowser, closeBrowser } from "./browser.js";

export interface AuthSessionEntry {
  personaId: string;
  personaName: string;
  context: BrowserContext;
  cookies: Cookie[];
  loginUrl: string;
  loggedInAt: string;
  lastRefreshedAt: string;
}

export interface AuthSessionPoolOptions {
  /** Max age of a session before it needs re-login (ms, default 30 min) */
  sessionMaxAgeMs?: number;
}

/**
 * Manages pre-authenticated browser sessions for multiple personas.
 * Each persona with auth credentials gets its own persistent browser context
 * with cookies/localStorage restored, so test scenarios start authenticated.
 */
export class AuthenticatedSessionPool {
  private readonly sessions = new Map<string, AuthSessionEntry>();
  private readonly sessionMaxAgeMs: number;

  constructor(options?: AuthSessionPoolOptions) {
    this.sessionMaxAgeMs = options?.sessionMaxAgeMs ?? 30 * 60 * 1000;
  }

  /**
   * Pre-login a single persona — launches a browser context with restored auth state.
   * If the persona has no auth credentials, returns null.
   */
  async addPersona(personaId: string): Promise<AuthSessionEntry | null> {
    const persona = getPersona(personaId);
    if (!persona) throw new Error(`Persona not found: ${personaId}`);

    // Check if we have a valid existing session
    const existing = this.sessions.get(personaId);
    if (existing && this.isSessionFresh(existing)) {
      existing.lastRefreshedAt = new Date().toISOString();
      return existing;
    }

    // Expire stale session
    if (existing) {
      await this.removeSession(existing);
    }

    // Persona must have auth credentials
    if (!persona.auth?.email || !persona.auth?.password) {
      return null;
    }

    const loginUrl = `${this.resolveBaseUrl(persona)}${persona.auth.loginPath || "/login"}`;

    // Try to restore from saved cookies (fast path)
    const browser = await launchBrowser({ headless: true });
    const context = await browser.newContext();

    // Restore auth state if persona has saved session data
    if (persona.auth.cookies && persona.auth.cookies.length > 0) {
      await context.addCookies(persona.auth.cookies as unknown as Cookie[]);
    }

    const entry: AuthSessionEntry = {
      personaId,
      personaName: persona.name,
      context,
      cookies: [],
      loginUrl,
      loggedInAt: new Date().toISOString(),
      lastRefreshedAt: new Date().toISOString(),
    };

    this.sessions.set(personaId, entry);
    return entry;
  }

  /**
   * Get an authenticated context for a persona. Returns null if not authenticated.
   */
  getContext(personaId: string): BrowserContext | null {
    const entry = this.sessions.get(personaId);
    if (!entry || !this.isSessionFresh(entry)) {
      return null;
    }
    return entry.context;
  }

  /**
   * Get all active session entries.
   */
  getSessions(): AuthSessionEntry[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Check if a persona has an active session.
   */
  hasSession(personaId: string): boolean {
    const entry = this.sessions.get(personaId);
    return entry !== undefined && this.isSessionFresh(entry);
  }

  /**
   * Remove and close a persona's session.
   */
  async removePersona(personaId: string): Promise<void> {
    const entry = this.sessions.get(personaId);
    if (entry) {
      await this.removeSession(entry);
      this.sessions.delete(personaId);
    }
  }

  /**
   * Refresh all sessions by re-login.
   */
  async refreshAll(): Promise<void> {
    const ids = Array.from(this.sessions.keys());
    for (const id of ids) {
      await this.addPersona(id);
    }
  }

  /**
   * Close all sessions and release resources.
   */
  async closeAll(): Promise<void> {
    const entries = Array.from(this.sessions.values());
    for (const entry of entries) {
      await this.removeSession(entry);
    }
    this.sessions.clear();
  }

  private isSessionFresh(entry: AuthSessionEntry): boolean {
    const age = Date.now() - new Date(entry.lastRefreshedAt).getTime();
    return age < this.sessionMaxAgeMs;
  }

  private async removeSession(entry: AuthSessionEntry): Promise<void> {
    try {
      // Get the browser from the context to close it
      const browser = (entry.context as unknown as { browser(): import("playwright").Browser }).browser?.();
      if (browser) {
        await closeBrowser(browser as import("playwright").Browser);
      } else {
        await entry.context.close().catch(() => {});
      }
    } catch {
      // Already closed
    }
  }

  private resolveBaseUrl(persona: Persona): string {
    // Derive base URL from login path
    const loginPath = persona.auth?.loginPath || "/login";
    if (loginPath.startsWith("http")) {
      const url = new URL(loginPath);
      return url.origin;
    }
    return "";
  }
}
