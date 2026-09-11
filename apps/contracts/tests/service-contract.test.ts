import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  SCHEMA_IDS,
  ServiceContractManifestSchema,
  SERVICE_CONTRACT_VERSION,
  allowedBinsForName,
  databaseUrlSecretRefFor,
  defaultSqlitePathFor,
  serviceContractSpec,
  validateServiceContractManifest,
  loadServiceContractManifest,
  SERVICE_CONTRACT_JSON_SCHEMA,
  ContractSchemaRegistry,
  SERVICE_SURFACE_KINDS,
  STORAGE_ENGINES,
  WAIVABLE_STORAGE_ENGINES,
  HOSTING_MODES,
  SERVING_ACCESS_MODES,
  FLEET_GATEWAY_HOST,
  clientKeySecretRefFor,
  gatewayClientBaseFor
} from "../src";

const repoRoot = join(import.meta.dir, "..");

const baseCliWithStore = {
  schema: SCHEMA_IDS.serviceContract,
  name: "todos",
  class: "cli-with-store",
  contractVersion: SERVICE_CONTRACT_VERSION,
  kitVersion: "0.3.0",
  bins: ["todos", "todos-mcp"],
  storage: {
    backend: "sqlite",
    sqlitePath: "~/.hasna/todos/todos.db"
  }
} as const;

describe("service contract helpers", () => {
  test("allowlist, secret ref, and sqlite path derivation", () => {
    expect(allowedBinsForName("todos")).toContain("todos");
    expect(allowedBinsForName("todos")).toContain("todos-serve");
    expect(allowedBinsForName("todos")).not.toContain("todos-sync");
    expect(allowedBinsForName("deployment")).toContain("hasna-deploy");
    expect(allowedBinsForName("deployment")).not.toContain("hasna-deployment");
    expect(allowedBinsForName("todos")).not.toContain("hasna-deploy");
    expect(databaseUrlSecretRefFor("todos")).toBe("hasna/oss/todos/database-url");
    expect(defaultSqlitePathFor("todos")).toBe("~/.hasna/todos/todos.db");
  });

  test("serviceContractSpec bundles env + refs", () => {
    const spec = serviceContractSpec("mailery");
    expect(spec.env.databaseUrlKeys[0]).toBe("HASNA_MAILERY_DATABASE_URL");
    expect(spec.databaseUrlSecretRef).toBe("hasna/oss/mailery/database-url");
    expect(spec.sqlitePath).toBe("~/.hasna/mailery/mailery.db");
  });

  test("is registered in the schema registry", () => {
    expect(ContractSchemaRegistry[SCHEMA_IDS.serviceContract]).toBe(ServiceContractManifestSchema);
  });

  test("exports the portable surface, storage capability, and hosting vocabularies", () => {
    expect(SERVICE_SURFACE_KINDS).toEqual(["api", "sdk", "mcp", "cli"]);
    expect(STORAGE_ENGINES).toEqual(["sqlite", "postgresql"]);
    expect(HOSTING_MODES).toEqual(["user-hosted", "hasna-saas"]);
  });
});

