import { describe, expect, it } from "bun:test";
import {
  dashboardApiOriginAccess,
  dashboardApiPreflightResponse,
  handleDashboardRequest,
  withDashboardApiCors,
} from "./serve.js";

describe("dashboard API browser-origin protection", () => {
  it("rejects adversarial cross-origin browser preflights without wildcard CORS", async () => {
    const req = new Request("http://127.0.0.1:3900/api/providers", {
      method: "OPTIONS",
      headers: {
        Origin: "https://evil.example",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
      },
    });

    const response = dashboardApiPreflightResponse(req, new URL(req.url));

    expect(response.status).toBe(403);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(await response.json()).toEqual({ error: "Cross-origin dashboard API requests are not allowed." });
  });

  it("rejects DNS-rebinding origins that match an untrusted Host", () => {
    const req = new Request("http://attacker.example:3900/api/providers", {
      headers: { Origin: "http://attacker.example:3900" },
    });

    expect(dashboardApiOriginAccess(req, new URL(req.url))).toMatchObject({
      allowed: false,
      reason: "Dashboard API Host is not allowed.",
    });
  });

  it("allows same-origin dashboard preflights with an exact origin", () => {
    const req = new Request("http://127.0.0.1:3900/api/providers", {
      method: "OPTIONS",
      headers: {
        Origin: "http://127.0.0.1:3900",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
      },
    });

    const response = dashboardApiPreflightResponse(req, new URL(req.url));

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("http://127.0.0.1:3900");
    expect(response.headers.get("Access-Control-Allow-Origin")).not.toBe("*");
    expect(response.headers.get("Access-Control-Allow-Methods")).toContain("POST");
    expect(response.headers.get("Access-Control-Allow-Headers")).toBe("content-type");
    expect(response.headers.get("Vary")).toContain("Origin");
  });

  it("does not allow arbitrary requested preflight headers", () => {
    const req = new Request("http://127.0.0.1:3900/api/providers", {
      method: "OPTIONS",
      headers: {
        Origin: "http://127.0.0.1:3900",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type, x-exfiltrate",
      },
    });

    const response = dashboardApiPreflightResponse(req, new URL(req.url));

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Headers")).toBe("content-type");
  });

  it("uses the fixed API header allowlist when no preflight headers are requested", () => {
    const req = new Request("http://127.0.0.1:3900/api/providers", {
      method: "OPTIONS",
      headers: { Origin: "http://127.0.0.1:3900" },
    });

    const response = dashboardApiPreflightResponse(req, new URL(req.url));

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Headers")).toBe("Content-Type, Authorization");
  });

  it("rejects a different loopback hostname unless it is explicitly allowed", () => {
    const req = new Request("http://127.0.0.1:3900/api/providers", {
      headers: { Origin: "http://localhost:3900" },
    });

    const access = dashboardApiOriginAccess(req, new URL(req.url));

    expect(access).toMatchObject({
      allowed: false,
      reason: "Cross-origin dashboard API requests are not allowed.",
    });
  });

  it("allows explicitly configured dashboard origins", () => {
    const previous = process.env["EMAILS_DASHBOARD_ALLOWED_ORIGINS"];
    process.env["EMAILS_DASHBOARD_ALLOWED_ORIGINS"] = "http://localhost:3900";
    try {
      const req = new Request("http://127.0.0.1:3900/api/providers", {
        headers: { Origin: "http://localhost:3900" },
      });

      const access = dashboardApiOriginAccess(req, new URL(req.url));
      const response = withDashboardApiCors(new Response("{}", { headers: { "Content-Type": "application/json" } }), access, req);

      expect(access.allowed).toBe(true);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:3900");
      expect(response.headers.get("Access-Control-Allow-Origin")).not.toBe("*");
    } finally {
      if (previous === undefined) {
        delete process.env["EMAILS_DASHBOARD_ALLOWED_ORIGINS"];
      } else {
        process.env["EMAILS_DASHBOARD_ALLOWED_ORIGINS"] = previous;
      }
    }
  });

  it("allows an explicitly configured remote dashboard host", () => {
    const previous = process.env["EMAILS_DASHBOARD_ALLOWED_ORIGINS"];
    process.env["EMAILS_DASHBOARD_ALLOWED_ORIGINS"] = "http://emails.example:3900";
    try {
      const req = new Request("http://emails.example:3900/api/providers", {
        headers: { Origin: "http://emails.example:3900" },
      });

      expect(dashboardApiOriginAccess(req, new URL(req.url))).toMatchObject({
        allowed: true,
        origin: "http://emails.example:3900",
      });
    } finally {
      if (previous === undefined) {
        delete process.env["EMAILS_DASHBOARD_ALLOWED_ORIGINS"];
      } else {
        process.env["EMAILS_DASHBOARD_ALLOWED_ORIGINS"] = previous;
      }
    }
  });

  it("rejects cross-site browser API requests that omit Origin", () => {
    const req = new Request("http://127.0.0.1:3900/api/providers", {
      headers: { "Sec-Fetch-Site": "cross-site" },
    });

    expect(dashboardApiOriginAccess(req, new URL(req.url))).toMatchObject({
      allowed: false,
      reason: "Cross-site browser requests to the dashboard API are not allowed.",
    });
  });

  it.each([
    undefined,
    "none",
    "same-origin",
    "same-site",
  ])("rejects Origin-less unsafe API methods with Sec-Fetch-Site=%p", (fetchSite) => {
    const headers = new Headers();
    if (fetchSite) headers.set("Sec-Fetch-Site", fetchSite);
    const req = new Request("http://127.0.0.1:3900/api/providers", {
      method: "POST",
      headers,
    });

    expect(dashboardApiOriginAccess(req, new URL(req.url))).toMatchObject({
      allowed: false,
      reason: "Unsafe dashboard API requests require an Origin header.",
    });
  });

  it("allows Origin-less safe API reads from a trusted Host", () => {
    const req = new Request("http://127.0.0.1:3900/api/providers");

    expect(dashboardApiOriginAccess(req, new URL(req.url))).toEqual({ allowed: true });
  });

  it("rejects actual cross-origin API requests before route handling", async () => {
    const response = await handleDashboardRequest(new Request("http://127.0.0.1:3900/api/providers", {
      method: "POST",
      headers: { Origin: "https://evil.example", "Content-Type": "application/json" },
      body: JSON.stringify({ name: "evil", type: "resend", api_key: "re_secret" }),
    }));

    expect(response.status).toBe(403);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(await response.json()).toEqual({ error: "Cross-origin dashboard API requests are not allowed." });
  });

  it("rejects actual DNS-rebinding API requests before route handling", async () => {
    const response = await handleDashboardRequest(new Request("http://attacker.example:3900/api/providers", {
      headers: { Origin: "http://attacker.example:3900" },
    }));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Dashboard API Host is not allowed." });
  });
});
