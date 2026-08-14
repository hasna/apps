import { afterEach, describe, expect, test } from "bun:test";
import { TextIt, jsonPath } from "./index";
import { TextItClient } from "./client";

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function installFetch(handler: (recorded: Recorded) => unknown) {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const headers: Record<string, string> = {};
    if (init?.headers) {
      const h = init.headers;
      if (h instanceof Headers) {
        h.forEach((v, k) => {
          headers[k] = v;
        });
      } else if (Array.isArray(h)) {
        for (const [k, v] of h) headers[k] = v;
      } else {
        Object.assign(headers, h);
      }
    }
    const entry: Recorded = {
      url,
      method: init?.method ?? "GET",
      headers,
      body: typeof init?.body === "string" ? init.body : undefined,
    };
    recorded.push(entry);
    const json = handler(entry);
    return {
      ok: true,
      status: 200,
      statusText: "OK",
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

describe("jsonPath", () => {
  test("appends .json suffix", () => {
    expect(jsonPath("contacts")).toBe("/contacts.json");
    expect(jsonPath("/messages")).toBe("/messages.json");
  });

  test("preserves existing .json suffix", () => {
    expect(jsonPath("flows.json")).toBe("/flows.json");
  });
});

describe("TextItClient", () => {
  test("requires apiToken", () => {
    expect(() => new TextItClient({ apiToken: "" })).toThrow("apiToken is required");
  });

  test("sends Token authorization header", async () => {
    const recorded = installFetch((entry) => {
      expect(entry.headers.Authorization).toBe("Token test-token");
      return { results: [] };
    });
    const client = new TextItClient({ apiToken: "test-token" });
    await client.request("contacts");
    expect(recorded[0].url).toBe("https://textit.com/api/v2/contacts.json");
    expect(recorded[0].method).toBe("GET");
  });

  test("listContacts passes query params", async () => {
    const recorded = installFetch(() => ({ results: [] }));
    const textit = new TextIt({ apiToken: "tok" });
    await textit.listContacts({ page: 2, page_size: 50, query: "alice" });
    const url = new URL(recorded[0].url);
    expect(url.pathname).toBe("/api/v2/contacts.json");
    expect(url.searchParams.get("page")).toBe("2");
    expect(url.searchParams.get("page_size")).toBe("50");
    expect(url.searchParams.get("query")).toBe("alice");
  });

  test("createContact POSTs JSON body", async () => {
    const recorded = installFetch(() => ({ uuid: "c-1", name: "Alice" }));
    const textit = new TextIt({ apiToken: "tok" });
    await textit.createContact({ name: "Alice", urns: ["tel:+15551234567"] });
    expect(recorded[0].url).toContain("/contacts.json");
    expect(recorded[0].method).toBe("POST");
    expect(JSON.parse(recorded[0].body!)).toEqual({
      name: "Alice",
      urns: ["tel:+15551234567"],
    });
  });

  test("sendMessage POSTs to messages.json", async () => {
    const recorded = installFetch(() => ({ id: 1, text: "hi" }));
    const textit = new TextIt({ apiToken: "tok" });
    await textit.sendMessage({ urn: "tel:+15551234567", text: "hi" });
    expect(recorded[0].url).toContain("/messages.json");
    expect(recorded[0].method).toBe("POST");
    expect(JSON.parse(recorded[0].body!)).toEqual({
      urn: "tel:+15551234567",
      text: "hi",
    });
  });

  test("startFlow POSTs to flow_starts.json", async () => {
    const recorded = installFetch(() => ({ uuid: "fs-1" }));
    const textit = new TextIt({ apiToken: "tok" });
    await textit.startFlow({
      flow: "flow-uuid",
      contacts: ["contact-uuid"],
      restart_participants: true,
    });
    expect(recorded[0].url).toContain("/flow_starts.json");
    expect(recorded[0].method).toBe("POST");
    expect(JSON.parse(recorded[0].body!)).toEqual({
      flow: "flow-uuid",
      contacts: ["contact-uuid"],
      restart_participants: true,
    });
  });

  test("listFlows GETs flows.json", async () => {
    const recorded = installFetch(() => ({ results: [{ uuid: "f-1", name: "Welcome" }] }));
    const textit = new TextIt({ apiToken: "tok" });
    const flows = await textit.listFlows();
    expect(recorded[0].url).toContain("/flows.json");
    expect(flows.results[0]?.name).toBe("Welcome");
  });
});
