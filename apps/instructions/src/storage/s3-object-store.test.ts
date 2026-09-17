import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import type { InstructionsS3Config } from "./s3-config.js";
import {
  assertSafeInstructionsObjectKey,
  assertSafeInstructionsObjectVersionId,
  createInstructionsS3ObjectStore,
  memoryInstructionsObjectStore,
} from "./s3-object-store.js";

const CONFIG: InstructionsS3Config = {
  provider: "s3",
  bucket: "instructions-backups",
  prefix: "instructions/",
  region: "us-east-1",
  forcePathStyle: true,
  credentials: {
    accessKeyId: "fixture-access",
    secretAccessKey: "fixture-secret",
    sessionToken: "fixture-session",
  },
};

function missingFile() {
  return {
    async exists() { return false; },
    async bytes() { return new Uint8Array(); },
    async stat() { throw new Error("missing"); },
  };
}

afterEach(() => setSystemTime());

describe("Instructions S3 object store", () => {
  test("public native store exposes conditional-create and read-only operations only", () => {
    const store = createInstructionsS3ObjectStore(CONFIG, () => ({
      presign(key) { return `https://fixture.invalid/${key}`; },
      file: missingFile,
    }));

    expect("put" in store).toBe(false);
    expect("delete" in store).toBe(false);
    expect(typeof store.putIfAbsent).toBe("function");
    expect(typeof store.get).toBe("function");
    expect(typeof store.head).toBe("function");
  });

  test("constructs Bun's native client and reads the current object without exposing mutators", async () => {
    const created: unknown[] = [];
    const objects = new Map([["instructions/backups/a/payload", new TextEncoder().encode("hello")]]);
    const store = createInstructionsS3ObjectStore(CONFIG, (options) => {
      created.push(options);
      return {
        presign(key) { return `https://fixture.invalid/${key}`; },
        file(key) {
          return {
            async exists() { return objects.has(key); },
            async bytes() { return objects.get(key) ?? new Uint8Array(); },
            async stat() {
              return {
                size: objects.get(key)?.byteLength ?? 0,
                etag: "fixture-etag",
                type: "application/octet-stream",
                lastModified: new Date(0),
              };
            },
          };
        },
      };
    });

    expect(new TextDecoder().decode(await store.get("instructions/backups/a/payload"))).toBe("hello");
    expect(await store.head("instructions/backups/a/payload")).toMatchObject({ size: 5, etag: "fixture-etag" });
    expect(created).toEqual([{
      bucket: CONFIG.bucket,
      region: CONFIG.region,
      accessKeyId: "fixture-access",
      secretAccessKey: "fixture-secret",
      sessionToken: "fixture-session",
      virtualHostedStyle: false,
    }]);
  });

  test("reads and heads the exact requested immutable S3 version", async () => {
    const requests: Array<{ url: URL; init?: RequestInit }> = [];
    const store = createInstructionsS3ObjectStore(
      CONFIG,
      () => ({
        presign(key) { return `https://fixture.invalid/${key}`; },
        file() {
          return {
            async exists() { return true; },
            async bytes() { return new TextEncoder().encode("shadow-latest"); },
            async stat() { return { size: 13, etag: "latest", type: "text/plain", lastModified: new Date(0) }; },
          };
        },
      }),
      async (input, init) => {
        const url = new URL(String(input));
        requests.push({ url, init });
        if (init?.method === "HEAD") {
          return new Response(null, { status: 200, headers: {
            "content-length": "9",
            "content-type": "text/plain",
            etag: "\"exact\"",
            "last-modified": "Wed, 16 Sep 2026 00:00:00 GMT",
            "x-amz-version-id": "payload-v1",
          } });
        }
        return new Response("immutable", { status: 200, headers: {
          "content-length": "9",
          "x-amz-version-id": "payload-v1",
        } });
      },
    );

    const key = "instructions/backups/a/payload";
    expect(new TextDecoder().decode(await store.get(key, { versionId: "payload-v1" }))).toBe("immutable");
    expect(await store.head(key, { versionId: "payload-v1" })).toMatchObject({
      size: 9,
      etag: "\"exact\"",
      versionId: "payload-v1",
    });
    expect(requests.map(({ url }) => url.searchParams.get("versionId"))).toEqual(["payload-v1", "payload-v1"]);
    expect(requests.map(({ init }) => init?.method)).toEqual(["GET", "HEAD"]);
    for (const { init } of requests) {
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toStartWith("AWS4-HMAC-SHA256 ");
      expect(headers.get("authorization")).not.toContain("fixture-secret");
      expect(headers.get("x-amz-security-token")).toBe("fixture-session");
      expect(init?.redirect).toBe("error");
    }
  });

  test("fails closed when exact-version response authority differs", async () => {
    const store = createInstructionsS3ObjectStore(
      CONFIG,
      () => ({ presign(key) { return `https://fixture.invalid/${key}`; }, file: missingFile }),
      async () => new Response("shadow", { status: 200, headers: { "x-amz-version-id": "shadow-v2" } }),
    );
    await expect(store.get("instructions/backups/a/payload", { versionId: "retained-v1" })).rejects.toThrow("get operation failed");
  });

  test("validates keys, version ids, and all operation deadlines before use", async () => {
    for (const value of ["", " leading", "trailing ", "bad\nversion", "x".repeat(1025)]) {
      expect(() => assertSafeInstructionsObjectVersionId(value)).toThrow("version id");
    }
    const store = memoryInstructionsObjectStore();
    for (const key of ["", "/absolute", "a//b", "a/../b", "a\\b", "a\u0000b"]) {
      expect(() => assertSafeInstructionsObjectKey(key)).toThrow("object key");
      await expect(store.putIfAbsent(key, new Uint8Array(), { contentType: "application/octet-stream" })).rejects.toThrow("object key");
    }

    let clientsCreated = 0;
    const createClient = () => {
      clientsCreated += 1;
      throw new Error("client creation must not run");
    };
    for (const deadlines of [
      { conditionalCreateAttemptDeadlineMs: 0 },
      { existenceReconciliationDeadlineMs: -1 },
      { existsDeadlineMs: Number.NaN },
      { bytesDeadlineMs: Number.POSITIVE_INFINITY },
      { statDeadlineMs: 60_001 },
      { versionedReadDeadlineMs: 0 },
    ]) {
      expect(() => createInstructionsS3ObjectStore(CONFIG, createClient, fetch, deadlines)).toThrow("deadline");
    }
    expect(clientsCreated).toBe(0);
  });

  test("bounds current and exact-version reads and aborts HTTP reads", async () => {
    const current = createInstructionsS3ObjectStore(
      CONFIG,
      () => ({
        presign(key) { return `https://fixture.invalid/${key}`; },
        file() {
          return {
            exists() { return new Promise<boolean>(() => {}); },
            bytes() { return new Promise<Uint8Array>(() => {}); },
            stat() { return new Promise<never>(() => {}); },
          };
        },
      }),
      fetch,
      { existsDeadlineMs: 10, bytesDeadlineMs: 10, statDeadlineMs: 10 },
    );
    await expect(current.get("instructions/backups/a/payload")).rejects.toThrow("get operation failed");
    await expect(current.head("instructions/backups/a/payload")).rejects.toThrow("head operation failed");

    let aborted = false;
    const exact = createInstructionsS3ObjectStore(
      CONFIG,
      () => ({ presign(key) { return `https://fixture.invalid/${key}`; }, file: missingFile }),
      (_input, init) => {
        init?.signal?.addEventListener("abort", () => { aborted = true; }, { once: true });
        return new Promise<Response>(() => {});
      },
      { versionedReadDeadlineMs: 10 },
    );
    await expect(exact.get("instructions/backups/a/payload", { versionId: "v1" })).rejects.toThrow("get operation failed");
    expect(aborted).toBe(true);
  });

  test("returns redacted errors for signed and native read failures", async () => {
    const sensitive = "https://fixture.invalid/object?X-Amz-Credential=fixture-access&X-Amz-Signature=fixture-secret";
    const store = createInstructionsS3ObjectStore(
      CONFIG,
      () => ({
        presign() { throw new Error(sensitive); },
        file() {
          return {
            async exists() { throw new Error(sensitive); },
            async bytes() { throw new Error(sensitive); },
            async stat() { throw new Error(sensitive); },
          };
        },
      }),
      async () => { throw new Error(sensitive); },
      { conditionalCreateAttemptDeadlineMs: 10, existenceReconciliationDeadlineMs: 10 },
    );
    const key = "instructions/backups/a/payload";
    const messages = await Promise.all([
      store.get(key).catch((error: unknown) => String(error)),
      store.head(key).catch((error: unknown) => String(error)),
      store.get(key, { versionId: "v1" }).catch((error: unknown) => String(error)),
      store.putIfAbsent(key, new Uint8Array([1]), { contentType: "application/octet-stream" }).catch((error: unknown) => String(error)),
    ]);
    for (const message of messages) {
      expect(message).not.toContain("fixture-access");
      expect(message).not.toContain("fixture-secret");
      expect(message).not.toContain("X-Amz-");
      expect(message).not.toContain("https://");
    }
  });

  test("uses conditional creation, records created version id, and treats precondition loss as existing", async () => {
    setSystemTime(new Date("2026-09-17T12:08:32.000Z"));
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const responses = [
      new Response(null, { status: 201, headers: { "x-amz-version-id": "created-v1" } }),
      new Response(null, { status: 412 }),
    ];
    const store = createInstructionsS3ObjectStore(
      CONFIG,
      () => ({
        presign() { throw new Error("unused"); },
        file: missingFile,
      }),
      async (url, init) => {
        requests.push({ url: String(url), init });
        return responses.shift() ?? new Response(null, { status: 500 });
      },
    );

    const bytes = new TextEncoder().encode("immutable");
    await expect(store.putIfAbsent("instructions/backups/a/payload", bytes, { contentType: "text/plain" })).resolves.toEqual({ status: "created", versionId: "created-v1" });
    await expect(store.putIfAbsent("instructions/backups/a/payload", bytes, { contentType: "text/plain" })).resolves.toEqual({ status: "existing" });
    expect(requests).toHaveLength(2);
    expect(requests[0]?.url).toBe("https://s3.us-east-1.amazonaws.com/instructions-backups/instructions/backups/a/payload");
    expect(requests[0]?.init?.method).toBe("PUT");
    expect(requests[0]?.init?.redirect).toBe("error");
    const headers = new Headers(requests[0]?.init?.headers);
    expect(headers.get("content-md5")).toBe("gNLgSzBQpnuXJzV0g2ENYw==");
    expect(headers.get("content-type")).toBe("text/plain");
    expect(headers.get("host")).toBe("s3.us-east-1.amazonaws.com");
    expect(headers.get("if-none-match")).toBe("*");
    expect(headers.get("x-amz-content-sha256")).toBe("3e58bada6a180c0d7f817bdae51fba96a461575b309bfbc17a6918d20c6617c7");
    expect(headers.get("x-amz-date")).toBe("20260917T120832Z");
    expect(headers.get("x-amz-security-token")).toBe("fixture-session");
    expect(headers.get("authorization")).toBe(
      "AWS4-HMAC-SHA256 Credential=fixture-access/20260917/us-east-1/s3/aws4_request, " +
      "SignedHeaders=content-md5;content-type;host;if-none-match;x-amz-content-sha256;x-amz-date;x-amz-security-token, " +
      "Signature=283ab10bef4fec00be7457a92dfd709d90f96eb2e638704bda2fad7d374dddbc",
    );
  });

  test("signs the canonical object URI for virtual-hosted and custom path-style endpoints", async () => {
    setSystemTime(new Date("2026-09-17T12:08:32.000Z"));
    const requests: Array<{ url: string; headers: Headers }> = [];
    const key = "instructions/backups/a file/%payload";
    const configs: InstructionsS3Config[] = [
      { ...CONFIG, forcePathStyle: false },
      { ...CONFIG, endpoint: "https://objects.example.test", forcePathStyle: false },
      { ...CONFIG, endpoint: "https://objects.example.test", forcePathStyle: true },
    ];
    for (const config of configs) {
      const store = createInstructionsS3ObjectStore(
        config,
        () => ({ presign() { throw new Error("unused"); }, file: missingFile }),
        async (url, init) => {
          requests.push({ url: String(url), headers: new Headers(init?.headers) });
          return new Response(null, { status: 201, headers: { "x-amz-version-id": "created-v1" } });
        },
      );
      await expect(store.putIfAbsent(key, new Uint8Array([1]), { contentType: "application/octet-stream" }))
        .resolves.toMatchObject({ status: "created", versionId: "created-v1" });
    }

    expect(requests.map((request) => request.url)).toEqual([
      "https://instructions-backups.s3.us-east-1.amazonaws.com/instructions/backups/a%20file/%25payload",
      "https://instructions-backups.objects.example.test/instructions/backups/a%20file/%25payload",
      "https://objects.example.test/instructions-backups/instructions/backups/a%20file/%25payload",
    ]);
    expect(requests.map((request) => request.headers.get("host"))).toEqual([
      "instructions-backups.s3.us-east-1.amazonaws.com",
      "instructions-backups.objects.example.test",
      "objects.example.test",
    ]);
    for (const request of requests) {
      const authorization = request.headers.get("authorization");
      expect(authorization).toContain(
        "SignedHeaders=content-md5;content-type;host;if-none-match;x-amz-content-sha256;x-amz-date;x-amz-security-token",
      );
      expect(authorization).toMatch(/Signature=[0-9a-f]{64}$/);
    }
  });

  test("signs conditional creation with the temporary AWS environment credentials used by deploys", async () => {
    setSystemTime(new Date("2026-09-17T12:08:32.000Z"));
    const original = {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      sessionToken: process.env.AWS_SESSION_TOKEN,
    };
    process.env.AWS_ACCESS_KEY_ID = CONFIG.credentials!.accessKeyId;
    process.env.AWS_SECRET_ACCESS_KEY = CONFIG.credentials!.secretAccessKey;
    process.env.AWS_SESSION_TOKEN = CONFIG.credentials!.sessionToken;
    try {
      const { credentials: _credentials, ...environmentConfig } = CONFIG;
      let headers = new Headers();
      const store = createInstructionsS3ObjectStore(
        environmentConfig,
        () => ({ presign() { throw new Error("unused"); }, file: missingFile }),
        async (_url, init) => {
          headers = new Headers(init?.headers);
          return new Response(null, { status: 201 });
        },
      );
      await expect(store.putIfAbsent("instructions/backups/a/payload", new Uint8Array([1]), {
        contentType: "application/octet-stream",
      })).resolves.toEqual({ status: "created" });
      expect(headers.get("x-amz-security-token")).toBe("fixture-session");
      expect(headers.get("authorization")).toContain("Credential=fixture-access/20260917/us-east-1/s3/aws4_request");
      expect(headers.get("authorization")).toContain("x-amz-security-token");
    } finally {
      restoreEnvironment("AWS_ACCESS_KEY_ID", original.accessKeyId);
      restoreEnvironment("AWS_SECRET_ACCESS_KEY", original.secretAccessKey);
      restoreEnvironment("AWS_SESSION_TOKEN", original.sessionToken);
    }
  });

  test("retries conflicts and reconciles uncertain commits without mutable fallback", async () => {
    let conditionalRequests = 0;
    let exists = false;
    const statuses = [409, 412];
    const store = createInstructionsS3ObjectStore(
      CONFIG,
      () => ({
        presign(key) { return `https://fixture.invalid/${key}`; },
        file() { return { ...missingFile(), async exists() { return exists; } }; },
      }),
      async () => {
        conditionalRequests += 1;
        return new Response(null, { status: statuses.shift() ?? 500 });
      },
    );
    await expect(store.putIfAbsent("instructions/backups/a/payload", new Uint8Array([1]), { contentType: "application/octet-stream" })).resolves.toEqual({ status: "existing" });
    expect(conditionalRequests).toBe(2);

    const reconciled = createInstructionsS3ObjectStore(
      CONFIG,
      () => ({
        presign(key) { return `https://fixture.invalid/${key}`; },
        file() { return { ...missingFile(), async exists() { return true; } }; },
      }),
      async () => { exists = true; throw new Error("connection lost after commit"); },
    );
    await expect(reconciled.putIfAbsent("instructions/backups/a/payload", new Uint8Array([1]), { contentType: "application/octet-stream" })).resolves.toEqual({ status: "existing" });
  });

  test("bounds and aborts all never-settling conditional attempts and reconciliations", async () => {
    let conditionalRequests = 0;
    let abortedRequests = 0;
    let existenceChecks = 0;
    const store = createInstructionsS3ObjectStore(
      CONFIG,
      () => ({
        presign(key) { return `https://fixture.invalid/${key}`; },
        file() {
          return {
            exists() { existenceChecks += 1; return new Promise<boolean>(() => {}); },
            async bytes() { return new Uint8Array(); },
            async stat() { throw new Error("unused"); },
          };
        },
      }),
      (_url, init) => {
        conditionalRequests += 1;
        init?.signal?.addEventListener("abort", () => { abortedRequests += 1; }, { once: true });
        return new Promise<Response>(() => {});
      },
      { conditionalCreateAttemptDeadlineMs: 10, existenceReconciliationDeadlineMs: 10 },
    );

    await expect(store.putIfAbsent("instructions/backups/a/payload", new Uint8Array([1]), { contentType: "application/octet-stream" })).rejects.toThrow("conditional object creation failed");
    expect(conditionalRequests).toBe(3);
    expect(abortedRequests).toBe(3);
    expect(existenceChecks).toBe(3);
  });

  test("in-memory conditional creation is atomic and owns byte copies", async () => {
    const store = memoryInstructionsObjectStore();
    const key = "instructions/backups/a/payload";
    const firstBytes = new Uint8Array([1, 2, 3]);
    const results = await Promise.all([
      store.putIfAbsent(key, firstBytes, { contentType: "application/octet-stream" }),
      store.putIfAbsent(key, new Uint8Array([9]), { contentType: "application/octet-stream" }),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual(["created", "existing"]);
    const versionId = results[0]?.versionId;
    expect(versionId).toBeTruthy();
    firstBytes[0] = 8;
    const read = await store.get(key, { versionId });
    expect(read).toEqual(new Uint8Array([1, 2, 3]));
    read![0] = 7;
    expect(await store.get(key, { versionId })).toEqual(new Uint8Array([1, 2, 3]));
    expect(await store.head(key, { versionId })).toMatchObject({ versionId, size: 3 });
  });
});

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
