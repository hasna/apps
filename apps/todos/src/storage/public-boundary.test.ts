import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Database } from "bun:sqlite";
import { openLocalSqliteDatabase } from "../db/database.js";
import * as root from "../index.js";
import * as storage from "../storage.js";
import type * as RootTypes from "../index.js";
import type * as StorageTypes from "../storage.js";

/** Runtime exports present at the pinned base 729ca65b before Stage A. */
const STORAGE_BASELINE_RUNTIME_EXPORTS = [
  "CANONICAL_TODOS_RDS_CLUSTER",
  "CANONICAL_TODOS_RDS_DATABASE",
  "CANONICAL_TODOS_RDS_RUNTIME_PATH",
  "STORAGE_TABLES",
  "TODOS_STORAGE_ENV",
  "TODOS_STORAGE_FALLBACK_ENV",
  "TODOS_STORAGE_TABLES",
  "assertTodosRemoteStorageConfig",
  "assertTodosShadowConfig",
  "isTodosShadowEnabled",
  "getTodosStorageShadowEnvName",
  "createLocalSqliteTodosStorageAdapter",
  "createHybridTodosStorageAdapter",
  "createShadowTodosStorageAdapter",
  "TodosShadowOutbox",
  "createTodosShadowOutbox",
  "installShadowOutboxSchema",
  "maybeInstallShadowCapture",
  "getRuntimeShadowOutbox",
  "startRuntimeShadowDrain",
  "registerShadowExitFlush",
  "closeRuntimeShadowCloud",
  "createTodosCloudQueryClient",
  "createTodosCloudQueryClientFromEnv",
  "TodosShadowMirror",
  "createTodosStorageAdapter",
  "exportSqliteTodosStorageSnapshot",
  "importSqliteTodosStorageSnapshot",
  "isTodosRemoteStorageEnabled",
  "loadTodosStorageConfig",
  "parseStorageMode",
  "planRunArtifactsS3Sync",
  "createPostgresTodosStorageAdapter",
  "createPostgresTodosSyncStore",
  "createTodosS3ArtifactStore",
  "COMMENT_REDACTION_BACKFILL_CONFIRMATION",
  "backfillPostgresCommentRedaction",
  "isCommentRedactionBackfillComplete",
  "ensurePostgresScopedSlugUniqueIndexes",
  "PostgresScopedSlugIndexBuildError",
  "PostgresScopedSlugMigrationConflictError",
  "postgresTodosCommentCursorIndexSql",
  "postgresTodosScopedSlugPreflightSql",
  "postgresTodosScopedSlugIndexStatusSql",
  "postgresTodosScopedSlugUniqueIndexSql",
  "postgresTodosSyncSchemaSql",
  "signAwsV4Request",
  "uploadRunArtifactsToS3",
  "downloadRunArtifactsFromS3",
  "getCanonicalTodosRdsConfig",
  "getStorageDatabaseEnv",
  "getStorageDatabaseUrl",
  "getStorageMode",
  "getTodosStorageDatabaseEnv",
  "getTodosStorageDatabaseUrl",
  "getTodosStorageEnvName",
  "getTodosStorageMode",
  "buildS3ObjectKey",
  "buildS3ObjectUrl",
  "loadStorageConfig",
] as const;

/** Runtime exports present on the root package at the same pinned base. */
const ROOT_BASELINE_RUNTIME_EXPORTS = [
  "STORAGE_TABLES",
  "TODOS_STORAGE_ENV",
  "TODOS_STORAGE_FALLBACK_ENV",
  "TODOS_STORAGE_TABLES",
  "assertTodosRemoteStorageConfig",
  "createLocalSqliteTodosStorageAdapter",
  "createHybridTodosStorageAdapter",
  "createPostgresTodosSyncStore",
  "createPostgresTodosStorageAdapter",
  "createTodosS3ArtifactStore",
  "createTodosStorageAdapter",
  "downloadRunArtifactsFromS3",
  "exportSqliteTodosStorageSnapshot",
  "getStorageDatabaseEnv",
  "getStorageDatabaseUrl",
  "getStorageMode",
  "getTodosStorageDatabaseEnv",
  "getTodosStorageDatabaseUrl",
  "getTodosStorageEnvName",
  "getTodosStorageMode",
  "importSqliteTodosStorageSnapshot",
  "isTodosRemoteStorageEnabled",
  "loadStorageConfig",
  "loadTodosStorageConfig",
  "parseStorageMode",
  "planRunArtifactsS3Sync",
  "postgresTodosSyncSchemaSql",
  "signAwsV4Request",
  "uploadRunArtifactsToS3",
  "buildS3ObjectKey",
  "buildS3ObjectUrl",
] as const;

