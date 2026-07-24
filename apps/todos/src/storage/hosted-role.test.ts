import { describe, expect, test } from "bun:test";
import {
  getTodosStorageMode,
  isTodosRemoteStorageEnabled,
  loadTodosStorageConfig,
  normalizeTodosStorageMode,
  resolveTodosStorageRole,
} from "./config.js";
import { createTodosStorageAdapter } from "./factory.js";
import { getDatabase, resetDatabase } from "../db/database.js";
import {
  getNativeStorageStatus,
  getNativeStorageSyncPlan,
  redactDatabaseUrl,
  sanitizeDiagnosticPayload,
} from "../lib/native-storage-status.js";

describe("canonical Todos server/storage role", () => {
  test.each([
    ["default local", {}, { role: "local", mode: "local", reason: "default_local" }],
    ["explicit local", { HASNA_TODOS_STORAGE_MODE: "local" }, { role: "local", mode: "local", reason: "explicit_local" }],
    [
      "explicit local shadow with service DSN",
      {
        HASNA_TODOS_STORAGE_MODE: "local",
        HASNA_TODOS_SHADOW: "1",
        HASNA_TODOS_DATABASE_URL: "postgres://synthetic.invalid/todos",
      },
      { role: "local", mode: "local", reason: "explicit_local" },
    ],
    ["remote without DSN", { HASNA_TODOS_STORAGE_MODE: "remote" }, { role: "hosted", mode: "remote", reason: "explicit_hosted" }],
    [
      "self-hosted with DSN",
      {
        HASNA_TODOS_STORAGE_MODE: "self_hosted",
        HASNA_TODOS_DATABASE_URL: "postgres://synthetic.invalid/todos",
      },
      { role: "hosted", mode: "remote", reason: "explicit_hosted" },
    ],
    ["cloud without DSN", { HASNA_TODOS_STORAGE_MODE: "cloud" }, { role: "hosted", mode: "remote", reason: "explicit_hosted" }],
    ["hybrid without DSN", { HASNA_TODOS_STORAGE_MODE: "hybrid" }, { role: "hosted", mode: "hybrid", reason: "explicit_hosted" }],
    [
      "service DSN without mode",
      { HASNA_TODOS_DATABASE_URL: "postgres://synthetic.invalid/todos" },
      { role: "invalid", mode: null, reason: "ambiguous_service_dsn" },
    ],
    [
      "unrelated generic DSN",
      { DATABASE_URL: "postgres://synthetic.invalid/unrelated" },
      { role: "local", mode: "local", reason: "default_local" },
    ],
    ["invalid mode", { HASNA_TODOS_STORAGE_MODE: "banana" }, { role: "invalid", mode: null, reason: "invalid_mode" }],
    [
      "conflicting mode aliases",
      { HASNA_TODOS_STORAGE_MODE: "local", TODOS_STORAGE_MODE: "remote" },
      { role: "invalid", mode: null, reason: "conflicting_modes" },
    ],
  ] as const)("resolves %s without consulting credentials", (_label, env, expected) => {
    expect(resolveTodosStorageRole(env)).toMatchObject(expected);
  });

  test("a cached SQLite handle is refused after a local-to-hosted role flip", () => {
    const environment = { HASNA_TODOS_STORAGE_MODE: "local" };
    try {
      expect(getDatabase(":memory:", environment)).toBeDefined();
      environment.HASNA_TODOS_STORAGE_MODE = "remote";
      expect(() => getDatabase(":memory:", environment)).toThrow("HOSTED_AUTHORITY_UNAVAILABLE");
    } finally {
      resetDatabase();
    }
  });

  test("the hosted process role dominates a caller-supplied local database environment", () => {
    const originalMode = process.env.HASNA_TODOS_STORAGE_MODE;
    const originalFallback = process.env.TODOS_STORAGE_MODE;
    process.env.HASNA_TODOS_STORAGE_MODE = "remote";
    process.env.TODOS_STORAGE_MODE = "remote";
    let callerReads = 0;
    const callerEnvironment = new Proxy({ HASNA_TODOS_STORAGE_MODE: "local" }, {
      get(target, property, receiver) {
        callerReads += 1;
        return Reflect.get(target, property, receiver);
      },
    });
    try {
      expect(() => getDatabase(":memory:", callerEnvironment))
        .toThrow("HOSTED_AUTHORITY_UNAVAILABLE");
      expect(callerReads).toBe(0);
    } finally {
      resetDatabase();
      if (originalMode === undefined) delete process.env.HASNA_TODOS_STORAGE_MODE;
      else process.env.HASNA_TODOS_STORAGE_MODE = originalMode;
      if (originalFallback === undefined) delete process.env.TODOS_STORAGE_MODE;
      else process.env.TODOS_STORAGE_MODE = originalFallback;
    }
  });

  test.each([
    ["local", "local"],
    ["remote", "remote"],
    ["hybrid", "hybrid"],
    ["cloud", "remote"],
    ["self_hosted", "remote"],
    ["self-hosted", "remote"],
  ] as const)("normalizes %s once across role, status, and sync planning", (alias, expectedMode) => {
    const env = { HASNA_TODOS_STORAGE_MODE: alias };
    expect(normalizeTodosStorageMode(alias)).toBe(expectedMode);
    expect(getTodosStorageMode(env)).toBe(expectedMode);
    expect(getNativeStorageStatus(env)).toMatchObject({
      ok: expectedMode === "local",
      mode: expectedMode,
      local_default: expectedMode === "local",
      remote_enabled: false,
      runtime_enabled: false,
      remote_configured: expectedMode !== "local",
      no_network: true,
    });
    expect(getNativeStorageSyncPlan(env).status.mode).toBe(expectedMode);
  });

  test.each([
    ["invalid", { HASNA_TODOS_STORAGE_MODE: "banana" }],
    ["conflicting", { HASNA_TODOS_STORAGE_MODE: "local", TODOS_STORAGE_MODE: "remote" }],
  ] as const)("%s metadata is fail-closed and never presented as local", (_label, env) => {
    expect(() => getTodosStorageMode(env)).toThrow("HOSTED_AUTHORITY_UNAVAILABLE");
    const status = getNativeStorageStatus(env);
    expect(status).toMatchObject({
      ok: false,
      mode: "remote",
      local_default: false,
      remote_enabled: false,
      runtime_enabled: false,
      remote_configured: true,
      no_network: true,
    });
    expect(status.issues.join("\n")).toContain("HOSTED_AUTHORITY_UNAVAILABLE");
    const plan = getNativeStorageSyncPlan(env);
    expect(plan).toMatchObject({ ok: false, no_network: true });
    expect(plan.steps.join("\n")).not.toContain("Skip remote database writes in local mode");
  });

  test("source status redacts userinfo, query material, and fragments", () => {
    const redacted = redactDatabaseUrl(
      "postgres://fixture-user:fixture-pass@db.example.test/todos"
      + "?sslmode=require&password=query-secret&access_token=query-token&sslkey=query-key"
      + "#fragment-secret",
    );

    expect(redacted).toContain("db.example.test/[REDACTED_PATH]");
    expect(redacted).toContain("***:***@db.example.test");
    expect(sanitizeDiagnosticPayload({ redacted }).redacted).toContain("***:***@db.example.test");
    for (const secret of [
      "fixture-user",
      "fixture-pass",
      "require",
      "query-secret",
      "query-token",
      "query-key",
      "fragment-secret",
    ]) {
      expect(redacted).not.toContain(secret);
    }
  });

  test("source status masks every hierarchical database pathname byte, including percent-encoded material", () => {
    const pathMarker = "FAKE_ONLY_DATABASE_PATH_MARKER";
    const encodedPathMarker = Array.from(new TextEncoder().encode(pathMarker))
      .map((byte) => `%${byte.toString(16).padStart(2, "0")}`)
      .join("");
    const rendered = redactDatabaseUrl(
      `postgres://fixture-user:fixture-pass@db.example.test/${encodedPathMarker}`
      + "?mode=fake-only-query-marker#fake-only-fragment-marker",
    );

    expect(rendered).toBe(
      "postgres://***:***@db.example.test/[REDACTED_PATH]?redacted=***#redacted",
    );
    expect(rendered).not.toContain(pathMarker);
    expect(rendered).not.toContain(encodedPathMarker);
  });

  test.each([
    "jdbc:postgresql://opaque-user:opaque-pass@db.example.test/todos?password=opaque-query#opaque-fragment",
    "postgres:opaque-user:opaque-pass@db.example.test/todos?password=opaque-query#opaque-fragment",
    "mysql://unknown-user:unknown-pass@db.example.test/todos?password=unknown-query#unknown-fragment",
    "not-a-url opaque-user:opaque-pass/path?password=opaque-query#opaque-fragment",
  ])("source status fully redacts unsafe database URL shape %#", (value) => {
    const rendered = redactDatabaseUrl(value);
    expect(rendered).toBe("(redacted)");
    for (const marker of ["opaque-user", "opaque-pass", "opaque-query", "opaque-fragment", "unknown-user", "unknown-pass"]) {
      expect(rendered).not.toContain(marker);
    }
  });

  test.each(["postgres", "postgresql"])("source status structurally redacts hierarchical %s URLs", (scheme) => {
    const rendered = redactDatabaseUrl(
      `${scheme}://fixture-user:fixture-pass@db.example.test/todos?password=query-secret#fragment-secret`,
    );
    expect(rendered).toContain(`${scheme}://***:***@db.example.test/[REDACTED_PATH]`);
    expect(rendered).not.toContain("fixture-user");
    expect(rendered).not.toContain("fixture-pass");
    expect(rendered).not.toContain("query-secret");
    expect(rendered).not.toContain("fragment-secret");
  });

  test("bounded recursive diagnostics redact metadata, strip controls, and expose truncation metadata", () => {
    const nestedError = new Error(
      "upstream Authorization: Basic YWR2ZXJzYXJpYWw6Y3JlZGVudGlhbA==",
      {
      cause: { password: "synthetic-error-cause-password" },
      },
    );
    const payload = sanitizeDiagnosticPayload({
      schema: "schema\r\nmarker\u001b[31m",
      metadata: {
        password: "synthetic-metadata-password",
        nested: {
          error: nestedError,
          message: "Bearer synthetic-nested-credential-value",
        },
      },
      values: Array.from({ length: 100 }, (_, index) => `${index}:${"x".repeat(2_000)}`),
    });
    const rendered = JSON.stringify(payload);

    expect(rendered).not.toContain("synthetic-metadata-password");
    expect(rendered).not.toContain("synthetic-nested-credential-value");
    expect(rendered).not.toContain("YWR2ZXJzYXJpYWw6Y3JlZGVudGlhbA==");
    expect(rendered).not.toContain("synthetic-error-cause-password");
    expect(rendered).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
    expect(rendered.length).toBeLessThan(40_000);
    expect(payload.diagnostics).toMatchObject({
      sanitizer: "bounded-recursive-v1",
      truncated: true,
    });
    expect(payload.diagnostics.truncations.length).toBeGreaterThan(0);
  });

  test("generic nested URL diagnostics never retain userinfo, path, query, fragment, opaque, malformed, or encoded bytes", () => {
    const markers = [
      "FAKE_ONLY_USER_MARKER",
      "FAKE_ONLY_PASSWORD_MARKER",
      "FAKE_ONLY_PATH_MARKER",
      "FAKE_ONLY_QUERY_MARKER",
      "FAKE_ONLY_FRAGMENT_MARKER",
      "%46%41%4b%45%5f%4f%4e%4c%59%5f%50%41%53%53%57%4f%52%44%5f%4d%41%52%4b%45%52",
    ];
    const payload = sanitizeDiagnosticPayload({
      nested: {
        http: `https://${markers[0]}:${markers[1]}@example.test/${markers[2]}?token=${markers[3]}#${markers[4]}`,
        postgres: `postgres://example.test/${markers[2]}?password=${markers[3]}#${markers[4]}`,
        foreign: `ftp://${markers[0]}:${markers[1]}@example.test/${markers[2]}`,
        opaque: `jdbc:postgresql://${markers[0]}:${markers[1]}@example.test/${markers[2]}`,
        malformed: `https://${markers[0]}:${markers[1]}@[example.test/${markers[2]}?q=${markers[3]}#${markers[4]}`,
        encoded: `https%3A%2F%2Fexample.test%2F${markers[5]}%3Ftoken%3D${markers[3]}`,
      },
    });
    const rendered = JSON.stringify(payload);

    for (const marker of markers) expect(rendered).not.toContain(marker);
    expect(payload.diagnostics.redactions).toBeGreaterThanOrEqual(6);
  });

  test("raw and bounded decoded credential-like keys redact values before output-key transformation", () => {
    const keys = [
      "DATABASE_URL",
      "postgres_dsn",
      "DbPassword",
      "ACCESS_TOKEN",
      "clientSecret",
      "apiKey",
      "service_credential",
      "Authorization",
      "Set-Cookie",
      "private-key",
      "PASS%57ORD",
      "%44%41%54%41%42%41%53%45%5F%55%52%4C",
      "%2550%2541%2553%2553%2557%254f%2552%2544",
      "malformed%ZZ_DATABASE_URL",
    ];
    const markers = keys.map((_, index) => `FAKE_ONLY_DIAGNOSTIC_MARKER_${index}`);
    const payload = sanitizeDiagnosticPayload({
      cases: keys.map((key, index) => ({
        nested: { [key]: markers[index] },
      })),
    });
    const rendered = JSON.stringify(payload);

    for (const marker of markers) expect(rendered).not.toContain(marker);
    for (const entry of payload.cases) {
      expect(Object.values(entry.nested)).toEqual(["[REDACTED]"]);
    }
    expect(payload.diagnostics.redactions).toBeGreaterThanOrEqual(keys.length);
  });

  test("overlength and colliding diagnostic keys redact conservatively without overwriting", () => {
    const markers = {
      long: "FAKE_ONLY_LONG_SUFFIX_CREDENTIAL_MARKER",
      encoded: "FAKE_ONLY_ENCODED_LONG_KEY_MARKER",
      firstCollision: "FAKE_ONLY_FIRST_COLLISION_MARKER",
    };
    const longCredentialKey = `${"ordinary".repeat(400)}_access_token`;
    const encodedLongKey = `${"prefix".repeat(400)}_%61%70%69%5f%6b%65%79`;
    const nested = Object.create(null) as Record<string, unknown>;
    nested[longCredentialKey] = markers.long;
    nested[encodedLongKey] = markers.encoded;
    nested["%74%6f%6b%65%6e"] = markers.firstCollision;
    nested["[REDACTED_ENCODED]"] = "safe literal collision value";
    Object.defineProperty(nested, "__proto__", {
      enumerable: true,
      configurable: true,
      value: "safe proto value",
    });

    const payload = sanitizeDiagnosticPayload({ nested });
    const rendered = JSON.stringify(payload);
    const values = Object.values(payload.nested);

    expect(Object.getPrototypeOf(payload)).toBeNull();
    expect(Object.getPrototypeOf(payload.nested)).toBeNull();
    expect(values.filter((value) => value === "[REDACTED]").length).toBeGreaterThanOrEqual(3);
    expect(values).toContain("safe literal collision value");
    expect(values).toContain("safe proto value");
    expect(Object.keys(payload.nested).length).toBe(5);
    expect(new Set(Object.keys(payload.nested)).size).toBe(5);
    for (const marker of Object.values(markers)) expect(rendered).not.toContain(marker);
    expect(rendered.length).toBeLessThan(40_000);
  });

  test("a hosted process rejects hostile caller env before any caller read", () => {
    const originalMode = process.env.HASNA_TODOS_STORAGE_MODE;
    process.env.HASNA_TODOS_STORAGE_MODE = "remote";
    let reads = 0;
    const callerEnv = new Proxy({}, {
      get() {
        reads += 1;
        throw new Error("FAKE_ONLY_STORAGE_ENV_GETTER_MARKER");
      },
      ownKeys() {
        reads += 1;
        throw new Error("FAKE_ONLY_STORAGE_ENV_OWN_KEYS_MARKER");
      },
    });
    try {
      expect(() => loadTodosStorageConfig(callerEnv)).toThrow("HOSTED_AUTHORITY_UNAVAILABLE");
      expect(reads).toBe(0);
    } finally {
      if (originalMode === undefined) delete process.env.HASNA_TODOS_STORAGE_MODE;
      else process.env.HASNA_TODOS_STORAGE_MODE = originalMode;
    }
  });

  test("a hosted process reaches public config helpers before a hostile config object", () => {
    const originalMode = process.env.HASNA_TODOS_STORAGE_MODE;
    const originalFallback = process.env.TODOS_STORAGE_MODE;
    process.env.HASNA_TODOS_STORAGE_MODE = "remote";
    process.env.TODOS_STORAGE_MODE = "remote";
    let reads = 0;
    const config = new Proxy({}, {
      get() {
        reads += 1;
        throw new Error("FAKE_ONLY_CONFIG_GETTER_MARKER");
      },
      ownKeys() {
        reads += 1;
        throw new Error("FAKE_ONLY_CONFIG_KEYS_MARKER");
      },
    });
    try {
      expect(() => isTodosRemoteStorageEnabled(config as never))
        .toThrow("HOSTED_AUTHORITY_UNAVAILABLE");
      expect(reads).toBe(0);
    } finally {
      if (originalMode === undefined) delete process.env.HASNA_TODOS_STORAGE_MODE;
      else process.env.HASNA_TODOS_STORAGE_MODE = originalMode;
      if (originalFallback === undefined) delete process.env.TODOS_STORAGE_MODE;
      else process.env.TODOS_STORAGE_MODE = originalFallback;
    }
  });

  test("storage factory stops after one env read when caller intent is hosted", () => {
    const originalMode = process.env.HASNA_TODOS_STORAGE_MODE;
    const originalFallback = process.env.TODOS_STORAGE_MODE;
    process.env.HASNA_TODOS_STORAGE_MODE = "local";
    process.env.TODOS_STORAGE_MODE = "local";
    const reads: string[] = [];
    const options = new Proxy({
      env: {
        HASNA_TODOS_STORAGE_MODE: "remote",
        TODOS_STORAGE_MODE: "remote",
      },
    }, {
      get(target, key, receiver) {
        reads.push(String(key));
        if (key !== "env") throw new Error("FAKE_ONLY_FACTORY_LATE_GETTER_MARKER");
        return Reflect.get(target, key, receiver);
      },
      ownKeys() {
        reads.push("ownKeys");
        throw new Error("FAKE_ONLY_FACTORY_KEYS_MARKER");
      },
    });
    try {
      expect(() => createTodosStorageAdapter(options)).toThrow("HOSTED_AUTHORITY_UNAVAILABLE");
      expect(reads).toEqual(["env"]);
    } finally {
      if (originalMode === undefined) delete process.env.HASNA_TODOS_STORAGE_MODE;
      else process.env.HASNA_TODOS_STORAGE_MODE = originalMode;
      if (originalFallback === undefined) delete process.env.TODOS_STORAGE_MODE;
      else process.env.TODOS_STORAGE_MODE = originalFallback;
    }
  });

  test.each([
    ["invalid Date", () => new Date(Number.NaN), "[INVALID_DATE]"],
    [
      "throwing getter",
      () => Object.defineProperty({}, "unstable", {
        enumerable: true,
        get() { throw new Error("FAKE_ONLY_THROWING_GETTER_MARKER"); },
      }),
      { unstable: "[UNREADABLE]" },
    ],
    [
      "throwing ownKeys proxy",
      () => new Proxy({}, {
        ownKeys() { throw new Error("FAKE_ONLY_THROWING_OWN_KEYS_MARKER"); },
      }),
      "[UNREADABLE]",
    ],
    [
      "throwing descriptor proxy",
      () => new Proxy({}, {
        ownKeys() { return ["unstable"]; },
        getOwnPropertyDescriptor() { throw new Error("FAKE_ONLY_THROWING_DESCRIPTOR_MARKER"); },
      }),
      { unstable: "[UNREADABLE]" },
    ],
    [
      "revoked proxy",
      () => {
        const pair = Proxy.revocable({}, {});
        pair.revoke();
        return pair.proxy;
      },
      "[UNREADABLE]",
    ],
    [
      "Error with throwing fields",
      () => {
        const error = new Error("safe synthetic message");
        Object.defineProperty(error, "message", {
          enumerable: true,
          configurable: true,
          get() { throw new Error("FAKE_ONLY_THROWING_ERROR_FIELD_MARKER"); },
        });
        return error;
      },
      expect.objectContaining({ message: "[UNREADABLE]" }),
    ],
  ] as const)("fails closed without throwing for %s", (_label, createValue, expected) => {
    let first: ReturnType<typeof sanitizeDiagnosticPayload> | undefined;
    expect(() => {
      first = sanitizeDiagnosticPayload({ value: createValue() });
    }).not.toThrow();
    expect(first?.value).toEqual(expected);
    expect(first?.diagnostics.truncations).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "unreadable" }),
    ]));

    let second: ReturnType<typeof sanitizeDiagnosticPayload> | undefined;
    expect(() => {
      second = sanitizeDiagnosticPayload({ value: createValue() });
    }).not.toThrow();
    expect(second).toEqual(first);
    expect(JSON.stringify(first)).not.toContain("FAKE_ONLY_THROWING");
  });

  test("env exemptions apply only to the fixed status shape and redact nested secret-named fields", () => {
    const payload = sanitizeDiagnosticPayload({
      env: {
        mode: { name: "HASNA_TODOS_STORAGE_MODE", active_name: "HASNA_TODOS_STORAGE_MODE", configured: true },
        nested: { password: "FAKE_ONLY_NESTED_ENV_MARKER" },
      },
      environment: { token: "FAKE_ONLY_ENVIRONMENT_MARKER" },
    });
    const rendered = JSON.stringify(payload);

    expect(payload.env.mode).toEqual({
      name: "HASNA_TODOS_STORAGE_MODE",
      active_name: "HASNA_TODOS_STORAGE_MODE",
      configured: true,
    });
    expect(payload.env.nested.password).toBe("[REDACTED]");
    expect(payload.environment.token).toBe("[REDACTED]");
    expect(rendered).not.toContain("FAKE_ONLY_NESTED_ENV_MARKER");
    expect(rendered).not.toContain("FAKE_ONLY_ENVIRONMENT_MARKER");
  });

  test("truncation metadata paths cannot amplify deeply nested hostile keys", () => {
    const longKey = "k".repeat(500);
    let nested: unknown = Array.from({ length: 32 }, () => "v".repeat(10_000));
    for (let level = 0; level < 6; level += 1) {
      nested = { [`${longKey}${level}`]: nested };
    }

    const payload = sanitizeDiagnosticPayload({ nested });
    const rendered = JSON.stringify(payload);

    expect(rendered.length).toBeLessThan(40_000);
    expect(payload.diagnostics.truncations).toHaveLength(32);
    expect(payload.diagnostics.truncations.every((entry) => entry.path.length <= 128)).toBe(true);
    expect(payload.diagnostics.truncations.some((entry) => entry.path.includes("...[path:"))).toBe(true);
  });

  test("status preserves valid fields and fallback alias provenance when another field is invalid", () => {
    const status = getNativeStorageStatus({
      HASNA_TODOS_STORAGE_MODE: "remote",
      HASNA_TODOS_DATABASE_URL: "postgres://fixture-user:fixture-pass@db.example.test/todos",
      TODOS_DATABASE_SSL: "not-a-boolean",
      TODOS_SYNC_BATCH_SIZE: "not-a-number",
    });

    expect(status.ok).toBe(false);
    expect(status.database).toMatchObject({
      configured: true,
      provider: "postgres",
      ssl: true,
    });
    expect(status.database.redacted_url).toContain("db.example.test/[REDACTED_PATH]");
    expect(status.env.databaseSsl.active_name).toBe("TODOS_DATABASE_SSL");
    expect(status.env.syncBatchSize.active_name).toBe("TODOS_SYNC_BATCH_SIZE");
    expect(status.issues).toEqual([
      "TODOS_DATABASE_SSL must be a boolean (1/0, true/false, yes/no, or on/off)",
      "TODOS_SYNC_BATCH_SIZE must be a positive integer",
    ]);
    expect(status.issues.join("\n")).not.toContain("DATABASE_URL is required");
  });

  test.each([
    "12junk",
    "12.0",
    "+12",
    " 12",
    "12 ",
    "01",
    "0",
    "-1",
    "9007199254740992",
  ])("rejects non-canonical positive integer syntax for sync batch size: %j", (value) => {
    const status = getNativeStorageStatus({
      HASNA_TODOS_STORAGE_MODE: "remote",
      HASNA_TODOS_DATABASE_URL: "postgres://db.example.test/fake-only-path",
      HASNA_TODOS_SYNC_BATCH_SIZE: value,
    });

    expect(status.ok).toBe(false);
    expect(status.sync.batch_size).toBe(500);
    expect(status.issues).toContain("HASNA_TODOS_SYNC_BATCH_SIZE must be a positive integer");
  });

  test.each(["1", "12", "9007199254740991"])(
    "accepts canonical safe positive integer syntax for sync batch size: %s",
    (value) => {
      const status = getNativeStorageStatus({
        HASNA_TODOS_STORAGE_MODE: "remote",
        HASNA_TODOS_DATABASE_URL: "postgres://db.example.test/fake-only-path",
        HASNA_TODOS_SYNC_BATCH_SIZE: value,
      });
      expect(status.sync.batch_size).toBe(Number(value));
      expect(status.issues).toEqual([]);
    },
  );

  test("status and sync-plan bound malicious provider metadata without output amplification", () => {
    const longPrefix = `Bearer synthetic-prefix-credential-value/${"x".repeat(200_000)}`;
    const env = {
      HASNA_TODOS_STORAGE_MODE: "remote",
      HASNA_TODOS_DATABASE_URL: "postgres://db.example.test/todos",
      HASNA_TODOS_DATABASE_SCHEMA: "schema\r\nSCHEMA_CONTROL_MARKER\u001b[31m",
      HASNA_TODOS_S3_BUCKET: "bucket\nBUCKET_CONTROL_MARKER\u001b]52;c;payload\u0007",
      HASNA_TODOS_S3_PREFIX: longPrefix,
      HASNA_TODOS_AWS_REGION: "region\rREGION_CONTROL_MARKER",
    };
    const status = getNativeStorageStatus(env);
    const plan = getNativeStorageSyncPlan(env);
    const statusJson = JSON.stringify(status);
    const planJson = JSON.stringify(plan);

    for (const rendered of [statusJson, planJson]) {
      expect(rendered).not.toContain("synthetic-prefix-credential-value");
      expect(rendered).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
      expect(rendered.length).toBeLessThan(40_000);
    }
    expect(status.diagnostics.truncated).toBe(true);
    expect(plan.diagnostics.truncated).toBe(true);
    expect(status.object_storage.prefix!.length).toBeLessThan(1_000);
  });

  test("source status never includes raw invalid boolean values or control characters", () => {
    const marker = "not-a-boolean\r\nCONTROL_MARKER\u001b[31m";
    const status = getNativeStorageStatus({
      HASNA_TODOS_STORAGE_MODE: "remote",
      HASNA_TODOS_DATABASE_URL: "postgres://fixture-user:fixture-pass@db.example.test/todos",
      HASNA_TODOS_DATABASE_SSL: marker,
    });
    const rendered = JSON.stringify(status);

    expect(status.ok).toBe(false);
    expect(status.issues.join("\n")).toContain("HASNA_TODOS_DATABASE_SSL");
    expect(rendered).not.toContain("not-a-boolean");
    expect(rendered).not.toContain("CONTROL_MARKER");
    expect(rendered).not.toContain("fixture-user");
    expect(rendered).not.toContain("fixture-pass");
    expect(rendered).not.toContain("\u001b");
  });
});
