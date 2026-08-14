/**
 * API endpoint detection — scan network log for JSON API responses.
 */

import { getDatabase } from "../db/schema.js";
import { randomUUID } from "node:crypto";

export interface DetectedAPI {
  url: string;
  method: string;
  status_code: number;
  content_type: string;
  response_schema: Record<string, string>;
  sample_size: number;
}

/**
 * Scan network log for API endpoints that return JSON.
 */
export function detectAPIs(sessionId: string): DetectedAPI[] {
  const db = getDatabase();

  // Get network requests that returned JSON
  const requests = db.query<any, string>(
    `SELECT method, url, status_code, response_headers, body_size
     FROM network_log
     WHERE session_id = ?
     AND (response_headers LIKE '%application/json%' OR response_headers LIKE '%text/json%')
     AND status_code >= 200 AND status_code < 400
     ORDER BY timestamp DESC`
  ).all(sessionId);

  // Deduplicate by URL pattern (strip query params for grouping)
  const seen = new Map<string, DetectedAPI>();

  for (const req of requests) {
    try {
      const urlObj = new URL(req.url);
      // Skip static assets and common non-API paths
      if (urlObj.pathname.match(/\.(js|css|png|jpg|svg|woff|ico)$/)) continue;
      if (urlObj.hostname.includes("googleapis.com/identitytoolkit")) continue;
      if (urlObj.hostname.includes("posthog")) continue;
      if (urlObj.hostname.includes("sentry")) continue;

      const key = `${req.method} ${urlObj.origin}${urlObj.pathname}`;
      if (!seen.has(key)) {
        seen.set(key, {
          url: `${urlObj.origin}${urlObj.pathname}`,
          method: req.method,
          status_code: req.status_code,
          content_type: "application/json",
          response_schema: {},
          sample_size: req.body_size ?? 0,
        });
      }
    } catch {}
  }

  const apis = Array.from(seen.values());

  // Save discovered endpoints to DB
  for (const api of apis) {
    const id = randomUUID();
    db.prepare(
      "INSERT OR IGNORE INTO api_endpoints (id, session_id, url, method, status_code, content_type) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(id, sessionId, api.url, api.method, api.status_code, api.content_type);
  }

  return apis;
}

export function listDiscoveredAPIs(sessionId?: string): any[] {
  const db = getDatabase();
  if (sessionId) {
    return db.query<any, string>("SELECT * FROM api_endpoints WHERE session_id = ? ORDER BY discovered_at DESC").all(sessionId);
  }
  return db.query<any, []>("SELECT * FROM api_endpoints ORDER BY discovered_at DESC LIMIT 100").all();
}
