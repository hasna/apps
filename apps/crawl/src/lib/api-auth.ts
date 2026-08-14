import { createHash } from "crypto";
import { getApiKeyByHash, touchApiKey } from "../db/api-keys.js";
import type { ApiKey } from "../types/index.js";

export function hashApiKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function validateApiKey(raw: string): ApiKey | null {
  if (!raw) return null;
  const hash = hashApiKey(raw);
  const key = getApiKeyByHash(hash);
  if (!key) return null;
  if (!key.active) return null;
  if (key.expiresAt && new Date(key.expiresAt) < new Date()) return null;
  touchApiKey(key.id);
  return key;
}

export function extractBearerToken(req: Request): string | null {
  const auth = req.headers.get("Authorization") ?? req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  return auth.slice(7).trim();
}
