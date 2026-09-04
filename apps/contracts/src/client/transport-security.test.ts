import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  clientTransportEnvKeys,
  createClientTransport,
  createHasnaHttpTransport,
  defaultCloudBaseUrl,
  fleetApiDomain,
  HasnaHttpError,
  resolveClientTransport,
  toV1BaseUrl,
} from "./transport.js";
import { createLoopbackTestGate } from "../testing/loopback.js";

// Each suite below is gated on the bind it actually performs, not on a single
// combined probe: a sandbox that refuses 0.0.0.0 usually still allows
// 127.0.0.1, and the redirect-loop and Host-override boundaries only ever bind
// 127.0.0.1. The gates are fail-closed — an unavailable bind produces a failing
// case, not a silent skip — unless CONTRACTS_ALLOW_LOOPBACK_SKIP=1 is set, and
// the positive control below fails in that case so no run is ever green
// without these suites.
const loopbackGate = createLoopbackTestGate(["loopback"], { describe, test });
const wildcardGate = createLoopbackTestGate(["wildcard"], { describe, test });
const crossAuthorityGate = createLoopbackTestGate(["loopback", "wildcard"], { describe, test });

test("positive control: the loopback-gated security suites actually ran", () => {
  expect({
    loopback: loopbackGate.requirement.decision,
    wildcard: wildcardGate.requirement.decision,
    crossAuthority: crossAuthorityGate.requirement.decision,
  }).toEqual({ loopback: "run", wildcard: "run", crossAuthority: "run" });
});


describe("authenticated redirect boundary", () => {
  const API_KEY = ["fixture", "redirect", "value"].join("-");

  crossAuthorityGate.test("301/302/303/307/308 never forward credentials or bodies to a redirected authority", async () => {
    const cases: Array<{
      status: 301 | 302 | 303 | 307 | 308;
      method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
      body?: { marker: string };
    }> = [
      { status: 301, method: "GET" },
      { status: 302, method: "POST", body: { marker: "post-body" } },
      { status: 303, method: "PATCH", body: { marker: "patch-body" } },
      { status: 307, method: "PUT", body: { marker: "put-body" } },
      { status: 308, method: "DELETE", body: { marker: "delete-body" } },
    ];

    for (const redirectCase of cases) {
      const targetRequests: Array<{
        method: string;
        apiKey: string | null;
        authorization: string | null;
        body: string;
      }> = [];
      const target = Bun.serve({
        hostname: "0.0.0.0",
        port: 0,
        async fetch(req) {
          targetRequests.push({
            method: req.method,
            apiKey: req.headers.get("x-api-key"),
            authorization: req.headers.get("authorization"),
            body: await req.text(),
          });
          return Response.json({ reached: true });
        },
      });
      const sourceRequests: Array<{
        apiKey: string | null;
        authorization: string | null;
      }> = [];
      const source = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch(req) {
          sourceRequests.push({
            apiKey: req.headers.get("x-api-key"),
            authorization: req.headers.get("authorization"),
          });
          return new Response(null, {
            status: redirectCase.status,
            headers: { Location: `http://0.0.0.0:${target.port}/capture` },
          });
        },
      });

      try {
        const transport = createHasnaHttpTransport({
          name: "redirect-regression",
          baseUrl: `http://127.0.0.1:${source.port}`,
          apiKey: API_KEY,
          retry: false,
        });
        let thrown: unknown;
        try {
          await transport.request(
            redirectCase.method,
            `/redirect-${redirectCase.status}`,
            redirectCase.body,
            { headers: { "x-transport-marker": `status-${redirectCase.status}` } },
          );
        } catch (error) {
          thrown = error;
        }

        expect(thrown).toBeInstanceOf(HasnaHttpError);
        const httpError = thrown as HasnaHttpError;
        expect(httpError.status).toBe(redirectCase.status);
        expect(httpError.method).toBe(redirectCase.method);
        expect(httpError.path).toBe(`/redirect-${redirectCase.status}`);
        expect(httpError.message).toBe(
          `Hasna cloud request failed: ${redirectCase.method} /redirect-${redirectCase.status} -> ${redirectCase.status}`,
        );
        expect(sourceRequests).toEqual([
          { apiKey: API_KEY, authorization: `Bearer ${API_KEY}` },
        ]);
        expect(targetRequests).toEqual([]);
      } finally {
        source.stop(true);
        target.stop(true);
      }
    }
  });

  loopbackGate.test("same-origin redirects and redirect loops fail after exactly one request", async () => {
    let sameOriginDestinationHits = 0;
    let loopHits = 0;
    let source: ReturnType<typeof Bun.serve>;
    source = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/v1/same-origin") {
          return new Response(null, {
            status: 307,
            headers: { Location: `http://127.0.0.1:${source.port}/v1/destination` },
          });
        }
        if (url.pathname === "/v1/destination") {
          sameOriginDestinationHits++;
          return Response.json({ reached: true });
        }
        if (url.pathname === "/v1/loop") {
          loopHits++;
          return new Response(null, {
            status: 308,
            headers: { Location: `http://127.0.0.1:${source.port}/v1/loop` },
          });
        }
        return Response.json({ error: "not_found" }, { status: 404 });
      },
    });

    try {
      const transport = createHasnaHttpTransport({
        name: "redirect-regression",
        baseUrl: `http://127.0.0.1:${source.port}`,
        apiKey: API_KEY,
        retry: false,
      });

      await expect(transport.get("/same-origin")).rejects.toMatchObject({
        status: 307,
        method: "GET",
        path: "/same-origin",
      });
      expect(sameOriginDestinationHits).toBe(0);

      await expect(transport.get("/loop")).rejects.toMatchObject({
        status: 308,
        method: "GET",
        path: "/loop",
      });
      expect(loopHits).toBe(1);
    } finally {
      source.stop(true);
    }
  });

  test("redirect destinations are never interpreted or followed by the authenticated fetch", async () => {
    for (const location of [
      "https://redirect.customer.example/v1",
      "http://api.customer.example/v1",
      "https://user:password@redirect.customer.example/v1",
      "file:///tmp/redirect-target",
      "data:application/json,%7B%22reached%22%3Atrue%7D",
    ]) {
      const calls: Array<{ url: string; redirect: RequestRedirect | undefined }> = [];
      const transport = createHasnaHttpTransport({
        name: "redirect-regression",
        baseUrl: "https://api.customer.example/v1",
        apiKey: API_KEY,
        retry: false,
        fetchImpl: async (url, init) => {
          calls.push({ url, redirect: init?.redirect });
          return new Response(null, {
            status: 307,
            headers: { Location: location },
          });
        },
      });

      await expect(transport.get("/items")).rejects.toMatchObject({
        status: 307,
        method: "GET",
        path: "/items",
      });
      expect(calls).toEqual([
        {
          url: "https://api.customer.example/v1/items",
          redirect: "manual",
        },
      ]);
    }
  });

  test("redirect responses are never retried even when a caller lists their status", async () => {
    let hits = 0;
    const transport = createHasnaHttpTransport({
      name: "redirect-regression",
      baseUrl: "https://api.customer.example/v1",
      apiKey: API_KEY,
      fetchImpl: async () => {
        hits++;
        return new Response(null, {
          status: 307,
          headers: { Location: "https://redirect.customer.example/v1" },
        });
      },
      sleepImpl: async () => {},
    });

    await expect(
      transport.get("/items", {
        retry: { retries: 3, retryStatuses: [307] },
      }),
    ).rejects.toMatchObject({ status: 307 });
    expect(hits).toBe(1);
  });
});

