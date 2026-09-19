/**
 * Email open/click tracking utilities for the explicit local SQLite dashboard.
 * Hosted sends use the authenticated Emails API tracking contract instead.
 */

import {
  EMAILS_LOCAL_OPT_IN_ENV,
  invalidEmailsLocalOptInSettings,
  selectsEmailsLocalMode,
  type EmailsLocalOptInEnv,
} from "./local-opt-in.js";

const TRACKING_BASE_URL_KEY = "tracking-base-url";
const LOCAL_TRACKING_BASE_URL = ["http://", "localhost", ":3900"].join("");

export interface LocalTrackingResolutionOptions {
  env?: EmailsLocalOptInEnv;
  readConfigValue?: () => unknown | Promise<unknown>;
}

/**
 * Inject a 1x1 tracking pixel into HTML email body.
 * Adds <img src="{baseUrl}/track/open/{emailId}" ...> before </body> or at end.
 */
export function injectOpenPixel(html: string, emailId: string, baseUrl: string): string {
  const pixel = `<img src="${baseUrl}/track/open/${emailId}" width="1" height="1" style="display:none;border:0;" alt="" />`;
  if (html.includes("</body>")) {
    return html.replace("</body>", `${pixel}</body>`);
  }
  return html + pixel;
}

/**
 * Rewrite all href links in HTML to go through click tracking redirect.
 * Uses URL-safe base64 encoding of the original URL — no DB lookup needed.
 * Only rewrites http/https links; mailto: and other schemes are left alone.
 */
export function injectClickTracking(html: string, emailId: string, baseUrl: string): string {
  return html.replace(/href="(https?:\/\/[^"]+)"/gi, (_, url: string) => {
    const encoded = Buffer.from(url).toString("base64url");
    return `href="${baseUrl}/track/click/${emailId}/${encoded}"`;
  });
}

function normalizeLocalTrackingBaseUrl(value: unknown): string {
  if (value === undefined || value === null || value === "") return LOCAL_TRACKING_BASE_URL;
  if (typeof value !== "string" || value !== value.trim()) {
    throw new Error(`${TRACKING_BASE_URL_KEY} must be an absolute HTTP(S) URL`);
  }
  let parsed: URL;
  try { parsed = new URL(value); }
  catch { throw new Error(`${TRACKING_BASE_URL_KEY} must be an absolute HTTP(S) URL`); }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error(`${TRACKING_BASE_URL_KEY} must be an absolute HTTP(S) URL without credentials, query, or fragment`);
  }
  return parsed.toString().replace(/\/$/, "");
}

async function readLocalTrackingConfigValue(): Promise<unknown> {
  const { readConfigFile } = await import("./config.js");
  return readConfigFile()[TRACKING_BASE_URL_KEY];
}

/**
 * Resolve the legacy dashboard tracking URL only after explicit local opt-in.
 * The guard runs before importing or reading config, so hosted/unconfigured calls
 * fail without network or storage effects and can never manufacture localhost URLs.
 */
export async function getTrackingBaseUrl(
  options: LocalTrackingResolutionOptions = {},
): Promise<string> {
  const env = options.env ?? process.env;
  const invalid = invalidEmailsLocalOptInSettings(env);
  if (invalid.length > 0) {
    throw new Error(`${invalid.join(" and ")} must be exactly 1 before local tracking can be used`);
  }
  if (!selectsEmailsLocalMode(env)) {
    throw new Error(
      `Local tracking requires ${EMAILS_LOCAL_OPT_IN_ENV}=1 with no hosted authority; `
        + "hosted tracking must be requested through the authenticated Emails API",
    );
  }
  const readConfigValue = options.readConfigValue ?? readLocalTrackingConfigValue;
  return normalizeLocalTrackingBaseUrl(await readConfigValue());
}

/** Prepare HTML for an explicitly local send with tracking injected. */
export async function prepareTrackedHtml(
  html: string,
  emailId: string,
  trackOpens: boolean,
  trackClicks: boolean,
  options: LocalTrackingResolutionOptions = {},
): Promise<string> {
  if (!trackOpens && !trackClicks) return html;
  const baseUrl = await getTrackingBaseUrl(options);
  let result = html;
  if (trackOpens) result = injectOpenPixel(result, emailId, baseUrl);
  if (trackClicks) result = injectClickTracking(result, emailId, baseUrl);
  return result;
}
