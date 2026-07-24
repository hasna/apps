import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { ZymblyClient, ZymblyApiError } from "../index";

const originalFetch = globalThis.fetch;
let fetchMock: ReturnType<typeof mock>;

function mockJsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...init.headers },
  });
}

function client() {
  return new ZymblyClient({
    apiKey: "test-api-key",
    baseUrl: "https://api.zymbly.com/v1",
  });
}

beforeEach(() => {
  fetchMock = mock(async () => mockJsonResponse({ ok: true }));
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("ZymblyClient", () => {
  test("lists work orders with bearer auth and query params", async () => {
    const api = client();

    await api.listWorkOrders({ status: "open", limit: 25 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.zymbly.com/v1/work-orders?status=open&limit=25");
    expect(init.method).toBe("GET");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-api-key");
  });

  test("gets a work order with URL-encoded id", async () => {
    const api = client();

    await api.getWorkOrder("WO/2026-01");

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.zymbly.com/v1/work-orders/WO%2F2026-01");
  });

  test("searches parts with query passthrough", async () => {
    const api = client();

    await api.searchParts({ q: "brake pad", aircraft: "N12345" });

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.zymbly.com/v1/parts?q=brake+pad&aircraft=N12345");
  });

  test("creates a maintenance note with note body field", async () => {
    const api = client();

    await api.createMaintenanceNote("wo-42", "Replaced left main tire");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.zymbly.com/v1/work-orders/wo-42/notes");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ note: "Replaced left main tire" }));
  });

  test("supports raw relative API paths", async () => {
    const api = client();

    await api.rawRequest("GET", "/aircraft/N12345/inspections");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.zymbly.com/v1/aircraft/N12345/inspections");
    expect(init.method).toBe("GET");
  });

  test("rejects absolute URLs and path traversal in raw requests", async () => {
    const api = client();

    expect(() => api.rawRequest("GET", "https://evil.example/v1/work-orders")).toThrow(
      "Zymbly API paths must be relative",
    );
    expect(() => api.rawRequest("GET", "/work-orders/../secrets")).toThrow(
      "parent-directory segments",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("surfaces API error messages", async () => {
    fetchMock = mock(async () =>
      mockJsonResponse({ message: "invalid api key" }, { status: 401 }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(client().listWorkOrders()).rejects.toThrow(ZymblyApiError);
    await expect(client().listWorkOrders()).rejects.toThrow("invalid api key");
  });

  test("requires API key before sending requests", async () => {
    const api = new ZymblyClient({ apiKey: "" });

    await expect(api.listWorkOrders()).rejects.toThrow("Zymbly API key is required");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
