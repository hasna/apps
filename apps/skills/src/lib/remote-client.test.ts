import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  RemoteRequestError,
  RemoteRouteUnsupportedError,
  RemoteSkillsClient,
} from "./remote-client.js";

import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

/**
 * T10 — unit tests for the RemoteSkillsClient sync/pin/tag methods, against a
 * mocked fetch acting as a stand-in Skills server. Each test proves the method
 * calls the expected route (method + path + query) and that a server which
 * lacks a new route (404/405) surfaces an explicit unsupported error instead of
 * a silent fallback (fail-closed version-skew guard).
 */

interface CapturedCall {
  url: string;
  init?: RequestInit;
}

const originalFetch = globalThis.fetch;

function mockServer(handler: (call: CapturedCall) => Promise<Response>): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init });
    return handler({ url, init });
  }) as typeof fetch;
}

let calls: CapturedCall[] = [];

beforeEach(() => {
  calls = [];
});

afterEach(() => {
  // Restore the real fetch so later suites are unaffected.
  globalThis.fetch = originalFetch;
});

function client(): RemoteSkillsClient {
  return new RemoteSkillsClient("test-key", "https://skills.example.test");
}

function jsonResponse(payload: unknown, status = 200): Response {
  return Response.json(payload, { status });
}

describe("RemoteSkillsClient pin/tag/updated-since methods", () => {
  test("listPins calls GET /api/v1/pins and maps the pin list", async () => {
    mockServer(async () =>
      jsonResponse([
        { slug: "pdf-generate", pinnedAt: "2026-08-01T00:00:00.000Z", metadata: { team: "docs" }, extra: "ignored" },
        { slug: "read-image" },
      ]),
    );

    const pins = await client().listPins();

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://skills.example.test/api/v1/pins");
    expect(calls[0].init?.method ?? "GET").toBe("GET");
    expect(pins).toEqual([
      { slug: "pdf-generate", pinnedAt: "2026-08-01T00:00:00.000Z", metadata: { team: "docs" } },
      { slug: "read-image", pinnedAt: undefined, metadata: undefined },
    ]);
  });

  test("pin calls PUT /api/v1/pins/:slug with the metadata body and returns the pin", async () => {
    mockServer(async () =>
      jsonResponse({
        slug: "pdf-generate",
        pinnedAt: "2026-08-01T00:00:00.000Z",
        metadata: { team: "docs", owner: "driver" },
      }),
    );

    const pinned = await client().pin("pdf-generate", { team: "docs", owner: "driver" });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://skills.example.test/api/v1/pins/pdf-generate");
    expect(calls[0].init?.method).toBe("PUT");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ metadata: { team: "docs", owner: "driver" } });
    expect(pinned.slug).toBe("pdf-generate");
    expect(pinned.metadata).toEqual({ team: "docs", owner: "driver" });
  });

  test("pin without metadata sends an empty body per the hosted-pins contract", async () => {
    mockServer(async () => jsonResponse({ slug: "pdf-generate" }));

    await client().pin("pdf-generate");

    expect(JSON.parse(String(calls[0].init?.body))).toEqual({});
  });

  test("pin encodes the slug into the path", async () => {
    mockServer(async () => jsonResponse({ slug: "weird/slug" }));

    await client().pin("weird/slug");

    expect(calls[0].url).toBe("https://skills.example.test/api/v1/pins/weird%2Fslug");
  });

  test("unpin calls DELETE /api/v1/pins/:slug and resolves true when a pin existed", async () => {
    mockServer(async () => jsonResponse({ deleted: true, slug: "pdf-generate" }));

    await expect(client().unpin("pdf-generate")).resolves.toBe(true);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://skills.example.test/api/v1/pins/pdf-generate");
    expect(calls[0].init?.method).toBe("DELETE");
  });

  test("unpin resolves false on the hosted-pins PIN_NOT_FOUND 404 (domain answer, not version skew)", async () => {
    mockServer(async () => jsonResponse({ error: "pin not found", code: "PIN_NOT_FOUND" }, 404));

    await expect(client().unpin("pdf-generate")).resolves.toBe(false);
  });

  test("unpin surfaces RemoteRouteUnsupportedError on a 404 carrying any other code", async () => {
    mockServer(async () => jsonResponse({ error: "not found", code: "NOT_FOUND" }, 404));

    const error = await client().unpin("pdf-generate").then(
      () => null,
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(RemoteRouteUnsupportedError);
  });

  test("listTags calls GET /api/v1/tags and returns tag names", async () => {
    mockServer(async () => jsonResponse(["audio", "pdf", "image"]));

    const tags = await client().listTags();

    expect(calls[0].url).toBe("https://skills.example.test/api/v1/tags");
    expect(tags).toEqual(["audio", "pdf", "image"]);
  });

  test("skillsByTag calls GET /api/v1/tags/:tag/skills and maps the list", async () => {
    mockServer(async () =>
      jsonResponse([{ slug: "transcribe", name: "Transcribe", version: "0.3.0", updatedAt: "2026-08-02T00:00:00.000Z" }]),
    );

    const skills = await client().skillsByTag("audio");

    expect(calls[0].url).toBe("https://skills.example.test/api/v1/tags/audio/skills");
    expect(skills[0].slug).toBe("transcribe");
    expect(skills[0].updatedAt).toBe("2026-08-02T00:00:00.000Z");
  });

  test("listUpdatedSince calls the cursor route with since/cursor/limit", async () => {
    mockServer(async () =>
      jsonResponse({
        skills: [{ slug: "transcribe", updatedAt: "2026-08-02T00:00:00.000Z" }],
        nextCursor: "opaque-cursor-2",
      }),
    );

    const page = await client().listUpdatedSince("2026-08-01T00:00:00.000Z", {
      cursor: "opaque-cursor-1",
      limit: 25,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      "https://skills.example.test/api/v1/skills/updated?since=2026-08-01T00%3A00%3A00.000Z&cursor=opaque-cursor-1&limit=25",
    );
    expect(page.skills).toHaveLength(1);
    expect(page.skills[0].slug).toBe("transcribe");
    expect(page.nextCursor).toBe("opaque-cursor-2");
  });

  test("listUpdatedSince treats an absent nextCursor as complete (null)", async () => {
    mockServer(async () => jsonResponse({ skills: [] }));

    const page = await client().listUpdatedSince("2026-08-01T00:00:00.000Z");

    expect(page.skills).toEqual([]);
    expect(page.nextCursor).toBeNull();
  });

  test("every new method sends the bearer credential", async () => {
    mockServer(async ({ url }) => {
      if (url.includes("/api/v1/pins")) return jsonResponse([]);
      return jsonResponse({ skills: [] });
    });

    await client().listUpdatedSince("2026-08-01T00:00:00.000Z");
    await client().listPins();

    for (const call of calls) {
      const headers = new Headers(call.init?.headers);
      expect(headers.get("Authorization")).toBe("Bearer test-key");
    }
  });
});

