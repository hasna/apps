import { afterEach, describe, expect, test } from "bun:test";
import { ZoomApiClient } from "./client";

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
}

function installFetch(handler: (url: string, init: RequestInit | undefined, recorded: Recorded[]) => unknown) {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const headers: Record<string, string> = {};
    if (init?.headers) {
      if (init.headers instanceof Headers) {
        init.headers.forEach((value, key) => {
          headers[key] = value;
        });
      } else if (Array.isArray(init.headers)) {
        for (const [key, value] of init.headers) {
          headers[key] = value;
        }
      } else {
        Object.assign(headers, init.headers);
      }
    }
    recorded.push({ url, method: init?.method ?? "GET", headers, body: init?.body });
    const json = handler(url, init, recorded);
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers({ "content-type": "application/json" }),
      async text() {
        return JSON.stringify(json ?? {});
      },
    } as Response;
  }) as typeof fetch;
  return recorded;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("ZoomApiClient", () => {
  test("listItems calls GET /items with bearer auth", async () => {
    const recorded = installFetch(() => ({ items: [] }));
    const client = new ZoomApiClient({ apiKey: "zoom-api-key" });
    await client.listItems();
    expect(recorded[0].url).toBe("https://api.zoomapi.com/v1/items");
    expect(recorded[0].method).toBe("GET");
    expect(recorded[0].headers.Authorization).toBe("Bearer zoom-api-key");
  });

  test("getItem calls GET /items/:id", async () => {
    const recorded = installFetch(() => ({ id: "item-1" }));
    const client = new ZoomApiClient({ apiKey: "zoom-api-key" });
    await client.getItem("item-1");
    expect(recorded[0].url).toBe("https://api.zoomapi.com/v1/items/item-1");
    expect(recorded[0].headers.Authorization).toBe("Bearer zoom-api-key");
  });

  test("createItem posts JSON body to /items", async () => {
    const recorded = installFetch(() => ({ id: "new-item" }));
    const client = new ZoomApiClient({ apiKey: "zoom-api-key" });
    await client.createItem({ name: "widget" });
    expect(recorded[0].url).toBe("https://api.zoomapi.com/v1/items");
    expect(recorded[0].method).toBe("POST");
    expect(JSON.parse(recorded[0].body as string)).toEqual({ name: "widget" });
  });

  test("listEvents calls GET /events", async () => {
    const recorded = installFetch(() => ({ events: [] }));
    const client = new ZoomApiClient({ apiKey: "zoom-api-key" });
    await client.listEvents();
    expect(recorded[0].url).toBe("https://api.zoomapi.com/v1/events");
    expect(recorded[0].method).toBe("GET");
  });

  test("search posts JSON body to /search", async () => {
    const recorded = installFetch(() => ({ results: [] }));
    const client = new ZoomApiClient({ apiKey: "zoom-api-key" });
    await client.search({ query: "zoom" });
    expect(recorded[0].url).toBe("https://api.zoomapi.com/v1/search");
    expect(recorded[0].method).toBe("POST");
    expect(JSON.parse(recorded[0].body as string)).toEqual({ query: "zoom" });
  });

  test("rawRequest allows guarded paths under items/events/search", async () => {
    const recorded = installFetch(() => ({ ok: true }));
    const client = new ZoomApiClient({ apiKey: "zoom-api-key" });
    await client.rawRequest("GET", "/items/custom");
    expect(recorded[0].url).toBe("https://api.zoomapi.com/v1/items/custom");
  });

  test("rawRequest rejects paths outside guarded prefixes", async () => {
    const client = new ZoomApiClient({ apiKey: "zoom-api-key" });
    expect(() => client.rawRequest("GET", "/admin")).toThrow("limited to /items, /events, and /search");
  });

  test("requires api key for authenticated calls", async () => {
    const client = new ZoomApiClient();
    await expect(client.listItems()).rejects.toThrow("API key is required");
  });
});
