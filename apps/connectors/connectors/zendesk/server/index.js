#!/usr/bin/env bun
// @bun

// src/server/index.ts
var PORT = parseInt(process.env.PORT || "3000");
var HOST = process.env.HOST || "0.0.0.0";
var API_KEY = process.env.CONNECTOR_API_KEY;
if (!API_KEY) {
  console.error("WARNING: CONNECTOR_API_KEY not set - server will reject all authenticated requests");
}
var startTime = Date.now();
function getServerInfo() {
  return {
    name: "connect-zendesk",
    version: "1.0.0",
    uptime: Math.floor((Date.now() - startTime) / 1000),
    timestamp: new Date().toISOString(),
    environment: "development"
  };
}
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key"
    }
  });
}
function handleCORS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key"
    }
  });
}
function validateApiKey(req) {
  const apiKey = req.headers.get("X-API-Key");
  return apiKey === API_KEY && API_KEY !== "";
}
var server = Bun.serve({
  port: PORT,
  hostname: HOST,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;
    if (req.method === "OPTIONS") {
      return handleCORS();
    }
    if (path === "/health" || path === "/zendesk/health") {
      return jsonResponse({ status: "healthy" });
    }
    if (!validateApiKey(req)) {
      return jsonResponse({
        error: "Unauthorized",
        code: "INVALID_API_KEY",
        hint: "Provide valid API key via X-API-Key header"
      }, 401);
    }
    if (path === "/status" || path === "/zendesk/status") {
      return jsonResponse({
        status: "ok",
        service: "connect-zendesk",
        ...getServerInfo(),
        endpoints: {
          health: "/zendesk/health",
          status: "/zendesk/status",
          api: "/zendesk/api/*"
        }
      });
    }
    if (path === "/" || path === "/zendesk" || path === "/zendesk/") {
      return jsonResponse({
        service: "connect-zendesk",
        description: "Zendesk API connector service",
        version: "1.0.0",
        documentation: "https://github.com/hasna/connect-zendesk",
        endpoints: {
          health: "GET /zendesk/health (no auth)",
          status: "GET /zendesk/status (requires X-API-Key)",
          api: "See Zendesk API documentation (requires X-API-Key)"
        }
      });
    }
    if (path.startsWith("/zendesk/api/") || path.startsWith("/api/")) {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) {
        return jsonResponse({ error: "Authorization header required for Zendesk API", code: "ZENDESK_AUTH_REQUIRED" }, 401);
      }
      const subdomain = url.searchParams.get("subdomain") || req.headers.get("X-Zendesk-Subdomain");
      if (!subdomain) {
        return jsonResponse({
          error: "Zendesk subdomain required",
          code: "MISSING_SUBDOMAIN",
          hint: "Provide subdomain via query param (?subdomain=xxx) or X-Zendesk-Subdomain header"
        }, 400);
      }
      const apiPath = path.replace("/zendesk/api/", "").replace("/api/", "");
      const zendeskUrl = `https://${subdomain}.zendesk.com/api/v2/${apiPath}${url.search}`;
      try {
        const response = await fetch(zendeskUrl, {
          method: req.method,
          headers: {
            Authorization: authHeader,
            "Content-Type": "application/json",
            Accept: "application/json"
          },
          body: req.method !== "GET" && req.method !== "HEAD" ? await req.text() : undefined
        });
        const data = await response.json();
        return jsonResponse(data, response.status);
      } catch (err) {
        return jsonResponse({
          error: "Failed to proxy request to Zendesk",
          code: "PROXY_ERROR",
          details: String(err)
        }, 502);
      }
    }
    return jsonResponse({
      error: "Not found",
      code: "NOT_FOUND",
      path
    }, 404);
  },
  error(error) {
    console.error("Server error:", error);
    return jsonResponse({ error: "Internal server error", code: "INTERNAL_ERROR" }, 500);
  }
});
console.log(`\uD83D\uDE80 connect-zendesk server running at http://${HOST}:${PORT}`);
console.log(`   Health: http://${HOST}:${PORT}/zendesk/health (no auth)`);
console.log(`   Status: http://${HOST}:${PORT}/zendesk/status (requires X-API-Key)`);
console.log(`   API Key configured: ${API_KEY ? "Yes" : "No"}`);
export {
  server
};