describe("version-skew guard — a server without the new routes fails closed", () => {
  test("listPins surfaces RemoteRouteUnsupportedError on 404", async () => {
    mockServer(async () => new Response("not found", { status: 404 }));

    const error = await client().listPins().then(
      () => null,
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(RemoteRouteUnsupportedError);
    expect((error as RemoteRouteUnsupportedError).path).toBe("/api/v1/pins");
    expect((error as RemoteRouteUnsupportedError).status).toBe(404);
    expect((error as Error).message).toContain("/api/v1/pins");
  });

  test("pin surfaces RemoteRouteUnsupportedError on 404", async () => {
    mockServer(async () => new Response("not found", { status: 404 }));

    const error = await client().pin("pdf-generate").then(
      () => null,
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(RemoteRouteUnsupportedError);
    expect((error as RemoteRouteUnsupportedError).path).toBe("/api/v1/pins/pdf-generate");
  });

  test("unpin surfaces RemoteRouteUnsupportedError on 404 and never resolves silently", async () => {
    mockServer(async () => new Response("not found", { status: 404 }));

    const error = await client().unpin("pdf-generate").then(
      () => null,
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(RemoteRouteUnsupportedError);
  });

  test("listTags surfaces RemoteRouteUnsupportedError on 404", async () => {
    mockServer(async () => new Response("not found", { status: 404 }));

    const error = await client().listTags().then(
      () => null,
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(RemoteRouteUnsupportedError);
  });

  test("skillsByTag surfaces RemoteRouteUnsupportedError on 404", async () => {
    mockServer(async () => new Response("not found", { status: 404 }));

    const error = await client().skillsByTag("audio").then(
      () => null,
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(RemoteRouteUnsupportedError);
  });

  test("listUpdatedSince surfaces RemoteRouteUnsupportedError on 404", async () => {
    mockServer(async () => new Response("not found", { status: 404 }));

    const error = await client().listUpdatedSince("2026-08-01T00:00:00.000Z").then(
      () => null,
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(RemoteRouteUnsupportedError);
    expect((error as RemoteRouteUnsupportedError).path).toBe("/api/v1/skills/updated");
  });

  test("a 405 also counts as route-unsupported (method not deployed)", async () => {
    mockServer(async () => new Response("method not allowed", { status: 405 }));

    const error = await client().pin("pdf-generate").then(
      () => null,
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(RemoteRouteUnsupportedError);
  });
});

describe("error mapping — other failures surface as RemoteRequestError", () => {
  test("401 surfaces RemoteRequestError with the status", async () => {
    mockServer(async () => new Response("unauthorized", { status: 401, statusText: "Unauthorized" }));

    const error = await client().listPins().then(
      () => null,
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(RemoteRequestError);
    expect((error as RemoteRequestError).status).toBe(401);
  });

  test("500 surfaces RemoteRequestError with the status", async () => {
    mockServer(async () => new Response("boom", { status: 500 }));

    const error = await client().listTags().then(
      () => null,
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(RemoteRequestError);
    expect((error as RemoteRequestError).status).toBe(500);
  });
});

describe("payload contract — malformed success payloads fail closed", () => {
  test("listTags rejects a non-array payload", async () => {
    mockServer(async () => jsonResponse({ tags: ["audio"] }));

    await expect(client().listTags()).rejects.toThrow(/did not match the expected contract/);
  });

  test("listTags rejects malformed elements instead of filtering them", async () => {
    mockServer(async () => jsonResponse(["audio", 42, ""]));

    await expect(client().listTags()).rejects.toThrow(/every element must be a non-empty tag name/);
  });

  test("pin rejects a wrong-typed pinnedAt instead of dropping it", async () => {
    mockServer(async () => jsonResponse({ slug: "pdf-generate", pinnedAt: 42 }));

    await expect(client().pin("pdf-generate")).rejects.toThrow(/pinnedAt must be a string/);
  });

  test("pin rejects a non-object metadata field", async () => {
    mockServer(async () => jsonResponse({ slug: "pdf-generate", metadata: "team" }));

    await expect(client().pin("pdf-generate")).rejects.toThrow(/metadata must be a JSON object/);
  });

  test("skillsByTag rejects a wrong-typed updatedAt instead of dropping it", async () => {
    mockServer(async () => jsonResponse([{ slug: "transcribe", updatedAt: 42 }]));

    await expect(client().skillsByTag("audio")).rejects.toThrow(/updatedAt must be a string/);
  });

  test("listPins rejects a non-array payload", async () => {
    mockServer(async () => jsonResponse({ pins: [] }));

    await expect(client().listPins()).rejects.toThrow(/did not match the expected contract/);
  });

  test("listUpdatedSince rejects a payload without a skills array", async () => {
    mockServer(async () => jsonResponse({ data: [] }));

    await expect(client().listUpdatedSince("2026-08-01T00:00:00.000Z")).rejects.toThrow(
      /did not match the expected contract/,
    );
  });

  test("listUpdatedSince rejects a non-string nextCursor", async () => {
    mockServer(async () => jsonResponse({ skills: [], nextCursor: 42 }));

    await expect(client().listUpdatedSince("2026-08-01T00:00:00.000Z")).rejects.toThrow(
      /did not match the expected contract/,
    );
  });
});
