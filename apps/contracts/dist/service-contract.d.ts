import type { z } from "zod";
import { type ServiceContractManifest } from "./schemas";
import { type ServerDataBackendEnvKeys } from "./server-backend";
export declare const SERVICE_CONTRACT_MANIFEST_FILENAME = "hasna.contract.json";
/**
 * Draft-07 JSON Schema for `hasna.contract.json`. This is the source of truth
 * for external editor tooling; `src/hasna.contract.schema.json` is a shipped
 * copy kept identical by a conformance test. Runtime validation uses the Zod
 * schema (`ServiceContractManifestSchema`), which enforces the class rules.
 */
export declare const SERVICE_CONTRACT_JSON_SCHEMA: {
    readonly $schema: "http://json-schema.org/draft-07/schema#";
    readonly $id: "https://github.com/hasna/contracts/schema/hasna.service_contract.v1.json";
    readonly title: "Hasna Service Contract v1";
    readonly description: "Repo self-description (hasna.contract.json) for the Hasna Service Contract v1. Public clients use one authenticated HTTPS service transport; authoritative server data is PostgreSQL.";
    readonly type: "object";
    readonly additionalProperties: false;
    readonly required: readonly ["schema", "name", "class", "contractVersion", "kitVersion"];
    readonly allOf: readonly [{
        readonly if: {
            readonly required: readonly ["class"];
            readonly properties: {
                readonly class: {
                    readonly const: "saas";
                };
            };
        };
        readonly then: {
            readonly required: readonly ["storage"];
            readonly properties: {
                readonly storage: {
                    readonly required: readonly ["backend", "envPrefix"];
                    readonly properties: {
                        readonly backend: {
                            readonly const: "postgresql";
                        };
                    };
                };
            };
        };
    }];
    readonly properties: {
        readonly $schema: {
            readonly type: "string";
            readonly description: "Optional editor hint pointing at this JSON Schema.";
        };
        readonly schema: {
            readonly const: "hasna.service_contract.v1";
        };
        readonly name: {
            readonly type: "string";
            readonly pattern: "^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$";
            readonly description: "Lowercase dashed app short-name, e.g. todos, mailery, loops.";
        };
        readonly class: {
            readonly enum: readonly ["library", "cli-with-store", "service", "saas"];
        };
        readonly contractVersion: {
            readonly const: "v1";
        };
        readonly kitVersion: {
            readonly type: "string";
            readonly minLength: 1;
            readonly description: "Version of @hasna/contracts (the contract kit) the repo tracks.";
        };
        readonly description: {
            readonly type: "string";
            readonly minLength: 1;
        };
        readonly bins: {
            readonly type: "array";
            readonly items: {
                readonly type: "string";
                readonly minLength: 1;
            };
            readonly description: "Declared bins. Allowlisted: <name>, <name>-cli, <name>-mcp, <name>-serve, <name>-worker, <name>-runner, <name>-daemon, <name>-migrate, <name>-doctor. The deployment app additionally supports its registered canonical operator entrypoint hasna-deploy.";
        };
        readonly hosting: {
            readonly type: "array";
            readonly items: {
                readonly enum: readonly ["user-hosted", "hasna-saas"];
            };
            readonly minItems: 1;
            readonly uniqueItems: true;
            readonly description: "Customer-facing product stories. Public OSS cores include user-hosted; add hasna-saas only when a managed control plane exists.";
        };
        readonly serviceSurfaces: {
            readonly type: "array";
            readonly items: {
                readonly type: "object";
                readonly additionalProperties: false;
                readonly required: readonly ["name", "status", "authMode"];
                readonly allOf: readonly [{
                    readonly if: {
                        readonly required: readonly ["status"];
                        readonly properties: {
                            readonly status: {
                                readonly const: "supported";
                            };
                            readonly kind: {
                                readonly const: "api";
                            };
                        };
                    };
                    readonly then: {
                        readonly required: readonly ["bin", "health", "readiness", "version"];
                    };
                }];
                readonly properties: {
                    readonly name: {
                        readonly type: "string";
                        readonly minLength: 1;
                    };
                    readonly kind: {
                        readonly enum: readonly ["api", "sdk", "mcp", "cli"];
                    };
                    readonly status: {
                        readonly enum: readonly ["supported", "deferred", "unsupported"];
                    };
                    readonly bin: {
                        readonly type: "string";
                        readonly minLength: 1;
                    };
                    readonly mcpBin: {
                        readonly type: "string";
                        readonly minLength: 1;
                    };
                    readonly authMode: {
                        readonly enum: readonly ["none", "local-only", "api-key", "session", "service-token", "custom"];
                    };
                    readonly health: {
                        readonly type: "object";
                        readonly additionalProperties: false;
                        readonly required: readonly ["method", "path"];
                        readonly properties: {
                            readonly method: {
                                readonly const: "GET";
                            };
                            readonly path: {
                                readonly type: "string";
                                readonly pattern: "^/[A-Za-z0-9_./:*-]*$";
                            };
                            readonly public: {
                                readonly type: "boolean";
                            };
                            readonly description: {
                                readonly type: "string";
                                readonly minLength: 1;
                            };
                        };
                    };
                    readonly readiness: {
                        readonly type: "object";
                        readonly additionalProperties: false;
                        readonly required: readonly ["method", "path"];
                        readonly properties: {
                            readonly method: {
                                readonly const: "GET";
                            };
                            readonly path: {
                                readonly type: "string";
                                readonly pattern: "^/[A-Za-z0-9_./:*-]*$";
                            };
                            readonly public: {
                                readonly type: "boolean";
                            };
                            readonly description: {
                                readonly type: "string";
                                readonly minLength: 1;
                            };
                        };
                    };
                    readonly version: {
                        readonly type: "object";
                        readonly additionalProperties: false;
                        readonly required: readonly ["method", "path"];
                        readonly properties: {
                            readonly method: {
                                readonly const: "GET";
                            };
                            readonly path: {
                                readonly type: "string";
                                readonly pattern: "^/[A-Za-z0-9_./:*-]*$";
                            };
                            readonly public: {
                                readonly type: "boolean";
                            };
                            readonly description: {
                                readonly type: "string";
                                readonly minLength: 1;
                            };
                        };
                    };
                    readonly apiBasePath: {
                        readonly type: "string";
                        readonly pattern: "^/v[0-9]+$";
                    };
                    readonly openApiPath: {
                        readonly type: "string";
                        readonly pattern: "^/[A-Za-z0-9_./:-]*$";
                    };
                    readonly exportSubpath: {
                        readonly type: "string";
                        readonly pattern: "^\\.(?:\\/[A-Za-z0-9_.-]+(?:\\/[A-Za-z0-9_.-]+)*)?$";
                        readonly description: "SDK package export key such as . or ./sdk.";
                    };
                    readonly generatedFrom: {
                        readonly type: "string";
                        readonly pattern: "^/[A-Za-z0-9_./:-]*$";
                        readonly description: "OpenAPI path used to generate the SDK.";
                    };
                    readonly clientClassName: {
                        readonly type: "string";
                        readonly pattern: "^[A-Za-z_$][A-Za-z0-9_$]*$";
                    };
                    readonly deferReason: {
                        readonly type: "string";
                        readonly minLength: 1;
                    };
                    readonly readinessGates: {
                        readonly type: "array";
                        readonly items: {
                            readonly type: "object";
                            readonly additionalProperties: false;
                            readonly required: readonly ["id", "kind"];
                            readonly properties: {
                                readonly id: {
                                    readonly type: "string";
                                    readonly minLength: 1;
                                };
                                readonly kind: {
                                    readonly enum: readonly ["auth", "storage", "secret-ref", "migration", "health", "readiness", "redaction", "smoke", "operator", "other"];
                                };
                                readonly required: {
                                    readonly type: "boolean";
                                };
                                readonly command: {
                                    readonly type: "string";
                                    readonly minLength: 1;
                                };
                                readonly evidenceRef: {
                                    readonly type: "object";
                                };
                                readonly status: {
                                    readonly enum: readonly ["pending", "passed", "failed", "blocked", "deferred"];
                                };
                                readonly summary: {
                                    readonly type: "string";
                                    readonly minLength: 1;
                                };
                            };
                        };
                    };
                };
            };
            readonly description: "Declared API, SDK, MCP, and CLI product surfaces. Legacy entries without kind remain parseable; new manifests declare kind explicitly.";
        };
        readonly storage: {
            readonly type: "object";
            readonly additionalProperties: false;
            readonly required: readonly ["backend"];
            readonly properties: {
                readonly backend: {
                    readonly enum: readonly ["sqlite", "postgresql"];
                    readonly description: "Manifested runtime/migration capability. Server startup still requires PostgreSQL; SQLite is legacy import input only.";
                };
                readonly engines: {
                    readonly type: "array";
                    readonly items: {
                        readonly enum: readonly ["sqlite", "json", "postgresql"];
                    };
                    readonly minItems: 1;
                    readonly uniqueItems: true;
                    readonly description: "Supported storage engines; capability metadata independent of the active backend.";
                };
                readonly envPrefix: {
                    readonly type: "string";
                    readonly pattern: "^HASNA_[A-Z][A-Z0-9]*_$";
                    readonly description: "Primary env prefix, e.g. HASNA_TODOS_.";
                };
                readonly aliasEnvPrefix: {
                    readonly type: "string";
                    readonly pattern: "^[A-Z][A-Z0-9]*_$";
                    readonly description: "Optional short alias env prefix, e.g. TODOS_.";
                };
                readonly databaseUrlSecretRef: {
                    readonly type: "string";
                    readonly pattern: "^hasna/oss/[a-z0-9-]+/database-url$";
                    readonly description: "Legacy/private-tier database secret ref. Public conformance rejects this field.";
                };
                readonly sqlitePath: {
                    readonly type: "string";
                    readonly pattern: "\\.db$";
                    readonly description: "Explicit legacy SQLite import path; never a live client/server store.";
                };
                readonly pgTestGate: {
                    readonly type: "object";
                    readonly additionalProperties: false;
                    readonly required: readonly ["envVar", "command"];
                    readonly properties: {
                        readonly envVar: {
                            readonly type: "string";
                            readonly pattern: "^[A-Z][A-Z0-9_]*_TEST_DATABASE_URL$";
                        };
                        readonly command: {
                            readonly type: "string";
                            readonly minLength: 1;
                        };
                    };
                    readonly description: "Environment-gated live PostgreSQL test command.";
                };
            };
        };
        readonly publishing: {
            readonly type: "object";
            readonly additionalProperties: false;
            readonly required: readonly ["status"];
            readonly allOf: readonly [{
                readonly if: {
                    readonly required: readonly ["status"];
                    readonly properties: {
                        readonly status: {
                            readonly const: "published";
                        };
                    };
                };
                readonly then: {
                    readonly required: readonly ["targets"];
                    readonly properties: {
                        readonly targets: {
                            readonly minItems: 1;
                        };
                    };
                };
            }, {
                readonly if: {
                    readonly required: readonly ["status"];
                    readonly properties: {
                        readonly status: {
                            readonly const: "unpublished";
                        };
                    };
                };
                readonly then: {
                    readonly properties: {
                        readonly targets: {
                            readonly maxItems: 0;
                        };
                    };
                };
            }];
            readonly properties: {
                readonly status: {
                    readonly enum: readonly ["published", "unpublished"];
                    readonly description: "Whether the repo ships a published artifact. Declaring unpublished is a positive statement; omitting publishing entirely says only that the repo has not described how it ships.";
                };
                readonly targets: {
                    readonly type: "array";
                    readonly uniqueItems: true;
                    readonly items: {
                        readonly type: "object";
                        readonly additionalProperties: false;
                        readonly required: readonly ["package", "registry", "mechanism", "credential"];
                        readonly allOf: readonly [{
                            readonly if: {
                                readonly required: readonly ["mechanism"];
                                readonly properties: {
                                    readonly mechanism: {
                                        readonly const: "ci";
                                    };
                                };
                            };
                            readonly then: {
                                readonly required: readonly ["workflow"];
                            };
                        }, {
                            readonly if: {
                                readonly required: readonly ["mechanism"];
                                readonly properties: {
                                    readonly mechanism: {
                                        readonly const: "manual";
                                    };
                                };
                            };
                            readonly then: {
                                readonly not: {
                                    readonly required: readonly ["workflow"];
                                };
                            };
                        }, {
                            readonly if: {
                                readonly required: readonly ["credential"];
                                readonly properties: {
                                    readonly credential: {
                                        readonly const: "trusted-publisher";
                                    };
                                };
                            };
                            readonly then: {
                                readonly properties: {
                                    readonly mechanism: {
                                        readonly const: "ci";
                                    };
                                };
                            };
                        }];
                        readonly properties: {
                            readonly package: {
                                readonly type: "string";
                                readonly pattern: "^(?:@[a-z0-9][a-z0-9._-]*\\/)?[a-z0-9][a-z0-9._-]*$";
                                readonly description: "Registry package name including any scope, e.g. @hasna/todos.";
                            };
                            readonly registry: {
                                readonly type: "string";
                                readonly pattern: "^[a-z0-9][a-z0-9.-]*(?::[0-9]+)?(?:\\/[A-Za-z0-9._~-]+)*$";
                                readonly description: "Registry host, optionally with port and path, and never a scheme or embedded credentials (registry.npmjs.org, npm.pkg.github.com). No registry is assumed by default.";
                            };
                            readonly access: {
                                readonly enum: readonly ["public", "restricted"];
                                readonly description: "Registry visibility of the published artifact.";
                            };
                            readonly mechanism: {
                                readonly enum: readonly ["ci", "manual"];
                                readonly description: "Where the publish is initiated and authorised from. Not a taxonomy of publish commands: a repo publishing through a bespoke script is still ci when a workflow drives it.";
                            };
                            readonly credential: {
                                readonly enum: readonly ["trusted-publisher", "token"];
                                readonly description: "How the publish authenticates. trusted-publisher is workload identity exchanged at publish time; token is a long-lived registry credential.";
                            };
                            readonly flow: {
                                readonly enum: readonly ["direct", "staged"];
                                readonly description: "Whether the artifact becomes installable in one step, or is uploaded first and promoted in a separate step.";
                            };
                            readonly provenance: {
                                readonly enum: readonly ["required", "best-effort", "none"];
                                readonly description: "Intent for build provenance/attestation. required means the release gate refuses a publish without it.";
                            };
                            readonly workflow: {
                                readonly type: "object";
                                readonly additionalProperties: false;
                                readonly required: readonly ["provider", "repository", "file"];
                                readonly properties: {
                                    readonly provider: {
                                        readonly enum: readonly ["github-actions", "gitlab-ci"];
                                        readonly description: "CI provider the registry accepts as a trusted publisher.";
                                    };
                                    readonly repository: {
                                        readonly type: "string";
                                        readonly pattern: "^[A-Za-z0-9._-]+\\/[A-Za-z0-9._-]+$";
                                        readonly description: "owner/repo on the provider's forge.";
                                    };
                                    readonly file: {
                                        readonly type: "string";
                                        readonly pattern: "^[A-Za-z0-9._-]+\\.ya?ml$";
                                        readonly description: "Workflow file NAME, not a path; registries key the registration on the bare filename.";
                                    };
                                    readonly environment: {
                                        readonly type: "string";
                                        readonly minLength: 1;
                                        readonly description: "Deployment environment gating the publish job. Absent means no environment gate, not unknown.";
                                    };
                                };
                                readonly description: "The exact triple a registry's trusted-publisher registration consumes.";
                            };
                        };
                    };
                    readonly description: "One entry per published artifact per registry. A repo shipping several packages declares one target each.";
                };
            };
            readonly description: "How the repo's artifacts reach consumers. Optional and additive; absence asserts nothing.";
        };
        readonly metadata: {
            readonly type: "object";
            readonly additionalProperties: true;
            readonly properties: {
                readonly conformance: {
                    readonly type: "object";
                    readonly additionalProperties: true;
                    readonly properties: {
                        readonly waiverProfile: {
                            readonly const: "non-node-monorepo";
                            readonly description: "Explicit surface-waiver eligibility for exceptional non-Node monorepos. Libraries are eligible for API/MCP waivers without this profile.";
                        };
                        readonly waivedSurfaces: {
                            readonly type: "array";
                            readonly uniqueItems: true;
                            readonly items: {
                                readonly type: "object";
                                readonly additionalProperties: false;
                                readonly required: readonly ["kind", "reason"];
                                readonly properties: {
                                    readonly kind: {
                                        readonly enum: readonly ["api", "sdk", "mcp", "cli"];
                                    };
                                    readonly reason: {
                                        readonly type: "string";
                                        readonly minLength: 1;
                                    };
                                };
                            };
                        };
                        readonly waivedStorageEngines: {
                            readonly type: "array";
                            readonly uniqueItems: true;
                            readonly maxItems: 1;
                            readonly items: {
                                readonly type: "object";
                                readonly additionalProperties: false;
                                readonly required: readonly ["engine", "reason"];
                                readonly properties: {
                                    readonly engine: {
                                        readonly enum: readonly ["postgresql"];
                                    };
                                    readonly reason: {
                                        readonly type: "string";
                                        readonly minLength: 1;
                                        readonly maxLength: 500;
                                        readonly allOf: readonly [{
                                            readonly pattern: "\\S";
                                        }, {
                                            readonly pattern: "^[^\\u0000-\\u001f\\u007f]*$";
                                        }];
                                    };
                                    readonly reviewedBy: {
                                        readonly type: "string";
                                        readonly minLength: 1;
                                        readonly maxLength: 200;
                                        readonly allOf: readonly [{
                                            readonly pattern: "\\S";
                                        }, {
                                            readonly pattern: "^[^\\u0000-\\u001f\\u007f]*$";
                                        }];
                                    };
                                    readonly expiresAt: {
                                        readonly type: "string";
                                        readonly format: "date-time";
                                    };
                                };
                            };
                            readonly description: "Explicit storage-engine exceptions, at most one per engine. Only a CLI-only cli-with-store repo (no <name>-serve bin, no supported api service surface, storage.backend sqlite, no hasna-saas story) may waive postgresql; sqlite is never waivable, expiresAt is a UTC RFC 3339 timestamp, and conformance stops honouring a waiver once it has passed.";
                        };
                    };
                };
            };
        };
    };
};
/** Validate an object as a ServiceContractManifest, returning Zod issues. */
export declare function validateServiceContractManifest(value: unknown): z.SafeParseReturnType<unknown, ServiceContractManifest>;
export type LoadServiceContractResult = {
    ok: true;
    manifest: ServiceContractManifest;
    path: string;
} | {
    ok: false;
    path: string;
    error: string;
    issues?: z.ZodIssue[];
};
/** Read and validate `hasna.contract.json` from a repo root. */
export declare function loadServiceContractManifest(repoRoot: string): LoadServiceContractResult;
/** Full canonical env-key + ref spec derived from an app name. */
export interface ServiceContractSpec {
    name: string;
    env: ServerDataBackendEnvKeys;
    /** Legacy/private-tier helper; never persist this value in a public manifest. */
    databaseUrlSecretRef: string;
    sqlitePath: string;
    allowedBins: string[];
}
export declare function serviceContractSpec(name: string): ServiceContractSpec;
