import type { Page, BrowserContext } from "playwright";
import type { AuthProfile, AuthStrategy } from "../types/index.js";

/**
 * Login using an AuthProfile based on the configured strategy.
 * This is the entry point for persona-based authentication in the test runner.
 */
export async function authenticateWithProfile(
  page: Page,
  context: BrowserContext,
  profile: AuthProfile,
  baseUrl: string,
): Promise<void> {
  switch (profile.strategy) {
    case "form-login":
      await formLogin(page, profile, baseUrl);
      break;
    case "bearer":
      await setBearerAuth(context, profile);
      break;
    case "cookie":
      await setAuthCookies(context, profile);
      break;
    case "oauth":
      await oauthLogin(page, profile, baseUrl);
      break;
    case "custom_script":
      await runCustomAuthScript(page, context, profile);
      break;
    default:
      throw new Error(`Unknown auth strategy: ${(profile as AuthProfile).strategy}`);
  }
}

async function formLogin(page: Page, profile: AuthProfile, baseUrl: string): Promise<void> {
  const loginUrl = profile.loginPath
    ? `${baseUrl.replace(/\/$/, "")}${profile.loginPath}`
    : `${baseUrl}/login`;

  await page.goto(loginUrl);

  const emailSelector = profile.emailFieldSelector ?? 'input[type="email"], input[name="email"], input[name="username"]';
  const passwordSelector = profile.passwordFieldSelector ?? 'input[type="password"], input[name="password"]';
  const submitSelector = profile.submitSelector ?? 'input[type="submit"], button[type="submit"], button.login';

  if (!profile.email || !profile.password) {
    throw new Error("Email and password are required for form-login strategy");
  }

  const email = profile.email;
  const password = profile.password;

  await page.locator(emailSelector).first().fill(email);
  await page.locator(passwordSelector).first().fill(password);
  await page.locator(submitSelector).first().click();

  // Wait for navigation after login
  await page.waitForLoadState("networkidle").catch(() => {
    // Fallback if networkidle times out (SPA navigation)
  });

  if (profile.postLoginWaitFor) {
    await page.locator(profile.postLoginWaitFor).waitFor({ state: "visible", timeout: 10000 });
  }
}

async function setBearerAuth(context: BrowserContext, profile: AuthProfile): Promise<void> {
  const token = profile.bearerToken;
  if (!token) {
    throw new Error("Bearer token is required for bearer auth strategy");
  }

  await context.addInitScript((t) => {
    window.sessionStorage.setItem("auth_token", t);
  }, token);
}

async function setAuthCookies(context: BrowserContext, profile: AuthProfile): Promise<void> {
  const cookies = profile.cookies;
  if (!cookies || cookies.length === 0) {
    throw new Error("Cookies are required for cookie auth strategy");
  }

  await context.addCookies(cookies);
}

async function oauthLogin(page: Page, profile: AuthProfile, baseUrl: string): Promise<void> {
  if (!profile.oauthProvider) {
    throw new Error("OAuth provider is required for oauth auth strategy");
  }

  const loginUrl = profile.loginPath
    ? `${baseUrl.replace(/\/$/, "")}${profile.loginPath}`
    : `${baseUrl}/oauth/${profile.oauthProvider}`;

  await page.goto(loginUrl);

  if (profile.email && profile.password) {
    const emailSelector = profile.emailFieldSelector ?? 'input[type="email"], input[name="email"]';
    const passwordSelector = profile.passwordFieldSelector ?? 'input[type="password"], input[name="password"]';
    const submitSelector = profile.submitSelector ?? 'button[type="submit"]';

    await page.locator(emailSelector).first().fill(profile.email);
    await page.locator(passwordSelector).first().fill(profile.password);
    await page.locator(submitSelector).first().click();

    await page.waitForLoadState("networkidle").catch(() => {});
  }

  if (profile.postLoginWaitFor) {
    await page.locator(profile.postLoginWaitFor).waitFor({ state: "visible", timeout: 10000 });
  }
}

async function runCustomAuthScript(page: Page, context: BrowserContext, profile: AuthProfile): Promise<void> {
  const script = profile.customScript;
  if (!script) {
    throw new Error("Custom script is required for custom_script auth strategy");
  }

  const fn = new Function("page", "context", "profile", script);
  await fn(page, {
    goto: async (url: string) => page.goto(url),
    addInitScript: async (scriptFn: any, arg: any) => context.addInitScript(scriptFn, arg),
    addCookies: async (c: any) => context.addCookies(c),
  }, profile);
}

/**
 * Serialize an AuthProfile to a plain object for storage in the database.
 */
export function serializeProfile(profile: AuthProfile): Record<string, string | null> {
  return {
    strategy: profile.strategy,
    email: profile.email ?? null,
    password: profile.password ?? null,
    login_path: profile.loginPath ?? null,
    email_field_selector: profile.emailFieldSelector ?? null,
    password_field_selector: profile.passwordFieldSelector ?? null,
    submit_selector: profile.submitSelector ?? null,
    post_login_wait_for: profile.postLoginWaitFor ?? null,
    bearer_token: profile.bearerToken ?? null,
    cookies: profile.cookies ? JSON.stringify(profile.cookies) : null,
    oauth_provider: profile.oauthProvider ?? null,
    custom_script: profile.customScript ?? null,
    headers: profile.headers ? JSON.stringify(profile.headers) : null,
  };
}

/**
 * Deserialize a database row into an AuthProfile.
 */
export function deserializeProfile(row: Record<string, string | null>): AuthProfile {
  return {
    strategy: (row.strategy ?? "form-login") as AuthStrategy,
    email: row.email ?? undefined,
    password: row.password ?? undefined,
    loginPath: row.login_path ?? undefined,
    emailFieldSelector: row.email_field_selector ?? undefined,
    passwordFieldSelector: row.password_field_selector ?? undefined,
    submitSelector: row.submit_selector ?? undefined,
    postLoginWaitFor: row.post_login_wait_for ?? undefined,
    bearerToken: row.bearer_token ?? undefined,
    cookies: row.cookies ? JSON.parse(row.cookies) : undefined,
    oauthProvider: row.oauth_provider ?? undefined,
    customScript: row.custom_script ?? undefined,
    headers: row.headers ? JSON.parse(row.headers) : undefined,
  };
}
