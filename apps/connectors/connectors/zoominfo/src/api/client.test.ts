import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { ZoomInfo, ZoomInfoApiError } from "../index";

const originalFetch = globalThis.fetch;
let fetchMock: ReturnType<typeof mock>;

function mockJsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...init.headers },
  });
}

function clientWithCredentials() {
  return new ZoomInfo({
    username: "api-user",
    password: "api-pass",
    baseUrl: "https://api.zoominfo.com",
  });
}

function clientWithJwt() {
  return new ZoomInfo({
    jwt: "configured-jwt-token",
    baseUrl: "https://custom.zoominfo.test",
  });
}

beforeEach(() => {
  fetchMock = mock(async () => mockJsonResponse({ success: true }));
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("ZoomInfoClient", () => {
  test("authenticates with username/password and caches JWT for subsequent calls", async () => {
    fetchMock = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/authenticate")) {
        return mockJsonResponse({ jwt: "fresh-jwt-token" });
      }
      if (url.endsWith("/search/contact")) {
        const headers = init?.headers as Record<string, string>;
        expect(headers.Authorization).toBe("Bearer fresh-jwt-token");
        return mockJsonResponse({ data: [{ id: "1" }] });
      }
      return mockJsonResponse({});
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const api = clientWithCredentials();
    const auth = await api.authenticate();
    expect(auth.jwt).toBe("fresh-jwt-token");

    await api.searchContacts({ jobTitle: ["VP of Sales"] });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [authUrl, authInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(authUrl).toBe("https://api.zoominfo.com/authenticate");
    expect(authInit.method).toBe("POST");
    expect(JSON.parse(String(authInit.body))).toEqual({ username: "api-user", password: "api-pass" });
  });

  test("configured JWT skips /authenticate on API calls", async () => {
    const api = clientWithJwt();

    await api.searchCompanies({ companyName: "Example Corp" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://custom.zoominfo.test/search/company");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer configured-jwt-token");
  });

  test("lookupContact uses bearer auth and encodes contact id", async () => {
    const api = clientWithJwt();

    await api.lookupContact("contact/id");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://custom.zoominfo.test/lookup/contact/contact%2Fid");
    expect(init.method).toBe("GET");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer configured-jwt-token");
  });

  test("enrichContact requires matchPersonInput", async () => {
    const api = clientWithJwt();

    await expect(api.enrichContact({ outputFields: ["email"] })).rejects.toThrow("matchPersonInput");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("enrichContact sends matchPersonInput payload", async () => {
    const api = clientWithJwt();
    const body = {
      matchPersonInput: [{ emailAddress: "person@example.com" }],
      outputFields: ["email", "jobTitle"],
    };

    await api.enrichContact(body);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual(body);
  });

  test("lists contact and company search output fields", async () => {
    const api = clientWithJwt();

    await api.listContactSearchOutputFields();
    await api.listCompanySearchOutputFields();

    const urls = (fetchMock.mock.calls as [string, RequestInit][]).map(([url]) => url);
    expect(urls).toEqual([
      "https://custom.zoominfo.test/lookup/outputfields/contact/search",
      "https://custom.zoominfo.test/lookup/outputfields/company/search",
    ]);
  });

  test("rawRequest rejects absolute URLs and path traversal", async () => {
    const api = clientWithJwt();

    await expect(api.rawRequest("GET", "https://evil.example/search/contact")).rejects.toThrow("absolute URLs");
    await expect(api.rawRequest("GET", "/search/../admin")).rejects.toThrow("path traversal");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("throws ZoomInfoApiError on HTTP failures", async () => {
    fetchMock = mock(async () => mockJsonResponse({ message: "Unauthorized" }, { status: 401 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const api = clientWithJwt();

    await expect(api.searchContacts()).rejects.toBeInstanceOf(ZoomInfoApiError);
  });
});
