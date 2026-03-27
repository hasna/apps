import type { Page } from "playwright";
import type { Persona } from "../types/index.js";
import { savePersonaAuthCookies } from "../db/personas.js";
import { resolveCredential } from "./secrets-resolver.js";

const COOKIE_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour

export interface LoginResult {
  success: boolean;
  method: "cookies" | "login" | "none";
  error?: string;
}

/**
 * Checks whether saved persona cookies are still fresh (< 1 hour old).
 * Uses the first cookie's expiry or falls back to a fixed TTL tracked via
 * the persona's updatedAt timestamp.
 */
function areCookiesFresh(persona: Persona): boolean {
  if (!persona.auth?.cookies?.length) return false;
  const cookies = persona.auth.cookies as Array<{ expires?: number }>;
  // Check if any cookie has an explicit expiry in the future
  const now = Date.now() / 1000;
  const hasFutureExpiry = cookies.some((c) => c.expires && c.expires > now + 60);
  if (hasFutureExpiry) return true;
  // Fall back: treat cookies as fresh if persona was updated < 1h ago
  const updatedAt = new Date(persona.updatedAt).getTime();
  return Date.now() - updatedAt < COOKIE_MAX_AGE_MS;
}

/**
 * Restores a persona's saved cookies into the page context.
 * Returns true if cookies were successfully restored.
 */
async function restoreCookies(page: Page, persona: Persona): Promise<boolean> {
  if (!persona.auth?.cookies?.length) return false;
  try {
    const context = page.context();
    await context.addCookies(
      persona.auth.cookies as unknown as Parameters<typeof context.addCookies>[0],
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Captures current cookies from the page context and saves them back
 * to the persona record for reuse on future runs.
 */
async function captureCookies(page: Page, personaId: string): Promise<void> {
  try {
    const context = page.context();
    const cookies = await context.cookies();
    if (cookies.length > 0) {
      savePersonaAuthCookies(personaId, cookies as unknown as Record<string, unknown>[]);
    }
  } catch {
    // Non-critical — continue even if we can't save cookies
  }
}

/**
 * Performs a form-based login for the given persona. Strategy:
 * 1. Navigate to loginPath (relative paths are joined with baseUrl).
 * 2. Try to fill the email field using common selectors.
 * 3. Try to fill the password field using common selectors.
 * 4. Submit the form and wait for navigation.
 * 5. Verify we are no longer on the login page.
 */
async function performLogin(
  page: Page,
  persona: Persona,
  baseUrl: string,
): Promise<LoginResult> {
  const auth = persona.auth!;

  // Resolve credentials — support @secrets:<key> and $ENV_VAR references
  const email = resolveCredential(auth.email);
  const password = resolveCredential(auth.password);

  if (!email || !password) {
    return {
      success: false,
      method: "login",
      error: `Could not resolve credentials for persona "${persona.name}". Check that @secrets: keys or $ENV_VAR references are correct.`,
    };
  }

  const loginUrl = auth.loginPath.startsWith("http")
    ? auth.loginPath
    : `${baseUrl.replace(/\/$/, "")}${auth.loginPath}`;

  try {
    await page.goto(loginUrl, { timeout: 30_000, waitUntil: "domcontentloaded" });
  } catch (err) {
    return { success: false, method: "login", error: `Navigation to login page failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  // Common email field selectors (in priority order)
  const emailSelectors = [
    'input[type="email"]',
    'input[name="email"]',
    'input[name="username"]',
    'input[id="email"]',
    'input[autocomplete="email"]',
    'input[placeholder*="email" i]',
    'input[placeholder*="username" i]',
  ];

  // Common password field selectors
  const passwordSelectors = [
    'input[type="password"]',
    'input[name="password"]',
    'input[id="password"]',
    'input[autocomplete="current-password"]',
  ];

  // Common submit button selectors
  const submitSelectors = [
    'button[type="submit"]',
    'input[type="submit"]',
    'button:has-text("Sign in")',
    'button:has-text("Log in")',
    'button:has-text("Login")',
    'button:has-text("Continue")',
    'button:has-text("Submit")',
    '[role="button"]:has-text("Sign in")',
  ];

  // Fill email
  let emailFilled = false;
  for (const sel of emailSelectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 2_000 })) {
        await el.fill(email, { timeout: 5_000 });
        emailFilled = true;
        break;
      }
    } catch { /* try next */ }
  }

  if (!emailFilled) {
    return { success: false, method: "login", error: "Could not find email/username field on login page" };
  }

  // Fill password
  let passwordFilled = false;
  for (const sel of passwordSelectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 2_000 })) {
        await el.fill(password, { timeout: 5_000 });
        passwordFilled = true;
        break;
      }
    } catch { /* try next */ }
  }

  if (!passwordFilled) {
    return { success: false, method: "login", error: "Could not find password field on login page" };
  }

  // Submit — try clicking a submit button, fall back to pressing Enter
  let submitted = false;
  for (const sel of submitSelectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 2_000 })) {
        await Promise.all([
          page.waitForNavigation({ timeout: 15_000, waitUntil: "domcontentloaded" }).catch(() => {}),
          el.click({ timeout: 5_000 }),
        ]);
        submitted = true;
        break;
      }
    } catch { /* try next */ }
  }

  if (!submitted) {
    // Fall back to pressing Enter on the password field
    try {
      await Promise.all([
        page.waitForNavigation({ timeout: 15_000, waitUntil: "domcontentloaded" }).catch(() => {}),
        page.keyboard.press("Enter"),
      ]);
      submitted = true;
    } catch (err) {
      return { success: false, method: "login", error: `Failed to submit login form: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  // Verify we navigated away from the login page
  const currentUrl = page.url();
  const isStillOnLogin =
    currentUrl.includes(auth.loginPath) ||
    currentUrl.includes("/login") ||
    currentUrl.includes("/signin") ||
    currentUrl.includes("/auth");

  if (isStillOnLogin) {
    // Check for visible error messages
    let errorText = "";
    try {
      const errorEl = page.locator('[role="alert"], .error, .alert-error, [data-testid*="error"]').first();
      if (await errorEl.isVisible({ timeout: 1_000 })) {
        errorText = (await errorEl.textContent() ?? "").trim();
      }
    } catch { /* ignore */ }
    return {
      success: false,
      method: "login",
      error: errorText
        ? `Login failed: ${errorText}`
        : "Login form submitted but still on login page — credentials may be incorrect",
    };
  }

  return { success: true, method: "login" };
}

/**
 * Ensures a persona is authenticated before a scenario runs. Flow:
 * 1. If the persona has no auth credentials → skip (return none).
 * 2. If saved cookies exist and are fresh → restore them (fast path).
 * 3. Otherwise → perform full login, then save resulting cookies.
 *
 * @param page     The Playwright page to authenticate.
 * @param persona  The persona (must have auth set).
 * @param baseUrl  Base URL of the app under test.
 */
export async function ensurePersonaAuthenticated(
  page: Page,
  persona: Persona,
  baseUrl: string,
): Promise<LoginResult> {
  if (!persona.auth) {
    return { success: true, method: "none" };
  }

  // Fast path: restore saved cookies if they're still fresh
  if (areCookiesFresh(persona)) {
    const restored = await restoreCookies(page, persona);
    if (restored) {
      return { success: true, method: "cookies" };
    }
  }

  // Slow path: full login
  const result = await performLogin(page, persona, baseUrl);

  if (result.success) {
    // Capture and save cookies for future runs
    await captureCookies(page, persona.id);
  }

  return result;
}