describe("service contract manifest validation", () => {
  test("accepts a valid cli-with-store manifest", () => {
    expect(validateServiceContractManifest(baseCliWithStore).success).toBe(true);
  });

  test("rejects bins outside the allowlist", () => {
    const bad = { ...baseCliWithStore, bins: ["todos", "todos-sync"] };
    const r = validateServiceContractManifest(bad);
    expect(r.success).toBe(false);
  });

  test("accepts only the registered hasna-deploy alias for the deployment app", () => {
    const deployment = {
      ...baseCliWithStore,
      name: "deployment",
      bins: ["deployment", "hasna-deploy"],
      storage: {
        backend: "sqlite",
        sqlitePath: "~/.hasna/deployment/deployment.db"
      }
    } as const;
    expect(validateServiceContractManifest(deployment).success).toBe(true);

    const wrongApp = validateServiceContractManifest({
      ...baseCliWithStore,
      bins: ["todos", "hasna-deploy"]
    });
    expect(wrongApp.success).toBe(false);
    if (!wrongApp.success) {
      expect(wrongApp.error.issues).toContainEqual(expect.objectContaining({
        path: ["bins", 1],
        message: expect.stringContaining('Bin "hasna-deploy" is not allowlisted for app "todos"')
      }));
    }

    expect(validateServiceContractManifest({
      ...deployment,
      bins: ["deployment", "hasna-deployment"]
    }).success).toBe(false);
  });

  test("rejects deprecated backend aliases in the manifest (strict enum)", () => {
    const bad = { ...baseCliWithStore, storage: { backend: "hybrid", sqlitePath: "x" } };
    expect(validateServiceContractManifest(bad).success).toBe(false);
  });

  test("rejects the removed placement field outright", () => {
    const parsed = validateServiceContractManifest({
      ...baseCliWithStore,
      deploymentModes: ["local", "self-hosted"]
    });
    expect(parsed.success).toBe(false);
  });

  test("defaults the public product story to user-hosted", () => {
    const parsed = validateServiceContractManifest(baseCliWithStore);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.hosting).toEqual(["user-hosted"]);
  });

  test("library must not declare storage or serve/mcp bins", () => {
    const lib = {
      schema: SCHEMA_IDS.serviceContract,
      name: "contracts",
      class: "library",
      contractVersion: SERVICE_CONTRACT_VERSION,
      kitVersion: "0.3.0",
      bins: ["contracts", "contracts-cli"]
    };
    expect(validateServiceContractManifest(lib).success).toBe(true);
    expect(validateServiceContractManifest({ ...lib, storage: { backend: "sqlite", sqlitePath: "x" } }).success).toBe(false);
    expect(validateServiceContractManifest({ ...lib, bins: ["contracts", "contracts-serve"] }).success).toBe(false);
  });

  test("postgres storage can use the public env contract without a secret reference", () => {
    const publicManifest = {
      ...baseCliWithStore,
      storage: {
        backend: "postgresql",
        envPrefix: "HASNA_TODOS_"
      }
    };
    expect(validateServiceContractManifest(publicManifest).success).toBe(true);

    const privateCompatibility = {
      ...baseCliWithStore,
      storage: {
        backend: "postgresql",
        envPrefix: "HASNA_TODOS_",
        databaseUrlSecretRef: "hasna/oss/todos/database-url"
      }
    };
    expect(validateServiceContractManifest(privateCompatibility).success).toBe(true);
  });

  test("service class requires a -serve bin and storage", () => {
    const svc = {
      schema: SCHEMA_IDS.serviceContract,
      name: "loops",
      class: "service",
      contractVersion: SERVICE_CONTRACT_VERSION,
      kitVersion: "0.3.0",
      bins: ["loops", "loops-serve"],
      storage: { backend: "postgresql", databaseUrlSecretRef: "hasna/oss/loops/database-url" },
      serviceSurfaces: [
        {
          name: "http",
          status: "supported",
          bin: "loops-serve",
          authMode: "api-key",
          health: { method: "GET", path: "/health", public: true },
          readiness: { method: "GET", path: "/ready", public: false },
          version: { method: "GET", path: "/version", public: true },
          apiBasePath: "/v1",
          readinessGates: [
            {
              id: "redaction",
              kind: "redaction",
              status: "pending"
            }
          ]
        }
      ]
    };
    expect(validateServiceContractManifest(svc).success).toBe(true);
    expect(validateServiceContractManifest({ ...svc, bins: ["loops"] }).success).toBe(false);
    expect(validateServiceContractManifest({ ...svc, serviceSurfaces: [] }).success).toBe(false);
  });

  test("supported API surfaces require GET health, readiness, and version endpoints", () => {
    const service = {
      schema: SCHEMA_IDS.serviceContract,
      name: "loops",
      class: "service",
      contractVersion: SERVICE_CONTRACT_VERSION,
      kitVersion: "0.7.0",
      bins: ["loops", "loops-serve"],
      storage: {
        backend: "sqlite",
        engines: ["sqlite", "postgresql"],
        envPrefix: "HASNA_LOOPS_",
        sqlitePath: "~/.hasna/loops/loops.db",
        pgTestGate: {
          envVar: "LOOPS_TEST_DATABASE_URL",
          command: "bun test tests/postgres.test.ts"
        }
      },
      serviceSurfaces: [
        {
          name: "http",
          kind: "api",
          status: "supported",
          bin: "loops-serve",
          authMode: "api-key",
          health: { method: "POST", path: "/health", public: true },
          version: { method: "POST", path: "/version", public: true },
          apiBasePath: "/v1",
          openApiPath: "/openapi.json"
        }
      ]
    };
    const parsed = validateServiceContractManifest(service);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const paths = parsed.error.issues.map((issue) => issue.path.join("."));
      expect(paths).toContain("serviceSurfaces.0.health.method");
      expect(paths).toContain("serviceSurfaces.0.readiness");
      expect(paths).toContain("serviceSurfaces.0.version.method");
    }
  });

  test("saas storage requires the public DATABASE_URL env prefix", () => {
    const saas = {
      schema: SCHEMA_IDS.serviceContract,
      name: "mailery",
      class: "saas",
      contractVersion: SERVICE_CONTRACT_VERSION,
      kitVersion: "0.7.0",
      bins: ["mailery", "mailery-serve"],
      hosting: ["hasna-saas"],
      storage: { backend: "postgresql" },
      serviceSurfaces: [
        {
          name: "http",
          kind: "api",
          status: "supported",
          bin: "mailery-serve",
          authMode: "api-key",
          health: { method: "GET", path: "/health", public: true },
          readiness: { method: "GET", path: "/ready", public: false },
          version: { method: "GET", path: "/version", public: true },
          apiBasePath: "/v1",
          openApiPath: "/openapi.json"
        }
      ]
    };
    const parsed = validateServiceContractManifest(saas);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((issue) => issue.path.join(".") === "storage.envPrefix")).toBe(true);
    }
  });

  test("service storage capability declarations require PostgreSQL", () => {
    const service = {
      schema: SCHEMA_IDS.serviceContract,
      name: "loops",
      class: "service",
      contractVersion: SERVICE_CONTRACT_VERSION,
      kitVersion: "0.6.0",
      bins: ["loops", "loops-serve"],
      storage: {
        backend: "sqlite",
        engines: ["sqlite"],
        sqlitePath: "~/.hasna/loops/loops.db"
      },
      serviceSurfaces: [
        {
          name: "http",
          status: "deferred",
          authMode: "api-key",
          deferReason: "Fixture only."
        }
      ]
    };
    const parsed = validateServiceContractManifest(service);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((issue) => issue.message.includes("must declare postgresql"))).toBe(true);
    }
  });

  test("service storage accepts PostgreSQL without inventing a legacy import engine", () => {
    const service = {
      schema: SCHEMA_IDS.serviceContract,
      name: "loops",
      class: "service",
      contractVersion: SERVICE_CONTRACT_VERSION,
      kitVersion: "0.6.0",
      bins: ["loops", "loops-serve"],
      storage: {
        backend: "postgresql",
        engines: ["postgresql"],
        envPrefix: "HASNA_LOOPS_",
        pgTestGate: { envVar: "LOOPS_TEST_DATABASE_URL", command: "bun test tests/postgres.test.ts" }
      },
      serviceSurfaces: [
        { name: "http", status: "deferred", authMode: "api-key", deferReason: "Fixture only." }
      ]
    };
    expect(validateServiceContractManifest(service).success).toBe(true);
  });

  test("rejects non-database SQLite paths", () => {
    const bad = {
      ...baseCliWithStore,
      storage: {
        backend: "sqlite",
        sqlitePath: "~/.hasna/todos/accounts.json"
      }
    };
    const parsed = validateServiceContractManifest(bad);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((issue) => issue.path.join(".") === "storage.sqlitePath")).toBe(true);
    }
  });

  test("rejects duplicate engines, hosting stories, and surface waivers", () => {
    const duplicateEngines = {
      ...baseCliWithStore,
      storage: {
        backend: "sqlite",
        engines: ["sqlite", "sqlite"],
        sqlitePath: "~/.hasna/todos/todos.db"
      }
    };
    expect(validateServiceContractManifest(duplicateEngines).success).toBe(false);
    expect(validateServiceContractManifest({ ...baseCliWithStore, hosting: ["user-hosted", "user-hosted"] }).success).toBe(false);
    expect(
      validateServiceContractManifest({
        ...baseCliWithStore,
        metadata: {
          conformance: {
            waivedSurfaces: [
              { kind: "api", reason: "No HTTP runtime." },
              { kind: "api", reason: "Duplicate waiver." }
            ]
          }
        }
      }).success
    ).toBe(false);
  });

  test("rejects malformed surface waivers", () => {
    const bad = {
      ...baseCliWithStore,
      metadata: {
        conformance: {
          waivedSurfaces: [{ kind: "sdk", reason: "   " }]
        }
      }
    };
    expect(validateServiceContractManifest(bad).success).toBe(false);
  });

  test("accepts a sqlite-only cli-with-store behind an explicit postgres waiver", () => {
    const waived = {
      ...baseCliWithStore,
      storage: {
        backend: "sqlite",
        engines: ["sqlite"],
        sqlitePath: "~/.hasna/todos/todos.db"
      },
      metadata: {
        conformance: {
          waivedStorageEngines: [
            {
              engine: "postgresql",
              reason: "SQLite-only local CLI; PostgreSQL adoption tracked in the storage-kit rollout.",
              reviewedBy: "platform-storage",
              expiresAt: "2099-01-01T00:00:00.000Z"
            }
          ]
        }
      }
    };
    const parsed = validateServiceContractManifest(waived);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.metadata?.conformance?.waivedStorageEngines).toEqual([
        {
          engine: "postgresql",
          reason: "SQLite-only local CLI; PostgreSQL adoption tracked in the storage-kit rollout.",
          reviewedBy: "platform-storage",
          expiresAt: "2099-01-01T00:00:00.000Z"
        }
      ]);
      expect(parsed.data.metadata?.conformance?.waivedSurfaces).toEqual([]);
    }

    const minimalWaiver = {
      ...waived,
      metadata: {
        conformance: {
          waivedStorageEngines: [{ engine: "postgresql", reason: "PostgreSQL support is not implemented yet." }]
        }
      }
    };
    expect(validateServiceContractManifest(minimalWaiver).success).toBe(true);
  });

  test("rejects sqlite-only cli-with-store storage without a postgres waiver", () => {
    const unwaived = {
      ...baseCliWithStore,
      storage: {
        backend: "sqlite",
        engines: ["sqlite"],
        sqlitePath: "~/.hasna/todos/todos.db"
      }
    };
    const parsed = validateServiceContractManifest(unwaived);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const issue = parsed.error.issues.find((entry) => entry.path.join(".") === "storage.engines");
      expect(issue?.message).toContain("waivedStorageEngines");
      expect(issue?.message).toContain("missing: postgresql");
    }
  });

  test("does not honour a storage waiver for a service-capable cli-with-store", () => {
    const serveCapable = {
      ...baseCliWithStore,
      bins: ["todos", "todos-serve"],
      storage: {
        backend: "sqlite",
        engines: ["sqlite"],
        sqlitePath: "~/.hasna/todos/todos.db"
      },
      metadata: {
        conformance: {
          waivedStorageEngines: [{ engine: "postgresql", reason: "Repo ships a server but wants sqlite only." }]
        }
      }
    };
    const parsed = validateServiceContractManifest(serveCapable);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const issue = parsed.error.issues.find((entry) => entry.path.join(".") === "storage.engines");
      expect(issue?.message).toContain("missing: postgresql");
    }
  });

  test("does not honour a storage waiver for a cli-with-store declaring a supported API on a non-serve bin", () => {
    // The ineligibility gate used to key on the string `${name}-serve`, so the
    // identical service could keep its waiver by binding its supported API to
    // any other allowlisted bin. `-daemon`, `-worker` and `-runner` are all in
    // ALLOWED_BIN_SUFFIXES, so this is reachable inside the manifest alone --
    // no source-level evasion required.
    const apiOnDaemonBin = {
      ...baseCliWithStore,
      bins: ["todos", "todos-daemon"],
      serviceSurfaces: [
        {
          name: "api",
          kind: "api",
          status: "supported",
          bin: "todos-daemon",
          authMode: "api-key",
          apiBasePath: "/v1",
          health: { method: "GET", path: "/health" },
          readiness: { method: "GET", path: "/ready" },
          version: { method: "GET", path: "/version" }
        }
      ],
      storage: {
        backend: "sqlite",
        engines: ["sqlite"],
        sqlitePath: "~/.hasna/todos/todos.db"
      },
      metadata: {
        conformance: {
          waivedStorageEngines: [
            { engine: "postgresql", reason: "Ships a supported API but wants sqlite only." }
          ]
        }
      }
    };
    const parsed = validateServiceContractManifest(apiOnDaemonBin);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const issue = parsed.error.issues.find((entry) => entry.path.join(".") === "storage.engines");
      expect(issue?.message).toContain("declared waiver ignored");
      expect(issue?.message).toContain("supported api service surface");
      expect(issue?.message).toContain("missing: postgresql");
    }

    // NEGATIVE HALF, and it is the half that bounds the change. A `deferred`
    // API surface is a repo documenting a loopback dev convenience, not a
    // claim that PostgreSQL is in play, so it MUST stay eligible. Without this
    // the fix would silently revoke real waivers (hasna/catalog is exactly
    // this shape: `catalog serve` ships, declared `deferred`, no serve bin).
    const deferredApi = {
      ...apiOnDaemonBin,
      serviceSurfaces: [
        {
          name: "api",
          kind: "api",
          status: "deferred",
          deferReason: "Loopback-only read model; not a supported service surface.",
          authMode: "none"
        }
      ]
    };
    expect(validateServiceContractManifest(deferredApi).success).toBe(true);
  });

  test("does not honour a storage waiver for a postgres backend or a saas story", () => {
    const cases: Array<Record<string, unknown>> = [
      {
        ...baseCliWithStore,
        storage: { backend: "postgresql", engines: ["sqlite"], envPrefix: "HASNA_TODOS_" }
      },
      {
        ...baseCliWithStore,
        hosting: ["user-hosted", "hasna-saas"],
        storage: { backend: "sqlite", engines: ["sqlite"], sqlitePath: "~/.hasna/todos/todos.db" }
      }
    ];
    for (const base of cases) {
      const manifest = {
        ...base,
        metadata: {
          conformance: {
            waivedStorageEngines: [{ engine: "postgresql", reason: "Ineligible manifest tries to drop PostgreSQL." }]
          }
        }
      };
      const parsed = validateServiceContractManifest(manifest);
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        const issue = parsed.error.issues.find((entry) => entry.path.join(".") === "storage.engines");
        expect(issue?.message).toContain("missing: postgresql");
      }
    }

    // A plain sqlite CLI stays eligible: the backend is what decides.
    const sqliteOnly = {
      ...baseCliWithStore,
      storage: { backend: "sqlite", engines: ["sqlite"], sqlitePath: "~/.hasna/todos/todos.db" },
      metadata: {
        conformance: {
          waivedStorageEngines: [{ engine: "postgresql", reason: "SQLite-only local CLI." }]
        }
      }
    };
    expect(validateServiceContractManifest(sqliteOnly).success).toBe(true);
  });

  test("names the refusal reason when an ineligible manifest tried to waive", () => {
    const serveCapable = {
      ...baseCliWithStore,
      bins: ["todos", "todos-serve"],
      storage: { backend: "sqlite", engines: ["sqlite"], sqlitePath: "~/.hasna/todos/todos.db" },
      metadata: {
        conformance: {
          waivedStorageEngines: [{ engine: "postgresql", reason: "Repo ships a server but wants sqlite only." }]
        }
      }
    };
    const parsed = validateServiceContractManifest(serveCapable);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      // This issue aborts the parse, so conformance never runs; the reason the
      // waiver was ignored has to be stated here or nowhere.
      const issue = parsed.error.issues.find((entry) => entry.path.join(".") === "storage.engines");
      expect(issue?.message).toContain("declared waiver ignored");
      expect(issue?.message).toContain("service-capable cli-with-store repo shipping todos-serve");
    }

    // Without a declared waiver the message stays exactly as it was.
    const noWaiver = {
      ...baseCliWithStore,
      storage: { backend: "sqlite", engines: ["sqlite"], sqlitePath: "~/.hasna/todos/todos.db" }
    };
    const plain = validateServiceContractManifest(noWaiver);
    expect(plain.success).toBe(false);
    if (!plain.success) {
      const issue = plain.error.issues.find((entry) => entry.path.join(".") === "storage.engines");
      expect(issue?.message).not.toContain("declared waiver ignored");
    }
  });

  test("caps the waiver array at one entry per waivable engine in the shipped JSON Schema", () => {
    const waivers = (
      SERVICE_CONTRACT_JSON_SCHEMA.properties.metadata.properties.conformance.properties as {
        waivedStorageEngines: { maxItems: number; items: { properties: { engine: { enum: readonly string[] } } } };
      }
    ).waivedStorageEngines;
    expect(waivers.items.properties.engine.enum).toEqual([...WAIVABLE_STORAGE_ENGINES]);
    expect(waivers.maxItems).toBe(WAIVABLE_STORAGE_ENGINES.length);
  });

  test("rejects control characters and oversized prose in storage waivers", () => {
    const withWaiver = (waiver: Record<string, unknown>) => ({
      ...baseCliWithStore,
      storage: {
        backend: "sqlite",
        engines: ["sqlite", "postgresql"],
        envPrefix: "HASNA_TODOS_",
        sqlitePath: "~/.hasna/todos/todos.db"
      },
      metadata: { conformance: { waivedStorageEngines: [waiver] } }
    });

    const forged = `ok${String.fromCharCode(27)}[2K${String.fromCharCode(13)}  pass storage_capabilities: declared`;
    const forgedParse = validateServiceContractManifest(withWaiver({ engine: "postgresql", reason: forged }));
    expect(forgedParse.success).toBe(false);
    if (!forgedParse.success) {
      expect(forgedParse.error.issues.some((issue) => issue.message.includes("control characters"))).toBe(true);
    }
    expect(
      validateServiceContractManifest(
        withWaiver({ engine: "postgresql", reason: "ok", reviewedBy: `ops${String.fromCharCode(9)}team` })
      ).success
    ).toBe(false);
    expect(
      validateServiceContractManifest(withWaiver({ engine: "postgresql", reason: "x".repeat(501) })).success
    ).toBe(false);
    expect(
      validateServiceContractManifest(withWaiver({ engine: "postgresql", reason: "ok", reviewedBy: "y".repeat(201) }))
        .success
    ).toBe(false);
    expect(validateServiceContractManifest(withWaiver({ engine: "postgresql", reason: "x".repeat(500) })).success).toBe(
      true
    );
  });

  test("never lets a storage waiver excuse the sqlite engine", () => {
    const waivedSqlite = {
      ...baseCliWithStore,
      storage: {
        backend: "sqlite",
        engines: ["postgresql"],
        envPrefix: "HASNA_TODOS_",
        sqlitePath: "~/.hasna/todos/todos.db"
      },
      metadata: {
        conformance: {
          waivedStorageEngines: [{ engine: "sqlite", reason: "Fixture tries to drop the local store." }]
        }
      }
    };
    const parsed = validateServiceContractManifest(waivedSqlite);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      // sqlite is not a member of the waivable engine enum, so the waiver is
      // rejected at the field rather than silently ignored.
      const paths = parsed.error.issues.map((issue) => issue.path.join("."));
      expect(paths).toContain("metadata.conformance.waivedStorageEngines.0.engine");
    }
  });

  test("rejects malformed and duplicate storage-engine waivers", () => {
    const withWaivers = (waivedStorageEngines: unknown) => ({
      ...baseCliWithStore,
      storage: {
        backend: "sqlite",
        engines: ["sqlite", "postgresql"],
        envPrefix: "HASNA_TODOS_",
        sqlitePath: "~/.hasna/todos/todos.db"
      },
      metadata: { conformance: { waivedStorageEngines } }
    });

    expect(validateServiceContractManifest(withWaivers([{ engine: "postgresql", reason: "   " }])).success).toBe(false);
    expect(validateServiceContractManifest(withWaivers([{ engine: "mysql", reason: "Unknown engine." }])).success).toBe(false);
    expect(validateServiceContractManifest(withWaivers([{ reason: "Missing engine." }])).success).toBe(false);
    expect(
      validateServiceContractManifest(
        withWaivers([{ engine: "postgresql", reason: "Unknown key.", waivedUntil: "2099-01-01" }])
      ).success
    ).toBe(false);
    expect(
      validateServiceContractManifest(withWaivers([{ engine: "postgresql", reason: "Bad expiry.", expiresAt: "2099-01-01" }]))
        .success
    ).toBe(false);
    expect(
      validateServiceContractManifest(withWaivers([{ engine: "postgresql", reason: "Blank reviewer.", reviewedBy: "  " }]))
        .success
    ).toBe(false);

    const duplicate = validateServiceContractManifest(
      withWaivers([
        { engine: "postgresql", reason: "First waiver." },
        { engine: "postgresql", reason: "Duplicate waiver." }
      ])
    );
    expect(duplicate.success).toBe(false);
    if (!duplicate.success) {
      expect(
        duplicate.error.issues.some(
          (issue) => issue.path.join(".") === "metadata.conformance.waivedStorageEngines.1.engine"
        )
      ).toBe(true);
    }
  });

  test("keeps an expired storage waiver schema-valid so conformance owns the expiry verdict", () => {
    const expired = {
      ...baseCliWithStore,
      storage: {
        backend: "sqlite",
        engines: ["sqlite"],
        sqlitePath: "~/.hasna/todos/todos.db"
      },
      metadata: {
        conformance: {
          waivedStorageEngines: [
            { engine: "postgresql", reason: "Waiver lapsed.", expiresAt: "2020-01-01T00:00:00.000Z" }
          ]
        }
      }
    };
    expect(validateServiceContractManifest(expired).success).toBe(true);
  });

  test("types the exceptional non-Node surface waiver profile", () => {
    const eligible = {
      ...baseCliWithStore,
      metadata: {
        conformance: {
          waiverProfile: "non-node-monorepo",
          waivedSurfaces: [{ kind: "sdk", reason: "SDK is provided by the non-Node toolchain." }]
        }
      }
    };
    expect(validateServiceContractManifest(eligible).success).toBe(true);

    const invalid = {
      ...eligible,
      metadata: {
        conformance: {
          waiverProfile: "arbitrary-exception",
          waivedSurfaces: [{ kind: "sdk", reason: "Invalid profile." }]
        }
      }
    };
    expect(validateServiceContractManifest(invalid).success).toBe(false);
  });

  test("preserves legacy conformance metadata while typing surface waivers", () => {
    const legacy = {
      ...baseCliWithStore,
      metadata: {
        conformance: {
          checkCommand: "bun run check:contracts",
          evidencePath: "artifacts/contracts.json"
        }
      }
    };
    const parsed = validateServiceContractManifest(legacy);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.metadata?.conformance?.checkCommand).toBe("bun run check:contracts");
      expect(parsed.data.metadata?.conformance?.waivedSurfaces).toEqual([]);
    }
  });

  test("service surfaces require lifecycle endpoints or explicit defer reasons", () => {
    const badSupported = {
      ...baseCliWithStore,
      class: "service",
      bins: ["todos", "todos-serve"],
      storage: { backend: "postgresql", databaseUrlSecretRef: "hasna/oss/todos/database-url" },
      serviceSurfaces: [
        {
          name: "http",
          status: "supported",
          bin: "todos-serve",
          authMode: "api-key",
        }
      ]
    };
    expect(validateServiceContractManifest(badSupported).success).toBe(false);

    const deferred = {
      ...badSupported,
      serviceSurfaces: [
        {
          name: "http",
          status: "deferred",
          authMode: "api-key",
          deferReason: "Hosted service boundary still returns raw secret values."
        }
      ]
    };
    expect(validateServiceContractManifest(deferred).success).toBe(true);
  });

  test("saas class must declare the Hasna SaaS hosting story", () => {
    const saas = {
      schema: SCHEMA_IDS.serviceContract,
      name: "mailery",
      class: "saas",
      contractVersion: SERVICE_CONTRACT_VERSION,
      kitVersion: "0.3.0",
      bins: ["mailery", "mailery-serve"],
      storage: { backend: "sqlite", sqlitePath: "x" }
    };
    expect(validateServiceContractManifest(saas).success).toBe(false);
  });
});

