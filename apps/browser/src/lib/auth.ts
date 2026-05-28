/**
 * open-secrets integration for browser login automation.
 * Reads credentials from @hasna/secrets vault or ~/.secrets file as fallback.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { Page } from "playwright";
import type { FormFillResult } from "../types/index.js";

export interface Credential {
  email?: string;
  username?: string;
  password?: string;
  totp?: string;
}

export interface CredentialLookup {
  credential: Credential | null;
  method: LoginResult["method"];
}

export interface LoginResult {
  logged_in: boolean;
  redirect_url: string;
  profile_saved: boolean;
  method: "secrets_vault" | "env_file" | "process_env" | "not_found";
  error?: string;
}

// ─── Credential lookup ────────────────────────────────────────────────────────

export async function lookupCredentials(service: string): Promise<CredentialLookup> {
  // 1. Try @hasna/secrets vault (configurable via env, not hardcoded)
  try {
    const secretsVaultPath = process.env["BROWSER_SECRETS_VAULT_PATH"];
    if (secretsVaultPath) {
      const { getSecret } = await import(secretsVaultPath);
      const email = getSecret(`${service}_email`) ?? getSecret(`${service}_username`) ?? getSecret(`${service}_login`);
      const password = getSecret(`${service}_password`) ?? getSecret(`${service}_pass`);
      if (email?.value && password?.value) {
        return {
          credential: { email: email.value, password: password.value },
          method: "secrets_vault",
        };
      }
    }
  } catch { /* secrets vault not available */ }

  // 2. Fall back to ~/.secrets env file (only if it's a file, not a directory)
  const secretsPath = join(homedir(), ".secrets");
  if (existsSync(secretsPath)) {
    let content: string;
    try {
      content = readFileSync(secretsPath, "utf8");
    } catch {
      content = "";
    }
    const lines = content.split("\n");
    const prefix = service.toUpperCase().replace(/[^A-Z0-9]/g, "_");
    const vars: Record<string, string> = {};
    for (const line of lines) {
      const match = line.match(/^export\s+([A-Z_]+)=["']?(.+?)["']?\s*$/);
      if (match) vars[match[1]] = match[2];
    }
    const email = vars[`${prefix}_EMAIL`] ?? vars[`${prefix}_USERNAME`];
    const password = vars[`${prefix}_PASSWORD`];
    if (email && password) {
      return { credential: { email, password }, method: "env_file" };
    }
  }

  // 3. Try process.env
  const envPrefix = service.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  const envEmail = process.env[`${envPrefix}_EMAIL`] ?? process.env[`${envPrefix}_USERNAME`];
  const envPass = process.env[`${envPrefix}_PASSWORD`];
  if (envEmail && envPass) {
    return { credential: { email: envEmail, password: envPass }, method: "process_env" };
  }

  return { credential: null, method: "not_found" };
}

export async function getCredentials(service: string): Promise<Credential | null> {
  return (await lookupCredentials(service)).credential;
}

// ─── Login flow ───────────────────────────────────────────────────────────────

export async function loginWithCredentials(
  page: Page,
  credentials: Credential,
  opts?: {
    loginUrl?: string;
    emailSelector?: string;
    passwordSelector?: string;
    submitSelector?: string;
    waitForText?: string;
    saveProfile?: string;
    method?: LoginResult["method"];
  }
): Promise<LoginResult> {
  const { fillForm, waitForText } = await import("./actions.js");
  const { saveProfile } = await import("./profiles.js");

  try {
    if (opts?.loginUrl) {
      await page.goto(opts.loginUrl, { waitUntil: "domcontentloaded" } as any);
      await new Promise(r => setTimeout(r, 500));
    }

    const urlBefore = page.url();
    const emailSel = opts?.emailSelector ?? 'input[type="email"], input[name="email"], input[id*="email"], input[placeholder*="email" i]';
    const passSel = opts?.passwordSelector ?? 'input[type="password"]';
    const submitSel = opts?.submitSelector ?? 'button[type="submit"], input[type="submit"]';

    const fields: Record<string, string> = {};
    if (credentials.email) fields[emailSel] = credentials.email;
    else if (credentials.username) fields[emailSel] = credentials.username;
    if (credentials.password) fields[passSel] = credentials.password;

    const fillResult: FormFillResult = await fillForm(page, fields, submitSel);

    if (fillResult.errors.some((e) => e.startsWith("submit("))) {
      try {
        await page.getByRole("button", { name: /sign in|log in|login|submit/i }).first().click({ timeout: 5000 });
      } catch {
        try {
          await page.locator('input[type="submit"]').first().click({ timeout: 3000 });
        } catch {}
      }
    }

    const successPattern = opts?.waitForText ?? "dashboard|profile|account|welcome|signed in|logout";
    const patterns = successPattern.split("|").map((p) => p.trim()).filter(Boolean);

    let logged_in = false;
    for (const pattern of patterns) {
      try {
        await waitForText(page, pattern, { timeout: 5000 });
        logged_in = fillResult.errors.length === 0;
        break;
      } catch {}
    }

    if (!logged_in) {
      await page.waitForLoadState("domcontentloaded").catch(() => {});
      await new Promise(r => setTimeout(r, 1000));
      const currentUrl = page.url();
      const bodyText = await page.evaluate(() => document.body?.innerText?.toLowerCase() ?? "").catch(() => "");
      const urlChanged = currentUrl !== urlBefore;
      const textMatch = patterns.some((p) => {
        const needle = p.toLowerCase();
        return bodyText.includes(needle) || currentUrl.toLowerCase().includes(needle);
      });
      logged_in = fillResult.errors.length === 0 && (urlChanged || textMatch);
    }

    const currentUrl = page.url();

    let profile_saved = false;
    if (opts?.saveProfile && logged_in) {
      try {
        await saveProfile(page as any, opts.saveProfile);
        profile_saved = true;
      } catch {}
    }

    return {
      logged_in,
      redirect_url: currentUrl,
      profile_saved,
      method: opts?.method ?? "secrets_vault",
    };
  } catch (err) {
    return {
      logged_in: false,
      redirect_url: "",
      profile_saved: false,
      method: opts?.method ?? "not_found",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
