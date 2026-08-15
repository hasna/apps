import { describe, expect, it, test } from "bun:test";
import {
  filesCloudEnv,
  resolveFilesCloudStorage,
  serverStorageMode,
  SERVER_MODE_CANDIDATES,
} from "./cloud-storage.js";

const KEY = "hasna_files_testkey_00000000000";

describe("resolveFilesCloudStorage", () => {
  it("is inactive (local) when no mode/env is set", () => {
    const r = resolveFilesCloudStorage({});
    expect(r.active).toBe(false);
    expect(r.client).toBeNull();
  });

  it("is inactive when mode is local even with API_URL + API_KEY", () => {
    const r = resolveFilesCloudStorage({
      HASNA_FILES_STORAGE_MODE: "local",
      HASNA_FILES_API_URL: "https://files.md",
      HASNA_FILES_API_KEY: KEY,
    });
    expect(r.active).toBe(false);
  });

  it("throws when mode=self_hosted but the API key is missing (no silent local drift)", () => {
    expect(() =>
      resolveFilesCloudStorage({
        HASNA_FILES_STORAGE_MODE: "self_hosted",
        HASNA_FILES_API_URL: "https://files.md",
      }),
    ).toThrow();
  });

  it("is active and targets <origin>/v1 when mode=self_hosted + API_URL + API_KEY", () => {
    const r = resolveFilesCloudStorage({
      HASNA_FILES_STORAGE_MODE: "self_hosted",
      HASNA_FILES_API_URL: "https://files.md",
      HASNA_FILES_API_KEY: KEY,
    });
    expect(r.active).toBe(true);
    expect(r.client).not.toBeNull();
    expect(r.client!.baseUrl).toBe("https://files.md/v1");
    expect(r.client!.name).toBe("files");
  });

  it("routes list/create/delete to <origin>/v1/sources with the bearer key", async () => {
    const calls: { url: string; method: string; auth: string | null }[] = [];
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      const method = init?.method ?? "GET";
      calls.push({ url, method, auth: headers.get("authorization") });
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
        HASNA_FILES_STORAGE_MODE: "self_hosted",
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
    expect(calls.every((c) => c.auth === `Bearer ${KEY}`)).toBe(true);
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
        HASNA_FILES_STORAGE_MODE: "self_hosted",
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
    // Base path + all query params must be present on the cloud request.
    expect(calls[0]!.url).toContain("https://files.md/v1/files");
    expect(calls[0]!.url).toContain("source_id=src_1");
    expect(calls[0]!.url).toContain("ext=txt");
    expect(calls[0]!.url).toContain("limit=50");
    expect(calls[0]!.auth).toBe(`Bearer ${KEY}`);
  });
});

// ── Explicit mode pinning ────────────────────────────────────────────────────
//
// The client must hand `resolveStorageClient` an env whose mode is PINNED, never
// rely on the contracts resolver inferring cloud from the mere presence of an API
// URL + key pair.
//
// hasna/contracts#51 removes that inference under an owner ruling (2026-07-29):
// a local->network transition must be explicitly signalled, never inferred. After
// it lands, a consumer that passes `process.env` straight through gets the local
// SQLite store for a fully-configured cloud client — silently, at exit 0.
//
// Measured 2026-07-30: of the 5 repos importing the contracts client at runtime,
// `domains`, `logs` and `todos` already pin. `files` and `sessions` did not, and
// were the two that #51 would strand. This pins `files`.