/**
 * Narrow Stage-A denylist: every symbol below can construct, query, mutate, or
 * automatically flush a remote/local datastore. Type-only exports and pure
 * config, SQL-rendering, redaction-result, signing, and URL/key helpers remain
 * source compatible because none performs I/O by itself.
 */
const FORBIDDEN_RUNTIME_EXPORTS = [
  "createHybridTodosStorageAdapter",
  "createShadowTodosStorageAdapter",
  "TodosShadowOutbox",
  "createTodosShadowOutbox",
  "installShadowOutboxSchema",
  "maybeInstallShadowCapture",
  "getRuntimeShadowOutbox",
  "startRuntimeShadowDrain",
  "registerShadowExitFlush",
  "closeRuntimeShadowCloud",
  "createTodosCloudQueryClient",
  "createTodosCloudQueryClientFromEnv",
  "TodosShadowMirror",
  "planRunArtifactsS3Sync",
  "createPostgresTodosStorageAdapter",
  "createPostgresTodosSyncStore",
  "createTodosS3ArtifactStore",
  "backfillPostgresCommentRedaction",
  "ensurePostgresScopedSlugUniqueIndexes",
  "uploadRunArtifactsToS3",
  "downloadRunArtifactsFromS3",
] as const;

const CLASS_PROTOTYPES = {
  TodosShadowMirror: [
    "getMetrics",
    "enqueueUpsert",
    "enqueueDelete",
    "flush",
    "idle",
    "notifyIdle",
    "pump",
    "drain",
    "process",
    "ensureSchema",
    "push",
  ],
  TodosShadowOutbox: [
    "install",
    "getStats",
    "countByStatus",
    "startLoop",
    "stopLoop",
    "flush",
    "drainOnce",
    "processRow",
    "buildSnapshot",
    "readCurrent",
    "tombstone",
    "ensureSchema",
  ],
} as const;

const STORAGE_BASELINE_FUNCTION_REFLECTION = {
  backfillPostgresCommentRedaction: 1,
  closeRuntimeShadowCloud: 0,
  createHybridTodosStorageAdapter: 1,
  createPostgresTodosStorageAdapter: 1,
  createPostgresTodosSyncStore: 1,
  createShadowTodosStorageAdapter: 1,
  createTodosCloudQueryClient: 1,
  createTodosCloudQueryClientFromEnv: 0,
  createTodosS3ArtifactStore: 1,
  createTodosShadowOutbox: 1,
  downloadRunArtifactsFromS3: 1,
  ensurePostgresScopedSlugUniqueIndexes: 1,
  getRuntimeShadowOutbox: 1,
  installShadowOutboxSchema: 1,
  maybeInstallShadowCapture: 1,
  planRunArtifactsS3Sync: 1,
  registerShadowExitFlush: 1,
  startRuntimeShadowDrain: 1,
  uploadRunArtifactsToS3: 1,
} as const;

const ROOT_BASELINE_FUNCTION_REFLECTION = {
  createHybridTodosStorageAdapter: 1,
  createPostgresTodosStorageAdapter: 1,
  createPostgresTodosSyncStore: 1,
  createTodosS3ArtifactStore: 1,
  downloadRunArtifactsFromS3: 1,
  planRunArtifactsS3Sync: 1,
  uploadRunArtifactsToS3: 1,
} as const;

const CLASS_METHOD_LENGTHS = {
  TodosShadowMirror: {
    getMetrics: 0,
    enqueueUpsert: 3,
    enqueueDelete: 3,
    flush: 0,
    idle: 0,
    notifyIdle: 0,
    pump: 0,
    drain: 0,
    process: 1,
    ensureSchema: 0,
    push: 1,
  },
  TodosShadowOutbox: {
    install: 0,
    getStats: 0,
    countByStatus: 1,
    startLoop: 0,
    stopLoop: 0,
    flush: 0,
    drainOnce: 0,
    processRow: 1,
    buildSnapshot: 1,
    readCurrent: 2,
    tombstone: 2,
    ensureSchema: 0,
  },
} as const;

/** Promise-returning runtime symbols at the pinned base 729ca65b. */
const ASYNC_STORAGE_FUNCTIONS = new Set<string>([
  "backfillPostgresCommentRedaction",
  "closeRuntimeShadowCloud",
  "downloadRunArtifactsFromS3",
  "ensurePostgresScopedSlugUniqueIndexes",
  "uploadRunArtifactsToS3",
]);

const ASYNC_CLASS_METHODS: Readonly<Record<keyof typeof CLASS_PROTOTYPES, ReadonlySet<string>>> = {
  TodosShadowMirror: new Set(["flush", "drain", "process", "ensureSchema", "push"]),
  TodosShadowOutbox: new Set(["flush", "drainOnce", "processRow", "buildSnapshot", "readCurrent", "ensureSchema"]),
};

function isClassExportName(name: string): name is keyof typeof CLASS_PROTOTYPES {
  return Object.prototype.hasOwnProperty.call(CLASS_PROTOTYPES, name);
}