describe("serving contract (gateway route declaration)", () => {
  // A served app: ships a <-serve> bin, routes through the shared gateway.
  const baseService = {
    schema: SCHEMA_IDS.serviceContract,
    name: "notes",
    class: "service",
    contractVersion: SERVICE_CONTRACT_VERSION,
    kitVersion: "1.0.2",
    bins: ["notes", "notes-mcp", "notes-serve"],
    storage: {
      backend: "postgresql",
      engines: ["postgresql"],
      envPrefix: "HASNA_NOTES_",
      pgTestGate: { envVar: "NOTES_TEST_DATABASE_URL", command: "bun run test:pg" }
    },
    serviceSurfaces: [
      {
        name: "notes-serve",
        kind: "api",
        status: "supported",
        bin: "notes-serve",
        authMode: "api-key",
        health: { method: "GET", path: "/health" },
        readiness: { method: "GET", path: "/ready" },
        version: { method: "GET", path: "/version" }
      }
    ]
  } as const;

  const baseServing = {
    routeSlug: "notes",
    access: "api-key",
    targetClientBase: gatewayClientBaseFor("notes")
  } as const;

  test("the fixture is a valid service manifest before serving is added", () => {
    expect(validateServiceContractManifest(baseService).success).toBe(true);
  });

  test("the hosting enum is unchanged, so route placement is not a product story", () => {
    // The decision on record: a route is expressed by `serving`, never by a new
    // `hosting` value. `hosting` still rejects anything outside its two stories.
    expect(HOSTING_MODES).toEqual(["user-hosted", "hasna-saas"]);
    expect(SERVING_ACCESS_MODES).toEqual(["public", "api-key", "signature"]);
    expect(validateServiceContractManifest({ ...baseService, hosting: ["gateway"] }).success).toBe(false);
    expect(validateServiceContractManifest({ ...baseService, hosting: ["user-hosted", "hasna-saas"] }).success).toBe(true);
  });

  test("the old shape (no serving key) still validates and asserts no route", () => {
    const parsed = ServiceContractManifestSchema.parse(baseService);
    expect(parsed.serving).toBeUndefined();
  });

  test("the new shape (serving key) validates and round-trips", () => {
    const result = validateServiceContractManifest({ ...baseService, serving: baseServing });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.serving).toEqual(baseServing);
    }
  });

  test("a non-gateway client base is accepted (a pinned-origin override)", () => {
    const result = validateServiceContractManifest({
      ...baseService,
      serving: { ...baseServing, targetClientBase: "https://notes.example.com" }
    });
    expect(result.success).toBe(true);
  });

  test("the secret ref and default base mirror the fleet registry", () => {
    expect(FLEET_GATEWAY_HOST).toBe("api.hasna.com");
    expect(clientKeySecretRefFor("notes")).toBe("hasna/oss/notes/api-key");
    expect(gatewayClientBaseFor("notes")).toBe("https://api.hasna.com/notes");
  });

  test("rejects a base ending in /v1, a trailing slash, credentials, query, or plain http", () => {
    for (const targetClientBase of [
      "https://api.hasna.com/notes/v1",
      // Non-gateway hosts are exempt from the routeSlug-prefix rule, so this
      // one isolates the /v1 rule as load-bearing on its own.
      "https://notes.example.com/v1",
      "https://api.hasna.com/notes/",
      "https://user:pass@api.hasna.com/notes",
      "https://api.hasna.com/notes?x=1",
      "https://api.hasna.com/notes#frag",
      "http://api.hasna.com/notes"
    ]) {
      expect(
        validateServiceContractManifest({ ...baseService, serving: { ...baseServing, targetClientBase } }).success,
        `${targetClientBase} must be rejected`
      ).toBe(false);
    }
  });

  test("rejects a gateway base whose path segment is not the routeSlug", () => {
    const result = validateServiceContractManifest({
      ...baseService,
      serving: { ...baseServing, targetClientBase: "https://api.hasna.com/messages" }
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path.join("."))).toContain("serving.targetClientBase");
    }
  });

  test("rejects a routeSlug that is not a lowercase dashed slug", () => {
    for (const routeSlug of ["Notes", "notes/v1", "-notes", "notes_api"]) {
      const result = validateServiceContractManifest({
        ...baseService,
        serving: { ...baseServing, routeSlug, targetClientBase: "https://notes.example.com" }
      });
      expect(result.success, `${routeSlug} must be rejected`).toBe(false);
    }
  });

  test("rejects an unknown access mode and an unknown key inside serving (strict block)", () => {
    expect(
      validateServiceContractManifest({ ...baseService, serving: { ...baseServing, access: "oauth" } }).success
    ).toBe(false);
    const withExtra = validateServiceContractManifest({
      ...baseService,
      serving: { ...baseServing, notes: "unknown" }
    });
    expect(withExtra.success).toBe(false);
    if (!withExtra.success) {
      expect(withExtra.error.issues.some((issue) => issue.code === "unrecognized_keys")).toBe(true);
    }
  });

  test("rejects a serving block missing a required field", () => {
    const { access: _access, ...withoutAccess } = baseServing;
    expect(
      validateServiceContractManifest({ ...baseService, serving: withoutAccess }).success
    ).toBe(false);
    const { targetClientBase: _base, ...withoutBase } = baseServing;
    expect(
      validateServiceContractManifest({ ...baseService, serving: withoutBase }).success
    ).toBe(false);
  });

  test("rejects serving on a library repo, which ships no serve surface", () => {
    const library = {
      schema: SCHEMA_IDS.serviceContract,
      name: "contracts",
      class: "library",
      contractVersion: SERVICE_CONTRACT_VERSION,
      kitVersion: "1.0.2",
      bins: ["contracts"]
    } as const;
    expect(validateServiceContractManifest(library).success).toBe(true);
    const result = validateServiceContractManifest({
      ...library,
      serving: { routeSlug: "contracts", access: "api-key", targetClientBase: gatewayClientBaseFor("contracts") }
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path.join("."))).toContain("serving");
    }
  });

  test("an unknown top-level key is still rejected — serving did not relax strictness", () => {
    expect(
      validateServiceContractManifest({ ...baseService, unrouted: true }).success
    ).toBe(false);
  });
});