describe("filesCloudEnv", () => {
  const URL_VAR = "HASNA_FILES_API_URL";
  const KEY_VAR = "HASNA_FILES_API_KEY";
  const MODE_VAR = "HASNA_FILES_STORAGE_MODE";
  const API_URL = "https://files.md";
  /** Not a credential: a deliberately invalid stub. */
  const FAKE_KEY = ["files", "FAKE", "NOT", "A", "REAL", "KEY"].join("_");

  test("pins self_hosted when an API url and key are present and no mode is set", () => {
    const env = filesCloudEnv({ [URL_VAR]: API_URL, [KEY_VAR]: FAKE_KEY });

    expect(env[MODE_VAR]).toBe("self_hosted");
  });

  test("honours the unprefixed url/key aliases", () => {
    const env = filesCloudEnv({ FILES_API_URL: API_URL, FILES_API_KEY: FAKE_KEY });

    expect(env[MODE_VAR]).toBe("self_hosted");
  });

  for (const modeKey of [
    "HASNA_FILES_STORAGE_MODE",
    "HASNA_FILES_MODE",
    "FILES_STORAGE_MODE",
    "FILES_MODE",
  ]) {
    test(`leaves an explicit ${modeKey} untouched`, () => {
      const env = filesCloudEnv({ [modeKey]: "local", [URL_VAR]: API_URL, [KEY_VAR]: FAKE_KEY });

      expect(env[modeKey]).toBe("local");
      expect(env[MODE_VAR]).toBe(modeKey === MODE_VAR ? "local" : undefined);
    });
  }

  test("does not invent a mode when only one of url/key is present", () => {
    expect(filesCloudEnv({ [URL_VAR]: API_URL })[MODE_VAR]).toBeUndefined();
    expect(filesCloudEnv({ [KEY_VAR]: FAKE_KEY })[MODE_VAR]).toBeUndefined();
  });

  test("does not invent a mode when nothing is configured", () => {
    expect(filesCloudEnv({})[MODE_VAR]).toBeUndefined();
  });

  test("blank values count as unset", () => {
    expect(filesCloudEnv({ [URL_VAR]: "  ", [KEY_VAR]: "  " })[MODE_VAR]).toBeUndefined();
  });

  test("the resolver is reached with a pinned mode, so cloud survives #51", () => {
    const storage = resolveFilesCloudStorage(
      { [URL_VAR]: API_URL, [KEY_VAR]: FAKE_KEY },
      { fetchImpl: (async () => new Response("{}")) as unknown as typeof fetch },
    );

    expect(storage.active).toBe(true);
  });
});

// -- Forward compatibility across the storage-mode enum change -----------------
//
// The injected mode value is DERIVED from the installed @hasna/contracts, never
// hardcoded. That is load-bearing: the enum has already changed once and the two
// valid sets are DISJOINT.
//
//   contracts <= 0.8.5      accepts cloud + deprecated aliases (self_hosted,
//                           remote, hybrid); THROWS on postgres/sqlite
//   contracts post-#63      accepts ONLY sqlite/postgres; THROWS on everything
//                           else, including cloud and self_hosted
//
// So any literal pinned in source is a bet on which side of that change a given
// machine is on, and the bet loses on one side or the other. Measured 2026-07-30:
// against contracts 0.5.2 `postgres` throws and `self_hosted` normalizes; against
// contracts main (0.8.6) `postgres` normalizes and `self_hosted` throws.
//
// `normalize` is injectable for exactly this reason — both generations have to be
// exercised, and only one of them can be installed at a time.

describe("serverStorageMode", () => {
  const acceptOnly = (accepted: readonly string[]) => (value: string) => {
    if (!accepted.includes(value)) throw new Error(`Unknown storage mode '${value}'`);
    return value;
  };

  test("derives self_hosted on the pre-#63 contracts enum", () => {
    const normalize = acceptOnly(["local", "cloud", "self_hosted", "remote", "hybrid"]);

    expect(serverStorageMode(normalize)).toBe("self_hosted");
  });

  test("derives postgres on the post-#63 contracts enum", () => {
    const normalize = acceptOnly(["sqlite", "postgres", "postgresql"]);

    expect(serverStorageMode(normalize)).toBe("postgres");
  });

  test("prefers the newest accepted token when several are valid", () => {
    // A transitional release that still honours the aliases must not pin the
    // deprecated one.
    const normalize = acceptOnly(["sqlite", "postgres", "cloud", "self_hosted"]);

    expect(serverStorageMode(normalize)).toBe("postgres");
  });

  test("throws with an actionable message when the enum changes again", () => {
    // Guessing is the defect class this pin exists to remove, so an unrecognised
    // enum must fail loudly rather than fall through to a wrong dataset.
    const normalize = acceptOnly([]);

    expect(() => serverStorageMode(normalize)).toThrow(/No known server storage mode/);
    expect(() => serverStorageMode(normalize)).toThrow(/SERVER_MODE_CANDIDATES/);
  });

  test("agrees with the contracts version actually installed", () => {
    // Not a tautology: this is the assertion that fails the day a dependency bump
    // lands a generation the candidate list does not cover.
    expect(SERVER_MODE_CANDIDATES).toContain(serverStorageMode());
  });

  test("the injected mode is the derived one, not a literal", () => {
    const env = filesCloudEnv({
      HASNA_FILES_API_URL: "https://files.md",
      HASNA_FILES_API_KEY: ["files", "FAKE", "KEY"].join("_"),
    });

    expect(env.HASNA_FILES_STORAGE_MODE).toBe(serverStorageMode());
  });
});