async function expectStorageClassShape(namespace: Record<string, unknown>): Promise<void> {
  for (const [name, methods] of Object.entries(CLASS_PROTOTYPES)) {
    const Constructor = namespace[name] as Function;
    expect(Constructor.name).toBe(name);
    expect(Function.prototype.toString.call(Constructor)).toMatch(new RegExp(`^class\\s+${name}\\b`));
    expect(Constructor.prototype.constructor).toBe(Constructor);
    expect(Object.getOwnPropertyNames(Constructor.prototype).sort()).toEqual(
      ["constructor", ...methods].sort(),
    );

    const forged = Object.create(Constructor.prototype) as Record<string, (...args: unknown[]) => unknown>;
    for (const method of methods) {
      const descriptor = Object.getOwnPropertyDescriptor(Constructor.prototype, method);
      expect(descriptor).toMatchObject({ enumerable: false, configurable: true, writable: true });
      expect(typeof descriptor?.value).toBe("function");
      expect(descriptor?.value.name).toBe(method);
      expect(descriptor?.value.length).toBe(
        CLASS_METHOD_LENGTHS[name as keyof typeof CLASS_METHOD_LENGTHS][
          method as keyof (typeof CLASS_METHOD_LENGTHS)[keyof typeof CLASS_METHOD_LENGTHS]
        ],
      );
      if (ASYNC_CLASS_METHODS[name as keyof typeof ASYNC_CLASS_METHODS].has(method)) {
        let returned: unknown;
        expect(() => {
          returned = Reflect.apply(forged[method]!, forged, []);
        }, `${name}.${method} must preserve its base async call boundary`).not.toThrow();
        expect(returned, `${name}.${method} must return a Promise`).toBeInstanceOf(Promise);
        await expect(returned as Promise<unknown>).rejects.toThrow("HOSTED_AUTHORITY_UNAVAILABLE");
      } else {
        expect(() => Reflect.apply(forged[method]!, forged, []))
          .toThrow("HOSTED_AUTHORITY_UNAVAILABLE");
      }
    }
  }
}

function expectFunctionReflection(
  namespace: Record<string, unknown>,
  expected: Readonly<Record<string, number>>,
): void {
  for (const [name, length] of Object.entries(expected)) {
    const value = namespace[name] as Function;
    expect(typeof value).toBe("function");
    expect(value.name).toBe(name);
    expect(value.length).toBe(length);
  }
}

const SAFE_STORAGE_BASELINE_RUNTIME_EXPORTS = STORAGE_BASELINE_RUNTIME_EXPORTS.filter(
  (name) => !(FORBIDDEN_RUNTIME_EXPORTS as readonly string[]).includes(name),
);
const SAFE_ROOT_BASELINE_RUNTIME_EXPORTS = ROOT_BASELINE_RUNTIME_EXPORTS.filter(
  (name) => !(FORBIDDEN_RUNTIME_EXPORTS as readonly string[]).includes(name),
);
const ROOT_FORBIDDEN_RUNTIME_EXPORTS = ROOT_BASELINE_RUNTIME_EXPORTS.filter(
  (name) => (FORBIDDEN_RUNTIME_EXPORTS as readonly string[]).includes(name),
);

type BaselineStorageTypes = [
  StorageTypes.CreateShadowTodosStorageAdapterOptions,
  StorageTypes.ShadowTodosStorageAdapter,
  StorageTypes.TodosShadowMirrorEvent,
  StorageTypes.TodosShadowMirrorMetrics,
  StorageTypes.CreateTodosShadowOutboxOptions,
  StorageTypes.TodosShadowOutboxEvent,
  StorageTypes.TodosShadowOutboxStats,
  StorageTypes.CreateTodosCloudQueryClientOptions,
  StorageTypes.TodosCloudQueryClient,
  StorageTypes.CanonicalTodosRdsConfig,
  StorageTypes.CommentRedactionBackfillOptions,
  StorageTypes.CommentRedactionBackfillResult,
  StorageTypes.CreateHybridTodosStorageAdapterOptions,
  StorageTypes.CreatePostgresTodosStorageAdapterOptions,
  StorageTypes.CreatePostgresTodosSyncStoreOptions,
  StorageTypes.DownloadRunArtifactsFromS3Options,
  StorageTypes.HybridTodosRemoteSync,
  StorageTypes.HybridTodosStorageAdapter,
  StorageTypes.HybridTodosStorageSyncResult,
  StorageTypes.PostgresTodosSyncPushResult,
  StorageTypes.PostgresScopedSlugConflict,
  StorageTypes.PostgresScopedSlugIndexStatus,
  StorageTypes.PlanRunArtifactsS3SyncOptions,
  StorageTypes.PullPostgresTodosSnapshotOptions,
  StorageTypes.PutTodosS3ObjectInput,
  StorageTypes.SignAwsV4RequestInput,
  StorageTypes.SignedAwsV4Request,
  StorageTypes.TodosAwsCredentials,
  StorageTypes.TodosPostgresQueryClient,
  StorageTypes.TodosPostgresQueryResult<unknown>,
  StorageTypes.TodosPostgresSyncRecordRow,
  StorageTypes.TodosPostgresSyncRecordType,
  StorageTypes.TodosS3ArtifactStore,
  StorageTypes.TodosS3ArtifactStoreOptions,
  StorageTypes.TodosS3ObjectRef,
  StorageTypes.TodosRunArtifactRemoteRef,
  StorageTypes.TodosRunArtifactSyncFilter,
  StorageTypes.TodosRunArtifactSyncPlan,
  StorageTypes.TodosRunArtifactSyncResult,
  StorageTypes.UploadRunArtifactsToS3Options,
];