describe("service contract JSON schema and repo manifest", () => {
  test("shipped JSON schema file matches the exported constant", () => {
    const shipped = JSON.parse(readFileSync(join(repoRoot, "src", "hasna.contract.schema.json"), "utf8"));
    expect(shipped).toEqual(SERVICE_CONTRACT_JSON_SCHEMA);
  });

  test("this repo's hasna.contract.json is a valid library manifest", () => {
    const loaded = loadServiceContractManifest(repoRoot);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.manifest.name).toBe("contracts");
      expect(loaded.manifest.class).toBe("library");
    }
  });

  test("this repo dogfoods the package version and explicit surface policy", () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as { version: string };
    const loaded = loadServiceContractManifest(repoRoot);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.manifest.kitVersion).toBe(pkg.version);
      expect(loaded.manifest.hosting).toEqual(["user-hosted"]);
      expect(loaded.manifest.serviceSurfaces.map((surface) => surface.kind)).toEqual(["sdk", "cli"]);
      expect(loaded.manifest.metadata?.conformance?.waivedSurfaces.map((waiver) => waiver.kind)).toEqual(["api", "mcp"]);
    }
  });

  test("the shipped JSON Schema carries a closed serving object and an unchanged hosting enum", () => {
    const shipped = JSON.parse(readFileSync(join(repoRoot, "src", "hasna.contract.schema.json"), "utf8")) as any;
    const serving = shipped.properties?.serving;
    expect(serving, "serving is declared").toBeDefined();
    expect(serving.additionalProperties, "serving is closed").toBe(false);
    expect(serving.required).toEqual(["routeSlug", "access", "targetClientBase"]);
    expect(serving.properties.routeSlug.pattern).toBe("^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$");
    expect(serving.properties.access.enum).toEqual(["public", "api-key", "signature"]);
    // The route schema is additive: the product-story enum is untouched.
    expect(shipped.properties.hosting.items.enum).toEqual(["user-hosted", "hasna-saas"]);
  });
});

