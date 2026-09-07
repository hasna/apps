import { describe, expect, it } from "bun:test";
import { resolveFilesCloudStorage, filesLocalModeNotice } from "./cloud-storage.js";
import { FILES_LOCAL_OPT_IN_ENV_KEYS, isFilesLocalOptIn, selectsFilesLocalStore } from "./local-opt-in.js";

const KEY = "hasna_files_testkey_00000000000";

describe("files local opt-in (HASNA_FILES_LOCAL, ex-*_MODE switches)", () => {
  it("uses only the documented opt-in names (no *_MODE leftovers)", () => {
    expect(FILES_LOCAL_OPT_IN_ENV_KEYS).toEqual(["HASNA_FILES_LOCAL", "FILES_LOCAL"]);
    expect(isFilesLocalOptIn({ HASNA_FILES_LOCAL_MODE: "1" })).toBe(false);
    expect(isFilesLocalOptIn({ FILES_LOCAL_MODE: "1" })).toBe(false);
    expect(isFilesLocalOptIn({ HASNA_FILES_LOCAL: "1" })).toBe(true);
    expect(isFilesLocalOptIn({ FILES_LOCAL: "1" })).toBe(true);
  });

  it("never selects local when the environment configures an authority (configured wins)", () => {
    expect(selectsFilesLocalStore({ HASNA_FILES_LOCAL: "1", HASNA_FILES_API_URL: "https://files.md", HASNA_FILES_API_KEY: KEY })).toBe(false);
  });
});