describe("authenticated authority-header boundary", () => {
  const API_KEY = ["fixture", "authority", "value"].join("-");
  const forbiddenHeaders = [
    "Host",
    "hOsT",
    ":authority",
    "Forwarded",
    "X-Forwarded-Host",
    "X-Original-Host"
  ];

  test("default headers cannot override the validated request authority", async () => {
    for (const header of forbiddenHeaders) {
      let calls = 0;
      const transport = createHasnaHttpTransport({
        name: "authority-regression",
        baseUrl: "https://api.customer.example/v1",
        apiKey: API_KEY,
        headers: { [header]: "evil.example" },
        retry: false,
        fetchImpl: async () => {
          calls++;
          return Response.json({ ok: true });
        }
      });

      await expect(transport.get("/items")).rejects.toThrow(/authority header/i);
      expect(calls).toBe(0);
    }
  });

  test("per-call headers cannot override the validated request authority", async () => {
    for (const header of forbiddenHeaders) {
      let calls = 0;
      const transport = createHasnaHttpTransport({
        name: "authority-regression",
        baseUrl: "https://api.customer.example/v1",
        apiKey: API_KEY,
        retry: false,
        fetchImpl: async () => {
          calls++;
          return Response.json({ ok: true });
        }
      });

      await expect(
        transport.get("/items", { headers: { [header]: "evil.example" } })
      ).rejects.toThrow(/authority header/i);
      expect(calls).toBe(0);
    }
  });

  loopbackGate.test("real Bun HTTP routing never receives an authenticated Host override", async () => {
    const received: Array<{
      host: string | null;
      apiKey: string | null;
      authorization: string | null;
    }> = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        received.push({
          host: request.headers.get("host"),
          apiKey: request.headers.get("x-api-key"),
          authorization: request.headers.get("authorization")
        });
        return Response.json({ ok: true });
      }
    });

    try {
      const defaults = createHasnaHttpTransport({
        name: "authority-regression",
        baseUrl: `http://127.0.0.1:${server.port}`,
        apiKey: API_KEY,
        headers: { hOsT: "evil.example" },
        retry: false
      });
      await expect(defaults.get("/items")).rejects.toThrow(/authority header/i);

      const perCall = createHasnaHttpTransport({
        name: "authority-regression",
        baseUrl: `http://127.0.0.1:${server.port}`,
        apiKey: API_KEY,
        retry: false
      });
      await expect(
        perCall.get("/items", { headers: { Host: "evil.example" } })
      ).rejects.toThrow(/authority header/i);

      expect(received).toEqual([]);
    } finally {
      server.stop(true);
    }
  });
});
