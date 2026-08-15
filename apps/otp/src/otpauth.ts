import type { AddOtpEntryInput, TotpAlgorithm } from "./types.js";
import { normalizeAlgorithm, normalizeDigits, normalizePeriod, normalizeBase32Secret } from "./totp.js";

function requiredParam(params: URLSearchParams, name: string): string {
  const value = params.get(name);
  if (!value) throw new Error(`otpauth URI is missing ${name}`);
  return value;
}

function parseIntegerParam(params: URLSearchParams, name: string): number | undefined {
  const value = params.get(name);
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) throw new Error(`otpauth ${name} must be an integer`);
  return parsed;
}

export function parseOtpAuthUri(uri: string): AddOtpEntryInput {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    throw new Error("Invalid otpauth URI");
  }

  if (url.protocol !== "otpauth:") throw new Error("URI must use the otpauth scheme");
  if (url.hostname.toLowerCase() !== "totp") {
    throw new Error("Only otpauth://totp URIs are supported");
  }

  const rawLabel = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!rawLabel) throw new Error("otpauth URI label is required");

  const colon = rawLabel.indexOf(":");
  const labelIssuer = colon > -1 ? rawLabel.slice(0, colon).trim() : undefined;
  const account = (colon > -1 ? rawLabel.slice(colon + 1) : rawLabel).trim();
  if (!account) throw new Error("otpauth URI account label is required");

  const issuer = (url.searchParams.get("issuer") ?? labelIssuer)?.trim() || undefined;
  const algorithm = normalizeAlgorithm(url.searchParams.get("algorithm") ?? undefined);
  const digits = normalizeDigits(parseIntegerParam(url.searchParams, "digits"));
  const period = normalizePeriod(parseIntegerParam(url.searchParams, "period"));
  const secret = normalizeBase32Secret(requiredParam(url.searchParams, "secret"));

  const parsed: AddOtpEntryInput = {
    account,
    secret,
    algorithm: algorithm as TotpAlgorithm,
    digits,
    period,
    label: issuer ? `${issuer}:${account}` : account,
  };
  if (issuer) parsed.issuer = issuer;
  return parsed;
}