type BaselineRootTypes = [
  RootTypes.CreateHybridTodosStorageAdapterOptions,
  RootTypes.CreatePostgresTodosStorageAdapterOptions,
  RootTypes.CreatePostgresTodosSyncStoreOptions,
  RootTypes.DownloadRunArtifactsFromS3Options,
  RootTypes.HybridTodosRemoteSync,
  RootTypes.HybridTodosStorageAdapter,
  RootTypes.HybridTodosStorageSyncResult,
  RootTypes.PostgresTodosSyncPushResult,
  RootTypes.PlanRunArtifactsS3SyncOptions,
  RootTypes.PullPostgresTodosSnapshotOptions,
  RootTypes.PutTodosS3ObjectInput,
  RootTypes.SignAwsV4RequestInput,
  RootTypes.SignedAwsV4Request,
  RootTypes.TodosAwsCredentials,
  RootTypes.TodosPostgresQueryClient,
  RootTypes.TodosPostgresQueryResult<unknown>,
  RootTypes.TodosPostgresSyncRecordRow,
  RootTypes.TodosPostgresSyncRecordType,
  RootTypes.TodosS3ArtifactStore,
  RootTypes.TodosS3ArtifactStoreOptions,
  RootTypes.TodosS3ObjectRef,
  RootTypes.TodosRunArtifactRemoteRef,
  RootTypes.TodosRunArtifactSyncFilter,
  RootTypes.TodosRunArtifactSyncPlan,
  RootTypes.TodosRunArtifactSyncResult,
  RootTypes.UploadRunArtifactsToS3Options,
];

const BASELINE_TYPE_SURFACE_COMPILES: [BaselineStorageTypes, BaselineRootTypes] | null = null;