describe("resolveFilesCloudStorage — resolver-selection contract", () => {
  it("fails closed (throws) when nothing is configured — no silent local fallback", () => {
    expect(() => resolveFilesCloudStorage({})).toThrow(/REMOTE_API_CONFIG_MISSING/);
    expect(() => resolveFilesCloudStorage({})).toThrow(/HASNA_FILES_API_URL/);
    expect(() => resolveFilesCloudStorage({})).toThrow(/no local fallback/);
  });

  it("fails closed (throws) when the API URL and key are blank", () => {
    expect(() =>
      resolveFilesCloudStorage({
        HASNA_FILES_API_URL: "  ",
        HASNA_FILES_API_KEY: "  ",
      }),
    ).toThrow(/REMOTE_API_CONFIG_MISSING/);
  });

  it("fails closed when a declared key is blank (blank means unset at the files seam)", () => {
    expect(() =>
      resolveFilesCloudStorage({
        HASNA_FILES_API_URL: "https://files.md",
        HASNA_FILES_API_KEY: "  ",
      }),
    ).toThrow(/REMOTE_API_CONFIG_MISSING/);
    expect(() =>
      resolveFilesCloudStorage({
        HASNA_FILES_API_URL: "https://files.md",
        HASNA_FILES_API_KEY: "  ",
      }),
    ).toThrow(/no API key could be resolved/);
  });

  it("is inactive (local) only when the explicit local opt-in is set", () => {
    const r = resolveFilesCloudStorage({ HASNA_FILES_LOCAL: "1" });
    expect(r.active).toBe(false);
    expect(r.client).toBeNull();
  });

  it("honours the unprefixed local opt-in alias", () => {
    const r = resolveFilesCloudStorage({ FILES_LOCAL: "true" });
    expect(r.active).toBe(false);
  });

  it("rejects falsy local opt-in values as no opt-in at all", () => {
    expect(() =>
      resolveFilesCloudStorage({ HASNA_FILES_LOCAL: "0" }),
    ).toThrow(/REMOTE_API_CONFIG_MISSING/);
  });

  it("is active and targets <origin>/v1 when the canonical API_URL + API_KEY are both set", () => {
    const r = resolveFilesCloudStorage({
      HASNA_FILES_API_URL: "https://files.md",
      HASNA_FILES_API_KEY: KEY,
    });
    expect(r.active).toBe(true);
    expect(r.client).not.toBeNull();
    expect(r.client!.baseUrl).toBe("https://files.md/v1");
    expect(r.client!.name).toBe("files");
  });

  it("honours the unprefixed url/key aliases (resolver-owned), and refuses a conflicting alias", () => {
    const r = resolveFilesCloudStorage({
      FILES_API_URL: "https://files.md",
      FILES_API_KEY: KEY,
    });
    expect(r.active).toBe(true);
    expect(r.client!.baseUrl).toBe("https://files.md/v1");
    // The resolver refuses aliases that disagree instead of silently choosing.
    expect(() =>
      resolveFilesCloudStorage({
        HASNA_FILES_API_URL: "https://canonical.example.test",
        FILES_API_URL: "https://legacy.example.test",
        HASNA_FILES_API_KEY: KEY,
      }),
    ).toThrow(/disagree/);
  });

  it("throws when only the API URL is set (fail-closed, no silent local fallback)", () => {
    expect(() =>
      resolveFilesCloudStorage({ HASNA_FILES_API_URL: "https://files.md" }),
    ).toThrow(/no API key could be resolved/);
  });

  it("resolves the fleet gateway when only a key is set (a key alone is complete)", () => {
    const r = resolveFilesCloudStorage({ HASNA_FILES_API_KEY: KEY });
    expect(r.active).toBe(true);
    expect(r.client!.baseUrl).toBe("https://api.hasna.com/files/v1");
  });

  it("routes list/create/delete to <origin>/v1/sources with the bearer key", async () => {
    const calls: { url: string; method: string; bearer: string | null; xKey: string | null }[] = [];
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      const method = init?.method ?? "GET";
      calls.push({ url, method, bearer: headers.get("authorization"), xKey: headers.get("x-api-key") });
      if (method === "GET") {
        return new Response(JSON.stringify([{ id: "src_1", name: "x" }]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (method === "POST") {
        return new Response(JSON.stringify({ id: "src_2", name: "y" }), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;

    const r = resolveFilesCloudStorage(
      {
        HASNA_FILES_API_URL: "https://files.md",
        HASNA_FILES_API_KEY: KEY,
      },
      { fetchImpl: fakeFetch },
    );
    expect(r.active).toBe(true);

    const listed = await r.client!.list("sources");
    expect(listed.items.length).toBe(1);
    const created = await r.client!.create<{ id: string }>("sources", { name: "y", type: "local" });
    expect(created.id).toBe("src_2");
    await r.client!.delete("sources", "src_2");

    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      "GET https://files.md/v1/sources",
      "POST https://files.md/v1/sources",
      "DELETE https://files.md/v1/sources/src_2",
    ]);
    expect(calls.every((c) => c.bearer === `Bearer ${KEY}`)).toBe(true);
    expect(calls.every((c) => c.xKey === KEY)).toBe(true);
  });

  it("routes the REAL dataset (files) list to <origin>/v1/files with query params + bearer key", async () => {
    const calls: { url: string; method: string; auth: string | null }[] = [];
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      calls.push({ url, method: init?.method ?? "GET", auth: headers.get("authorization") });
      // The server returns a bare array of FileWithTags; the client extracts items.
      return new Response(JSON.stringify([{ id: "f_1", name: "a.txt", path: "/a.txt", size: 3, tags: [] }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const r = resolveFilesCloudStorage(
      {
        HASNA_FILES_API_URL: "https://files.md",
        HASNA_FILES_API_KEY: KEY,
      },
      { fetchImpl: fakeFetch },
    );
    expect(r.active).toBe(true);

    const listed = await r.client!.list<{ id: string }>("files", {
      query: { source_id: "src_1", ext: "txt", limit: 50, offset: 0 },
    });
    expect(listed.items.length).toBe(1);
    expect(listed.items[0]!.id).toBe("f_1");

    expect(calls.length).toBe(1);
    expect(calls[0]!.method).toBe("GET");
    // Base path + all query params must be present on the hosted request.
    expect(calls[0]!.url).toContain("https://files.md/v1/files");
    expect(calls[0]!.url).toContain("source_id=src_1");
    expect(calls[0]!.url).toContain("ext=txt");
    expect(calls[0]!.url).toContain("limit=50");
    expect(calls[0]!.auth).toBe(`Bearer ${KEY}`);
  });

  it("fetchContent sends x-api-key + bearer on the raw path", async () => {
    const calls: { url: string; headers: Headers }[] = [];
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url, headers: new Headers(init?.headers) });
      return new Response("bytes", { status: 200 });
    }) as unknown as typeof fetch;

    const r = resolveFilesCloudStorage(
      {
        HASNA_FILES_API_URL: "https://files.md",
        HASNA_FILES_API_KEY: KEY,
      },
      { fetchImpl: fakeFetch },
    );
    const response = await r.fetchContent!("/files/f_1/content");
    expect(await response.text()).toBe("bytes");
    expect(calls[0]!.url).toBe("https://files.md/v1/files/f_1/content");
    expect(calls[0]!.headers.get("x-api-key")).toBe(KEY);
    expect(calls[0]!.headers.get("authorization")).toBe(`Bearer ${KEY}`);
  });

  it("reports the local-mode notice with the opt-in name on stderr", () => {
    expect(filesLocalModeNotice()).toContain("LOCAL mode");
    expect(filesLocalModeNotice()).toContain("HASNA_FILES_LOCAL");
  });
});