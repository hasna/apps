import { afterEach, describe, expect, mock, test } from "bun:test";
import { Stage } from "./index";
import { StageApiError } from "../types";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("Stage reviews API", () => {
  test("lists reviews against the default base URL with a bearer token", async () => {
    const fetchMock = mock(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({ data: [{ id: "rev_1", title: "Add feature" }] })
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const stage = new Stage({ apiKey: "sk_test_key" });
    const result = await stage.reviews.list({ status: "open", limit: 5 });

    expect(result.data[0]?.id).toBe("rev_1");

    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toStartWith("https://api.stage.dev/v1/reviews?");
    expect(url).toContain("status=open");
    expect(url).toContain("limit=5");

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(request.method).toBe("GET");
    expect((request.headers as Record<string, string>).Authorization).toBe(
      "Bearer sk_test_key"
    );
  });

  test("gets a single review by id", async () => {
    const fetchMock = mock(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({ id: "rev_42", title: "Refactor" })
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const stage = new Stage({ apiKey: "sk_test_key" });
    const review = await stage.reviews.get("rev_42");

    expect(review.id).toBe("rev_42");
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://api.stage.dev/v1/reviews/rev_42"
    );
  });

  test("creates a comment with a JSON body", async () => {
    const fetchMock = mock(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({ id: "cmt_1", review_id: "rev_1", body: "Looks good" })
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const stage = new Stage({ apiKey: "sk_test_key" });
    await stage.reviews.createComment({
      reviewId: "rev_1",
      body: "Looks good",
      path: "src/app.ts",
      line: 10,
    });

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://api.stage.dev/v1/reviews/rev_1/comments"
    );
    expect(request.method).toBe("POST");
    expect((request.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json"
    );
    expect(JSON.parse(String(request.body))).toMatchObject({
      body: "Looks good",
      path: "src/app.ts",
      line: 10,
    });
  });

  test("honors a custom base URL override", async () => {
    const fetchMock = mock(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({ data: [] }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const stage = new Stage({
      apiKey: "sk_test_key",
      baseUrl: "https://stage.example.com/api/",
    });
    await stage.pullRequests.list();

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://stage.example.com/api/pull-requests"
    );
  });

  test("throws a StageApiError on a non-2xx response", async () => {
    const fetchMock = mock(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({ message: "Not found" }, { status: 404 })
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const stage = new Stage({ apiKey: "sk_test_key" });

    await expect(stage.reviews.get("missing")).rejects.toBeInstanceOf(
      StageApiError
    );
  });
});