describe("public package Stage-A capability boundary", () => {
  test("source stubs preserve every pinned-base public function name and arity", () => {
    expectFunctionReflection(root, ROOT_BASELINE_FUNCTION_REFLECTION);
    expectFunctionReflection(storage, STORAGE_BASELINE_FUNCTION_REFLECTION);
  });

  test.each([
    ["@hasna/todos", root, ROOT_FORBIDDEN_RUNTIME_EXPORTS],
    ["@hasna/todos/storage", storage, FORBIDDEN_RUNTIME_EXPORTS],
  ] as const)("%s preserves former runtime names as deterministic no-I/O Stage-A stubs", (_name, namespace, expectedStubs) => {
    for (const exportName of expectedStubs) {
      expect(Object.prototype.hasOwnProperty.call(namespace, exportName)).toBe(true);
      expect(typeof namespace[exportName as keyof typeof namespace]).toBe("function");
    }
  });

  test.each([
    ["@hasna/todos", root, ROOT_BASELINE_RUNTIME_EXPORTS],
    ["@hasna/todos/storage", storage, STORAGE_BASELINE_RUNTIME_EXPORTS],
  ] as const)("%s links every pinned-base runtime export", (_name, namespace, expectedExports) => {
    expect(expectedExports.filter(
      (exportName) => !Object.prototype.hasOwnProperty.call(namespace, exportName),
    )).toEqual([]);
  });

  test("every restored remote-capable symbol preserves its base sync/async boundary before I/O", async () => {
    for (const exportName of FORBIDDEN_RUNTIME_EXPORTS) {
      const exported = storage[exportName as keyof typeof storage] as unknown as (...args: unknown[]) => unknown;
      if (isClassExportName(exportName)) {
        expect(() => Reflect.construct(exported, [])).toThrow("HOSTED_AUTHORITY_UNAVAILABLE");
      } else if (ASYNC_STORAGE_FUNCTIONS.has(exportName)) {
        let returned: unknown;
        expect(() => {
          returned = exported();
        }, `${exportName} must not throw synchronously`).not.toThrow();
        expect(returned, `${exportName} must return a Promise`).toBeInstanceOf(Promise);
        await expect(returned as Promise<unknown>).rejects.toThrow("HOSTED_AUTHORITY_UNAVAILABLE");
        expect(() => Reflect.construct(exported, [])).toThrow(TypeError);
      } else {
        expect(() => exported()).toThrow("HOSTED_AUTHORITY_UNAVAILABLE");
        expect(() => Reflect.construct(exported, [])).toThrow("HOSTED_AUTHORITY_UNAVAILABLE");
      }
    }
  });

  test("the source class stubs preserve distinct class and prototype shapes without reading options", async () => {
    const reads: string[] = [];
    const options = new Proxy({}, {
      get(_target, property) {
        reads.push(String(property));
        return undefined;
      },
    });
    const originalFetch = globalThis.fetch;
    const calls: string[] = [];
    try {
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        calls.push(String(input));
        return Response.json({});
      }) as typeof fetch;
      await expectStorageClassShape(storage);
      for (const name of Object.keys(CLASS_PROTOTYPES)) {
        expect(() => Reflect.construct(storage[name as keyof typeof storage] as Function, [options]))
          .toThrow("HOSTED_AUTHORITY_UNAVAILABLE");
      }
      expect(reads).toEqual([]);
      expect(calls).toEqual([]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("built root and storage entrypoints link the restored stubs with zero fetch", async () => {
    const outputRoot = mkdtempSync(join(tmpdir(), "todos-public-storage-build-"));
    const originalFetch = globalThis.fetch;
    const calls: string[] = [];
    try {
      const runtimeBuild = Bun.spawnSync([
        "bun", "build", "src/stage-a-public-runtime.ts",
        "--outfile", join(outputRoot, "stage-a-public-runtime.js"), "--target", "bun",
      ], { cwd: new URL("../..", import.meta.url).pathname, stdout: "pipe", stderr: "pipe" });
      expect(runtimeBuild.exitCode).toBe(0);
      const build = Bun.spawnSync([
        "bun", "build", "src/index.ts", "src/storage.ts", "--outdir", outputRoot, "--target", "bun",
      ], { cwd: new URL("../..", import.meta.url).pathname, stdout: "pipe", stderr: "pipe" });
      expect(build.exitCode).toBe(0);
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        calls.push(String(input));
        return Response.json({});
      }) as typeof fetch;
      const builtRoot = await import(`${pathToFileURL(join(outputRoot, "index.js")).href}?root=${Date.now()}`) as Record<string, unknown>;
      const builtStorage = await import(`${pathToFileURL(join(outputRoot, "storage.js")).href}?storage=${Date.now()}`) as Record<string, unknown>;
      expectFunctionReflection(builtRoot, ROOT_BASELINE_FUNCTION_REFLECTION);
      expectFunctionReflection(builtStorage, STORAGE_BASELINE_FUNCTION_REFLECTION);
      expect((builtStorage.buildS3ObjectKey as typeof storage.buildS3ObjectKey)(
        { prefix: "stage-a/" },
        "artifact.txt",
      )).toBe("stage-a/artifact.txt");
      for (const [namespace, names] of [
        [builtRoot, ROOT_FORBIDDEN_RUNTIME_EXPORTS],
        [builtStorage, FORBIDDEN_RUNTIME_EXPORTS],
      ] as const) {
        for (const name of names) {
          expect(typeof namespace[name]).toBe("function");
          if (isClassExportName(name)) {
            expect(() => Reflect.construct(namespace[name] as Function, []))
              .toThrow("HOSTED_AUTHORITY_UNAVAILABLE");
          } else if (ASYNC_STORAGE_FUNCTIONS.has(name)) {
            let returned: unknown;
            expect(() => {
              returned = (namespace[name] as () => unknown)();
            }, `${name} must not throw synchronously`).not.toThrow();
            expect(returned, `${name} must return a Promise`).toBeInstanceOf(Promise);
            await expect(returned as Promise<unknown>).rejects.toThrow("HOSTED_AUTHORITY_UNAVAILABLE");
          } else {
            expect(() => (namespace[name] as () => unknown)()).toThrow("HOSTED_AUTHORITY_UNAVAILABLE");
          }
        }
      }
      await expectStorageClassShape(builtStorage);
      expect(calls).toEqual([]);
    } finally {
      globalThis.fetch = originalFetch;
      rmSync(outputRoot, { recursive: true, force: true });
    }
  });

  test.each([
    ["@hasna/todos", root, SAFE_ROOT_BASELINE_RUNTIME_EXPORTS],
    ["@hasna/todos/storage", storage, SAFE_STORAGE_BASELINE_RUNTIME_EXPORTS],
  ] as const)("%s preserves every safe runtime export from pinned base", (_name, namespace, expectedExports) => {
    expect(expectedExports.filter(
      (exportName) => !Object.prototype.hasOwnProperty.call(namespace, exportName),
    )).toEqual([]);
  });

  test("authority-gated provider helpers preserve source names, arities, and authorized local behavior", () => {
    expect(storage.buildS3ObjectKey.name).toBe("buildS3ObjectKey");
    expect(storage.buildS3ObjectKey.length).toBe(2);
    expect(storage.buildS3ObjectUrl.name).toBe("buildS3ObjectUrl");
    expect(storage.buildS3ObjectUrl.length).toBe(2);
    expect(storage.signAwsV4Request.name).toBe("signAwsV4Request");
    expect(storage.signAwsV4Request.length).toBe(1);
    expect(storage.buildS3ObjectKey({ prefix: "stage-a/" }, "artifact.txt"))
      .toBe("stage-a/artifact.txt");
  });

  test("resolved lazy root values recheck process authority after a local-to-hosted role flip", () => {
    const originalPrimary = process.env.HASNA_TODOS_STORAGE_MODE;
    const originalFallback = process.env.TODOS_STORAGE_MODE;
    try {
      process.env.HASNA_TODOS_STORAGE_MODE = "local";
      process.env.TODOS_STORAGE_MODE = "local";
      expect(Reflect.ownKeys(root.ACCESS_PROFILES).length).toBeGreaterThan(0);
      const savedIncludes = root.ACCESS_PROFILES.includes;

      process.env.HASNA_TODOS_STORAGE_MODE = "remote";
      process.env.TODOS_STORAGE_MODE = "remote";
      expect(() => Reflect.ownKeys(root.ACCESS_PROFILES))
        .toThrow("HOSTED_AUTHORITY_UNAVAILABLE");
      expect(() => savedIncludes("minimal"))
        .toThrow("HOSTED_AUTHORITY_UNAVAILABLE");
    } finally {
      if (originalPrimary === undefined) delete process.env.HASNA_TODOS_STORAGE_MODE;
      else process.env.HASNA_TODOS_STORAGE_MODE = originalPrimary;
      if (originalFallback === undefined) delete process.env.TODOS_STORAGE_MODE;
      else process.env.TODOS_STORAGE_MODE = originalFallback;
    }
  });

  test("lazy public values preserve reflection invariants after preventExtensions, seal, and freeze", () => {
    const prevented = root.ACCESS_PROFILES;
    const sealed = root.ACTIVITY_ENTITY_TYPES;
    const frozen = root.AGENT_ADAPTER_DOCS;

    expect(() => Object.preventExtensions(prevented)).not.toThrow();
    expect(() => Reflect.ownKeys(prevented)).not.toThrow();
    expect(Object.isExtensible(prevented)).toBe(false);

    expect(() => Object.seal(sealed)).not.toThrow();
    expect(() => Reflect.ownKeys(sealed)).not.toThrow();
    expect(Object.isSealed(sealed)).toBe(true);

    expect(() => Object.freeze(frozen)).not.toThrow();
    expect(() => Reflect.ownKeys(frozen)).not.toThrow();
    expect(Object.isFrozen(frozen)).toBe(true);
  });

  test("the lazy public Set preserves native accessor semantics", () => {
    const publicSet = root.CORE_MCP_TOOLS;
    expect(publicSet.size).toBeGreaterThan(0);
    expect(publicSet.size).toBe([...publicSet].length);
  });

  test("the lazy public Set preserves native receiver and alias semantics", () => {
    const publicSet = root.CORE_MCP_TOOLS;
    const savedHas = publicSet.has;
    const foreign = new Set(["foreign-only"]);

    expect(publicSet.values).toBe(publicSet[Symbol.iterator]);
    expect(Reflect.apply(savedHas, foreign, ["foreign-only"])).toBe(true);
    expect(() => Reflect.apply(savedHas, undefined, ["foreign-only"])).toThrow(TypeError);
  });

  test("the lazy public Set keeps method wrappers stable across materialization", () => {
    const publicSet = root.CORE_MCP_TOOLS;
    const savedHas = publicSet.has;
    const savedValues = publicSet.values;
    const savedIterator = publicSet[Symbol.iterator];

    expect(Reflect.preventExtensions(publicSet)).toBe(true);
    expect(publicSet.has).toBe(savedHas);
    expect(publicSet.values).toBe(savedValues);
    expect(publicSet[Symbol.iterator]).toBe(savedIterator);
    expect(publicSet.values).toBe(publicSet[Symbol.iterator]);
  });

  test("the lazy public Set keeps wrapper identity across authority mode transitions", () => {
    const originalPrimary = process.env.HASNA_TODOS_STORAGE_MODE;
    const originalFallback = process.env.TODOS_STORAGE_MODE;
    try {
      process.env.HASNA_TODOS_STORAGE_MODE = "local";
      process.env.TODOS_STORAGE_MODE = "local";
      const publicSet = root.CORE_MCP_TOOLS;
      const savedHas = publicSet.has;
      const savedValues = publicSet.values;

      process.env.HASNA_TODOS_STORAGE_MODE = "remote";
      process.env.TODOS_STORAGE_MODE = "remote";
      expect(() => publicSet.has).toThrow("HOSTED_AUTHORITY_UNAVAILABLE");
      expect(() => savedHas("todos_list")).toThrow("HOSTED_AUTHORITY_UNAVAILABLE");

      process.env.HASNA_TODOS_STORAGE_MODE = "local";
      process.env.TODOS_STORAGE_MODE = "local";
      expect(publicSet.has).toBe(savedHas);
      expect(publicSet.values).toBe(savedValues);
      expect(publicSet.values).toBe(publicSet[Symbol.iterator]);
    } finally {
      if (originalPrimary === undefined) delete process.env.HASNA_TODOS_STORAGE_MODE;
      else process.env.HASNA_TODOS_STORAGE_MODE = originalPrimary;
      if (originalFallback === undefined) delete process.env.TODOS_STORAGE_MODE;
      else process.env.TODOS_STORAGE_MODE = originalFallback;
    }
  });

  test("the pinned-base type-only compatibility fixture compiles under typecheck", () => {
    expect(BASELINE_TYPE_SURFACE_COMPILES).toBeNull();
  });

  test("the package map exposes no operator or internal storage subpath", () => {
    const manifest = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
      exports?: Record<string, unknown>;
    };
    const subpaths = Object.keys(manifest.exports ?? {});
    expect(subpaths.filter((path) => /(?:operator|internal|postgres|cloud|migration|s3|shadow)/i.test(path))).toEqual([]);
  });

  test("the operator-capability module exposes no public issuer or runtime loader", async () => {
    const operator = await import("../server/operator-capability.js");
    expect(Object.keys(operator).sort()).toEqual(["TodosOperatorCapabilityError"]);
    expect(operator).not.toHaveProperty("issueTodosOperatorCapability");
    expect(operator).not.toHaveProperty("loadTodosMigrationOperator");
    expect(operator).not.toHaveProperty("loadTodosCommentRedactionOperator");
  });

  test("the explicit operator entrypoint is a dependency-light Stage A floor", () => {
    const source = readFileSync(new URL("../server/index.ts", import.meta.url), "utf8");
    const guardIndex = source.indexOf("enforceStageAOperatorFloor();");
    expect(guardIndex).toBeGreaterThan(-1);
    expect(source).not.toContain("issueTodosOperatorCapability");
    expect(source).not.toContain("loadTodosMigrationOperator");
    expect(source).not.toContain("loadTodosCommentRedactionOperator");
    expect(source).not.toContain('import("./cloud.js")');
    expect(source).not.toContain('import("../storage/comment-redaction-backfill.js")');
  });

  test("an injected local adapter rechecks role before using SQLite", () => {
    const originalPrimary = process.env.HASNA_TODOS_STORAGE_MODE;
    const originalFallback = process.env.TODOS_STORAGE_MODE;
    const db = openLocalSqliteDatabase(":memory:", {
      HASNA_TODOS_STORAGE_MODE: "local",
      TODOS_STORAGE_MODE: "local",
    });
    try {
      process.env.HASNA_TODOS_STORAGE_MODE = "local";
      process.env.TODOS_STORAGE_MODE = "local";
      const adapter = storage.createLocalSqliteTodosStorageAdapter({ db });
      process.env.HASNA_TODOS_STORAGE_MODE = "remote";
      process.env.TODOS_STORAGE_MODE = "remote";
      expect(() => adapter.tasks.get("synthetic-id")).toThrow("HOSTED_AUTHORITY_UNAVAILABLE");
    } finally {
      if (originalPrimary === undefined) delete process.env.HASNA_TODOS_STORAGE_MODE;
      else process.env.HASNA_TODOS_STORAGE_MODE = originalPrimary;
      if (originalFallback === undefined) delete process.env.TODOS_STORAGE_MODE;
      else process.env.TODOS_STORAGE_MODE = originalFallback;
      db.close();
    }
  });

  test("a hostile caller-supplied database object cannot receive local SQLite provenance", () => {
    const originalPrimary = process.env.HASNA_TODOS_STORAGE_MODE;
    const originalFallback = process.env.TODOS_STORAGE_MODE;
    let hostileReads = 0;
    const hostileDatabase = new Proxy({} as Database, {
      get() {
        hostileReads += 1;
        throw new Error("FAKE_ONLY_HOSTILE_DATABASE_MARKER");
      },
    });
    try {
      process.env.HASNA_TODOS_STORAGE_MODE = "local";
      process.env.TODOS_STORAGE_MODE = "local";
      expect(() => storage.createLocalSqliteTodosStorageAdapter({ db: hostileDatabase }))
        .toThrow("UNTRUSTED_SQLITE_PROVENANCE");
      expect(hostileReads).toBe(0);
    } finally {
      if (originalPrimary === undefined) delete process.env.HASNA_TODOS_STORAGE_MODE;
      else process.env.HASNA_TODOS_STORAGE_MODE = originalPrimary;
      if (originalFallback === undefined) delete process.env.TODOS_STORAGE_MODE;
      else process.env.TODOS_STORAGE_MODE = originalFallback;
    }
  });

  test("every representative public SQLite boundary rejects a raw Bun handle before data access", () => {
    const originalPrimary = process.env.HASNA_TODOS_STORAGE_MODE;
    const originalFallback = process.env.TODOS_STORAGE_MODE;
    const raw = new Database(":memory:");
    const rootFunctions = root as unknown as Record<string, (...args: any[]) => unknown>;
    const storageFunctions = storage as unknown as Record<string, (...args: any[]) => unknown>;
    try {
      process.env.HASNA_TODOS_STORAGE_MODE = "local";
      process.env.TODOS_STORAGE_MODE = "local";
      const boundaries: Array<[string, () => unknown]> = [
        ["root CRUD create", () => rootFunctions.createTask!({ title: "synthetic" }, raw)],
        ["root CRUD get", () => rootFunctions.getTask!("synthetic", raw)],
        ["root CRUD list", () => rootFunctions.listTasks!({}, raw)],
        ["root CRUD count", () => rootFunctions.countTasks!({}, raw)],
        ["root CRUD update", () => rootFunctions.updateTask!("synthetic", {}, raw)],
        ["root id resolution", () => rootFunctions.resolvePartialId!(raw, "tasks", "synthetic")],
        ["root plan", () => rootFunctions.createPlan!({ name: "synthetic" }, raw)],
        ["root search", () => rootFunctions.searchTasks!("synthetic", undefined, undefined, raw)],
        ["root report", () => rootFunctions.createLocalReport!({}, raw)],
        ["root report export", () => rootFunctions.buildReportExportData!({ kind: "project" }, raw)],
        ["root bundle export", () => rootFunctions.exportLocalBundle!({}, raw)],
        ["root snapshot export", () => rootFunctions.exportSqliteTodosStorageSnapshot!(raw)],
        ["root snapshot import", () => rootFunctions.importSqliteTodosStorageSnapshot!({}, raw)],
        ["storage snapshot export", () => storageFunctions.exportSqliteTodosStorageSnapshot!(raw)],
        ["storage snapshot import", () => storageFunctions.importSqliteTodosStorageSnapshot!({}, raw)],
      ];
      for (const [label, invoke] of boundaries) {
        expect(invoke, label).toThrow("UNTRUSTED_SQLITE_PROVENANCE");
      }
    } finally {
      raw.close();
      if (originalPrimary === undefined) delete process.env.HASNA_TODOS_STORAGE_MODE;
      else process.env.HASNA_TODOS_STORAGE_MODE = originalPrimary;
      if (originalFallback === undefined) delete process.env.TODOS_STORAGE_MODE;
      else process.env.TODOS_STORAGE_MODE = originalFallback;
    }
  });

  test("generated wrappers reject raw database values nested in options without querying them", () => {
    const originalPrimary = process.env.HASNA_TODOS_STORAGE_MODE;
    const originalFallback = process.env.TODOS_STORAGE_MODE;
    const raw = new Database(":memory:");
    try {
      process.env.HASNA_TODOS_STORAGE_MODE = "local";
      process.env.TODOS_STORAGE_MODE = "local";
      expect(() => (root.createLocalSqliteTodosStorageAdapter as Function)({ db: raw }))
        .toThrow("UNTRUSTED_SQLITE_PROVENANCE");
    } finally {
      raw.close();
      if (originalPrimary === undefined) delete process.env.HASNA_TODOS_STORAGE_MODE;
      else process.env.HASNA_TODOS_STORAGE_MODE = originalPrimary;
      if (originalFallback === undefined) delete process.env.TODOS_STORAGE_MODE;
      else process.env.TODOS_STORAGE_MODE = originalFallback;
    }
  });

  test("every generated runtime dispatch validates constructor-owned SQLite provenance first", () => {
    for (const relativePath of ["../index.ts", "../contracts.ts"] as const) {
      const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
      const dispatchLines = source.split("\n").filter((line) =>
        /return publicizePublicSqliteBoundaryResult\(Reflect\.(?:apply\(loadRuntime\(\)|construct\(runtimeClass)/.test(line)
      );

      expect(dispatchLines.length, `${relativePath} must contain generated runtime dispatches`)
        .toBeGreaterThan(0);
      expect(
        dispatchLines.filter((line) => !line.includes("preparePublicSqliteBoundaryArguments")),
        `${relativePath} must validate and unwrap every forwarded argument list before runtime dispatch`,
      ).toEqual([]);
    }
  });
});
