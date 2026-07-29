/**
 * Regression for todos task 90c0b178: `todos list --tags <tag>` is documented in
 * `--help` but the hosted /v1 route rejected it with REMOTE_COMMAND_UNSUPPORTED —
 * and the refusal named the *tag value* as though it were a subcommand ("list
 * <tag> is not supported"), because the stage-A invocation label consumed the
 * option's value positionally. The tags filter is serviced remotely now:
 * stage-A admits it, the cloud router maps `filter.tags` onto the `tags` query
 * param, and authorities that predate tags filtering get a typed refusal (never
 * a silently unfiltered list).
 */
import { afterEach, describe, expect, test } from "bun:test";
import { cloudListTasks, getTodosCloudClient, resetTodosCloudClient } from "./cloud-router.js";
import { initializeTodosCliAuthority } from "./stage-a.js";

const HTTP_ENV = {
  HASNA_TODOS_STORAGE_MODE: "remote",
  HASNA_TODOS_API_URL: "https://todos.example.test",
  HASNA_TODOS_API_KEY: "hasna_todos_test_key",
};

type Call = { url: string; method: string };

let previousFetch: typeof globalThis.fetch | undefined;

function installFetch(handler: (call: Call) => { status?: number; body?: unknown }): Call[] {
  previousFetch ??= globalThis.fetch;
  const calls: Call[] = [];
  (globalThis as unknown as { fetch: unknown }).fetch = async (input: unknown, init: { method?: string } = {}) => {
    const url = typeof input === "string" ? input : (input as { url: string }).url;
    const call: Call = { url, method: init.method ?? "GET" };
    calls.push(call);
    const result = handler(call);
    return new Response(JSON.stringify(result.body ?? {}), {
      status: result.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  return calls;
}

afterEach(() => {
  if (previousFetch) {
    globalThis.fetch = previousFetch;
    previousFetch = undefined;
  }
  resetTodosCloudClient();
});

function openApiDocument(withTagsParam: boolean): Record<string, unknown> {
  return {
    openapi: "3.0.3",
    paths: {
      "/v1/tasks": {
        get: {
          parameters: [
            { name: "status", in: "query", schema: { type: "string" } },
            ...(withTagsParam ? [{ name: "tags", in: "query", schema: { type: "string" } }] : []),
          ],
        },
      },
    },
  };
}

describe("remote tags filtering (task 90c0b178)", () => {
  test("stage-A admits `list --tags <tag>` on the http transport", () => {
    const init = initializeTodosCliAuthority(["list", "--tags", "modes-simplify"], HTTP_ENV);
    expect(init.route).toBe("remote-http");
  });

  test("stage-A admits the --tag alias too", () => {
    const init = initializeTodosCliAuthority(["list", "--tag", "modes-simplify"], HTTP_ENV);
    expect(init.route).toBe("remote-http");
  });

  test("cloudListTasks maps filter.tags onto the tags query param when the authority advertises it", async () => {
    const calls = installFetch((call) => {
      if (call.url.includes("/openapi.json")) return { body: openApiDocument(true) };
      return { body: { tasks: [], count: 0, total: 0 } };
    });
    const client = getTodosCloudClient(HTTP_ENV)!;
    expect(client).not.toBeNull();
    await cloudListTasks(client, { tags: ["modes-simplify", "oss"] } as never);
    const listCall = calls.find((call) => call.url.includes("/v1/tasks?") || call.url.endsWith("/v1/tasks"));
    expect(listCall).toBeDefined();
    const url = new URL(listCall!.url);
    expect(url.searchParams.get("tags")).toBe("modes-simplify,oss");
  });

  test("an authority that predates tags filtering gets a typed refusal, not an unfiltered list", async () => {
    const calls = installFetch((call) => {
      if (call.url.includes("/openapi.json")) return { body: openApiDocument(false) };
      return { body: { tasks: [{ id: "t1" }], count: 1, total: 1 } };
    });
    const client = getTodosCloudClient(HTTP_ENV)!;
    let message = "";
    try {
      await cloudListTasks(client, { tags: ["modes-simplify"] } as never);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("REMOTE_TAGS_FILTER_UNSUPPORTED");
    // The refusal must name the real condition — never the tag value as a command.
    expect(message).not.toContain("REMOTE_COMMAND_UNSUPPORTED");
    // No task read may have been issued with a silently dropped filter.
    expect(calls.some((call) => call.url.includes("/v1/tasks?") && !call.url.includes("openapi"))).toBe(false);
  });

  test("tag-less list requests skip the capability preflight entirely", async () => {
    const calls = installFetch((call) => {
      if (call.url.includes("/openapi.json")) throw new Error("preflight must not run");
      return { body: { tasks: [], count: 0, total: 0 } };
    });
    const client = getTodosCloudClient(HTTP_ENV)!;
    await cloudListTasks(client, {});
    expect(calls.some((call) => call.url.includes("openapi"))).toBe(false);
  });
});
