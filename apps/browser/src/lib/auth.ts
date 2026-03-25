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

export interface LoginResult {
  logged_in: boolean;
  redirect_url: string;
  profile_saved: boolean;
  method: "secrets_vault" | "env_file" | "not_found";
  error?: string;
}

// ─── Credential lookup ────────────────────────────────────────────────────────

export async function getCredentials(service: string): Promise<Credential | null> {
  // 1. Try @hasna/secrets vault
  try {
    const { getSecret } = await import(
      `${homedir()}/Workspace/hasna/opensource/opensourcedev/open-secrets/src/store.js`
    );
    const email = getSecret(`${service}_email`) ?? getSecret(`${service}_username`) ?? getSecret(`${service}_login`);
    const password = getSecret(`${service}_password`) ?? getSecret(`${service}_pass`);
    if (email?.value && password?.value) {
      return { email: email.value, password: password.value };
    }
  } catch { /* secrets vault not available */ }

  // 2. Fall back to ~/.secrets env file (only if it's a file, not a directory)
  const secretsPath = join(homedir(), ".secrets");
  if (existsSync(secretsPath)) {
    let content: string;
    try {
      content = readFileSync(secretsPath, "utf8");
    } catch {
      // ~/.secrets is a directory or unreadable — skip
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
    if (email && password) return { email, password };
  }

  // 3. Try process.env
  const envPrefix = service.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  const envEmail = process.env[`${envPrefix}_EMAIL`] ?? process.env[`${envPrefix}_USERNAME`];
  const envPass = process.env[`${envPrefix}_PASSWORD`];
  if (envEmail && envPass) return { email: envEmail, password: envPass };

  return null;
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
  }
): Promise<LoginResult> {
  const { fillForm } = await import("./actions.js");
  const { saveProfile } = await import("./profiles.js");

  try {
    // Navigate to login page if provided
    if (opts?.loginUrl) {
      await page.goto(opts.loginUrl, { waitUntil: "domcontentloaded" } as any);
      await new Promise(r => setTimeout(r, 500));
    }

    // Build fields map — try common selectors if not specified
    const emailSel = opts?.emailSelector ?? 'input[type="email"], input[name="email"], input[id*="email"], input[placeholder*="email" i]';
    const passSel = opts?.passwordSelector ?? 'input[type="password"]';
    const submitSel = opts?.submitSelector ?? 'button[type="submit"], input[type="submit"], button:contains("Sign in"), button:contains("Log in"), button:contains("Login")';

    const fields: Record<string, string> = {};
    if (credentials.email) fields[emailSel] = credentials.email;
    else if (credentials.username) fields[emailSel] = credentials.username;
    if (credentials.password) fields[passSel] = credentials.password;

    const fillResult: FormFillResult = await fillForm(page, fields, submitSel);

    // Wait for navigation or success text
    const successText = opts?.waitForText ?? "dashboard\|profile\|account\|welcome\|signed in\|logout";
    await new Promise(r => setTimeout(r, 1500));

    const currentUrl = (page as any).url?.() ?? "";
    const logged_in = fillResult.errors.length === 0;

    // Auto-save profile if requested
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
      method: "secrets_vault",
    };
  } catch (err) {
    return {
      logged_in: false,
      redirect_url: "",
      profile_saved: false,
      method: "not_found",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