describe("client contract (1.1.0): scope, client and dataAccess cross-checks", () => {
  const base = {
    schema: SCHEMA_IDS.serviceContract,
    name: "demo",
    class: "cli-with-store",
    contractVersion: SERVICE_CONTRACT_VERSION,
    kitVersion: "1.1.0",
    bins: ["demo", "demo-mcp"],
    storage: {
      backend: "postgresql",
      engines: ["sqlite", "postgresql"],
      envPrefix: "HASNA_DEMO_",
      pgTestGate: { envVar: "DEMO_TEST_DATABASE_URL", command: "bun test tests/pg.test.ts" }
    }
  } as const;
  const hostedClient = {
    transport: "hosted",
    credentialChain: "contracts",
    localOptIn: "HASNA_DEMO_LOCAL",
    localStoreModule: "src/db/database.ts",
    readProbe: ["list", "--limit", "1"]
  } as const;
  const cli = (dataAccess?: string) => [{ name: "cli", kind: "cli", status: "supported", bin: "demo", authMode: "local-only", ...(dataAccess ? { dataAccess } : {}) }];
  const paths = (value: unknown) => {
    const result = validateServiceContractManifest(value);
    return result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
  };

  test("the old shape validates and asserts nothing about the client", () => {
    const parsed = ServiceContractManifestSchema.parse(base);
    expect(parsed.scope).toBeUndefined();
    expect(parsed.client).toBeUndefined();
  });

  test("a hosted client with the one door, its store module and a read probe validates", () => {
    expect(paths({ ...base, scope: "public", client: hostedClient, serviceSurfaces: cli("hosted") })).toEqual([]);
    expect(paths({ ...base, scope: "internal", client: { transport: "hosted", credentialChain: "contracts", localOptIn: null } })).toEqual([]);
    expect(paths({ ...base, client: hostedClient, serviceSurfaces: cli("local-opt-in") })).toEqual([]);
  });

  test("the door must be HASNA_<NAME>_LOCAL and must name its store module (and vice versa)", () => {
    expect(paths({ ...base, client: { ...hostedClient, localOptIn: "HASNA_OTHER_LOCAL" } })).toEqual(["client.localOptIn"]);
    expect(paths({ ...base, client: { ...hostedClient, localStoreModule: undefined } })).toEqual(["client.localStoreModule"]);
    expect(paths({ ...base, client: { transport: "hosted", credentialChain: "contracts", localStoreModule: "src/db/database.ts" } })).toEqual(["client.localOptIn"]);
    expect(paths({ ...base, client: { ...hostedClient, authority: "https://api.hasna.com/demo/v1" } })).toEqual(["client.authority"]);
  });

  test("client: null is local-by-design: dataAccess is omitted or server-only, never hosted or local-opt-in", () => {
    expect(paths({ ...base, client: null, serviceSurfaces: cli() })).toEqual([]);
    expect(paths({ ...base, client: null, serviceSurfaces: cli("server-only") })).toEqual([]);
    expect(paths({ ...base, client: null, serviceSurfaces: cli("hosted") })).toEqual(["serviceSurfaces.0.dataAccess"]);
    expect(paths({ ...base, client: null, serviceSurfaces: cli("local-opt-in") })).toEqual(["serviceSurfaces.0.dataAccess"]);
    // A per-command declaration is held to the same rule.
    expect(paths({ ...base, client: null, serviceSurfaces: [{ ...cli()[0], commands: [{ name: "list", dataAccess: "hosted" }] }] })).toEqual(["serviceSurfaces.0.dataAccess"]);
  });

  test("local-opt-in access without a declared door, and a client on a library, are rejected", () => {
    expect(paths({ ...base, serviceSurfaces: cli("local-opt-in") })).toEqual(["serviceSurfaces.0.dataAccess"]);
    const library = { schema: SCHEMA_IDS.serviceContract, name: "kit", class: "library", contractVersion: SERVICE_CONTRACT_VERSION, kitVersion: "1.1.0", bins: ["kit"] } as const;
    expect(paths(library)).toEqual([]);
    expect(paths({ ...library, client: null })).toEqual([]);
    expect(paths({ ...library, client: { transport: "hosted", credentialChain: "contracts" } })).toEqual(["client"]);
  });

  test("the retired placement axis stays rejected; scope and dataAccess are closed enums", () => {
    const placement = validateServiceContractManifest({ ...base, placement: { hosted: "never" } });
    expect(placement.success).toBe(false);
    if (!placement.success) {
      expect(placement.error.issues.some((issue) => issue.code === "unrecognized_keys" && JSON.stringify(issue).includes("placement"))).toBe(true);
    }
    expect(paths({ ...base, scope: "shared" })).toEqual(["scope"]);
    expect(paths({ ...base, serviceSurfaces: cli("local") })).toEqual(["serviceSurfaces.0.dataAccess"]);
    expect(paths({ ...base, client: { transport: "sqlite", credentialChain: "contracts" } })).toEqual(["client.transport"]);
  });
});
