import { z } from "zod";
import type { FleetManifest, MachineManifest, ManifestLoadInfo, ManifestSourceRef } from "./types.js";
export declare const PRIVATE_MANIFEST_REF_ENV = "HASNA_MACHINES_PRIVATE_MANIFEST_REF";
export declare const PRIVATE_MANIFEST_BACKEND_ENV = "HASNA_MACHINES_PRIVATE_MANIFEST_BACKEND";
export interface ManifestSourceAdapter {
    id: string;
    readManifest(input: {
        source: ManifestSourceRef;
        rawRef: string;
    }): FleetManifest | null | undefined;
}
export interface ReadManifestWithSourceOptions {
    path?: string;
    env?: NodeJS.ProcessEnv;
    privateRef?: string;
    privateBackend?: string;
    adapter?: ManifestSourceAdapter | null;
}
export declare const EXACT_BUN_REGISTRY_SECRET_REFS: readonly ["hasna/npm/live/publish-token", "hasnaxyz/npm/live/publish-token"];
export declare const EXACT_BUN_REGISTRY_EXCLUSIONS: readonly ["@hasnaxyz/infinity", "@hasnaxyz/factory", "@hasna/secrets", "@hasna/events"];
export declare const EXACT_BUN_REGISTRY_MINIMUM_RELEASE_AGE = 604800;
export declare const EXACT_BUN_REGISTRY_MAX_SOURCE_BYTES = 1048576;
export declare const LEGACY_BUN_REGISTRY_SOURCE_SHA256 = "4aad0a5c76e89c9532cb308d65ab0693465bf97519fb47d4ea6d4106c4e2ddf6";
export declare const machineSchema: z.ZodEffects<z.ZodObject<{
    id: z.ZodString;
    aliases: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    friendlyName: z.ZodOptional<z.ZodString>;
    updatedAt: z.ZodOptional<z.ZodString>;
    hostname: z.ZodOptional<z.ZodString>;
    sshAddress: z.ZodOptional<z.ZodString>;
    tailscaleName: z.ZodOptional<z.ZodString>;
    platform: z.ZodEnum<["linux", "macos", "windows"]>;
    connection: z.ZodOptional<z.ZodEnum<["local", "ssh", "tailscale"]>>;
    workspacePath: z.ZodString;
    bunPath: z.ZodOptional<z.ZodString>;
    tags: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    packages: z.ZodOptional<z.ZodArray<z.ZodEffects<z.ZodObject<{
        name: z.ZodString;
        manager: z.ZodOptional<z.ZodEnum<["bun", "brew", "apt", "custom"]>>;
        version: z.ZodOptional<z.ZodString>;
        appId: z.ZodOptional<z.ZodString>;
        bin: z.ZodOptional<z.ZodString>;
        verify: z.ZodOptional<z.ZodBoolean>;
        mcpHealthUrl: z.ZodOptional<z.ZodString>;
        exactBunRegistry: z.ZodOptional<z.ZodEffects<z.ZodObject<{
            schema: z.ZodLiteral<"machines.exact_bun_registry.v1">;
            order: z.ZodNumber;
            mode: z.ZodLiteral<"live-global">;
            source: z.ZodObject<{
                provider: z.ZodEnum<["files", "task-attachment"]>;
                ref: z.ZodString;
                sha256: z.ZodString;
                sizeBytes: z.ZodNumber;
            }, "strict", z.ZodTypeAny, {
                provider: "files" | "task-attachment";
                ref: string;
                sha256: string;
                sizeBytes: number;
            }, {
                provider: "files" | "task-attachment";
                ref: string;
                sha256: string;
                sizeBytes: number;
            }>;
            archiveSha256: z.ZodString;
            registryIntegrity: z.ZodString;
            secretRefs: z.ZodTuple<[z.ZodLiteral<"hasna/npm/live/publish-token">, z.ZodLiteral<"hasnaxyz/npm/live/publish-token">], null>;
            quarantine: z.ZodObject<{
                minimumReleaseAge: z.ZodLiteral<604800>;
                exactExclusions: z.ZodTuple<[z.ZodLiteral<"@hasnaxyz/infinity">, z.ZodLiteral<"@hasnaxyz/factory">, z.ZodLiteral<"@hasna/secrets">, z.ZodLiteral<"@hasna/events">], null>;
            }, "strict", z.ZodTypeAny, {
                minimumReleaseAge: 604800;
                exactExclusions: ["@hasnaxyz/infinity", "@hasnaxyz/factory", "@hasna/secrets", "@hasna/events"];
            }, {
                minimumReleaseAge: 604800;
                exactExclusions: ["@hasnaxyz/infinity", "@hasnaxyz/factory", "@hasna/secrets", "@hasna/events"];
            }>;
            probe: z.ZodObject<{
                sdkImport: z.ZodString;
                cli: z.ZodObject<{
                    bin: z.ZodString;
                    args: z.ZodTuple<[z.ZodLiteral<"--help">], null>;
                }, "strict", z.ZodTypeAny, {
                    bin: string;
                    args: ["--help"];
                }, {
                    bin: string;
                    args: ["--help"];
                }>;
            }, "strict", z.ZodTypeAny, {
                sdkImport: string;
                cli: {
                    bin: string;
                    args: ["--help"];
                };
            }, {
                sdkImport: string;
                cli: {
                    bin: string;
                    args: ["--help"];
                };
            }>;
            rollback: z.ZodLiteral<"byte-preimage">;
        }, "strict", z.ZodTypeAny, {
            quarantine: {
                minimumReleaseAge: 604800;
                exactExclusions: ["@hasnaxyz/infinity", "@hasnaxyz/factory", "@hasna/secrets", "@hasna/events"];
            };
            schema: "machines.exact_bun_registry.v1";
            order: number;
            mode: "live-global";
            source: {
                provider: "files" | "task-attachment";
                ref: string;
                sha256: string;
                sizeBytes: number;
            };
            archiveSha256: string;
            registryIntegrity: string;
            secretRefs: ["hasna/npm/live/publish-token", "hasnaxyz/npm/live/publish-token"];
            probe: {
                sdkImport: string;
                cli: {
                    bin: string;
                    args: ["--help"];
                };
            };
            rollback: "byte-preimage";
        }, {
            quarantine: {
                minimumReleaseAge: 604800;
                exactExclusions: ["@hasnaxyz/infinity", "@hasnaxyz/factory", "@hasna/secrets", "@hasna/events"];
            };
            schema: "machines.exact_bun_registry.v1";
            order: number;
            mode: "live-global";
            source: {
                provider: "files" | "task-attachment";
                ref: string;
                sha256: string;
                sizeBytes: number;
            };
            archiveSha256: string;
            registryIntegrity: string;
            secretRefs: ["hasna/npm/live/publish-token", "hasnaxyz/npm/live/publish-token"];
            probe: {
                sdkImport: string;
                cli: {
                    bin: string;
                    args: ["--help"];
                };
            };
            rollback: "byte-preimage";
        }>, {
            quarantine: {
                minimumReleaseAge: 604800;
                exactExclusions: ["@hasnaxyz/infinity", "@hasnaxyz/factory", "@hasna/secrets", "@hasna/events"];
            };
            schema: "machines.exact_bun_registry.v1";
            order: number;
            mode: "live-global";
            source: {
                provider: "files" | "task-attachment";
                ref: string;
                sha256: string;
                sizeBytes: number;
            };
            archiveSha256: string;
            registryIntegrity: string;
            secretRefs: ["hasna/npm/live/publish-token", "hasnaxyz/npm/live/publish-token"];
            probe: {
                sdkImport: string;
                cli: {
                    bin: string;
                    args: ["--help"];
                };
            };
            rollback: "byte-preimage";
        }, {
            quarantine: {
                minimumReleaseAge: 604800;
                exactExclusions: ["@hasnaxyz/infinity", "@hasnaxyz/factory", "@hasna/secrets", "@hasna/events"];
            };
            schema: "machines.exact_bun_registry.v1";
            order: number;
            mode: "live-global";
            source: {
                provider: "files" | "task-attachment";
                ref: string;
                sha256: string;
                sizeBytes: number;
            };
            archiveSha256: string;
            registryIntegrity: string;
            secretRefs: ["hasna/npm/live/publish-token", "hasnaxyz/npm/live/publish-token"];
            probe: {
                sdkImport: string;
                cli: {
                    bin: string;
                    args: ["--help"];
                };
            };
            rollback: "byte-preimage";
        }>>;
    }, "strict", z.ZodTypeAny, {
        name: string;
        bin?: string | undefined;
        manager?: "bun" | "brew" | "apt" | "custom" | undefined;
        version?: string | undefined;
        appId?: string | undefined;
        verify?: boolean | undefined;
        mcpHealthUrl?: string | undefined;
        exactBunRegistry?: {
            quarantine: {
                minimumReleaseAge: 604800;
                exactExclusions: ["@hasnaxyz/infinity", "@hasnaxyz/factory", "@hasna/secrets", "@hasna/events"];
            };
            schema: "machines.exact_bun_registry.v1";
            order: number;
            mode: "live-global";
            source: {
                provider: "files" | "task-attachment";
                ref: string;
                sha256: string;
                sizeBytes: number;
            };
            archiveSha256: string;
            registryIntegrity: string;
            secretRefs: ["hasna/npm/live/publish-token", "hasnaxyz/npm/live/publish-token"];
            probe: {
                sdkImport: string;
                cli: {
                    bin: string;
                    args: ["--help"];
                };
            };
            rollback: "byte-preimage";
        } | undefined;
    }, {
        name: string;
        bin?: string | undefined;
        manager?: "bun" | "brew" | "apt" | "custom" | undefined;
        version?: string | undefined;
        appId?: string | undefined;
        verify?: boolean | undefined;
        mcpHealthUrl?: string | undefined;
        exactBunRegistry?: {
            quarantine: {
                minimumReleaseAge: 604800;
                exactExclusions: ["@hasnaxyz/infinity", "@hasnaxyz/factory", "@hasna/secrets", "@hasna/events"];
            };
            schema: "machines.exact_bun_registry.v1";
            order: number;
            mode: "live-global";
            source: {
                provider: "files" | "task-attachment";
                ref: string;
                sha256: string;
                sizeBytes: number;
            };
            archiveSha256: string;
            registryIntegrity: string;
            secretRefs: ["hasna/npm/live/publish-token", "hasnaxyz/npm/live/publish-token"];
            probe: {
                sdkImport: string;
                cli: {
                    bin: string;
                    args: ["--help"];
                };
            };
            rollback: "byte-preimage";
        } | undefined;
    }>, {
        name: string;
        bin?: string | undefined;
        manager?: "bun" | "brew" | "apt" | "custom" | undefined;
        version?: string | undefined;
        appId?: string | undefined;
        verify?: boolean | undefined;
        mcpHealthUrl?: string | undefined;
        exactBunRegistry?: {
            quarantine: {
                minimumReleaseAge: 604800;
                exactExclusions: ["@hasnaxyz/infinity", "@hasnaxyz/factory", "@hasna/secrets", "@hasna/events"];
            };
            schema: "machines.exact_bun_registry.v1";
            order: number;
            mode: "live-global";
            source: {
                provider: "files" | "task-attachment";
                ref: string;
                sha256: string;
                sizeBytes: number;
            };
            archiveSha256: string;
            registryIntegrity: string;
            secretRefs: ["hasna/npm/live/publish-token", "hasnaxyz/npm/live/publish-token"];
            probe: {
                sdkImport: string;
                cli: {
                    bin: string;
                    args: ["--help"];
                };
            };
            rollback: "byte-preimage";
        } | undefined;
    }, {
        name: string;
        bin?: string | undefined;
        manager?: "bun" | "brew" | "apt" | "custom" | undefined;
        version?: string | undefined;
        appId?: string | undefined;
        verify?: boolean | undefined;
        mcpHealthUrl?: string | undefined;
        exactBunRegistry?: {
            quarantine: {
                minimumReleaseAge: 604800;
                exactExclusions: ["@hasnaxyz/infinity", "@hasnaxyz/factory", "@hasna/secrets", "@hasna/events"];
            };
            schema: "machines.exact_bun_registry.v1";
            order: number;
            mode: "live-global";
            source: {
                provider: "files" | "task-attachment";
                ref: string;
                sha256: string;
                sizeBytes: number;
            };
            archiveSha256: string;
            registryIntegrity: string;
            secretRefs: ["hasna/npm/live/publish-token", "hasnaxyz/npm/live/publish-token"];
            probe: {
                sdkImport: string;
                cli: {
                    bin: string;
                    args: ["--help"];
                };
            };
            rollback: "byte-preimage";
        } | undefined;
    }>, "many">>;
    apps: z.ZodOptional<z.ZodArray<z.ZodEffects<z.ZodObject<{
        name: z.ZodString;
        manager: z.ZodOptional<z.ZodEnum<["brew", "cask", "apt", "winget", "custom"]>>;
        packageName: z.ZodOptional<z.ZodString>;
        installCommand: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
        probeCommand: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
        expectedVersion: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        manager?: "brew" | "apt" | "custom" | "cask" | "winget" | undefined;
        packageName?: string | undefined;
        installCommand?: string | undefined;
        probeCommand?: string | undefined;
        expectedVersion?: string | undefined;
    }, {
        name: string;
        manager?: "brew" | "apt" | "custom" | "cask" | "winget" | undefined;
        packageName?: string | undefined;
        installCommand?: string | undefined;
        probeCommand?: string | undefined;
        expectedVersion?: string | undefined;
    }>, {
        name: string;
        manager?: "brew" | "apt" | "custom" | "cask" | "winget" | undefined;
        packageName?: string | undefined;
        installCommand?: string | undefined;
        probeCommand?: string | undefined;
        expectedVersion?: string | undefined;
    }, {
        name: string;
        manager?: "brew" | "apt" | "custom" | "cask" | "winget" | undefined;
        packageName?: string | undefined;
        installCommand?: string | undefined;
        probeCommand?: string | undefined;
        expectedVersion?: string | undefined;
    }>, "many">>;
    files: z.ZodOptional<z.ZodArray<z.ZodObject<{
        source: z.ZodString;
        target: z.ZodString;
        mode: z.ZodOptional<z.ZodEnum<["copy", "symlink"]>>;
    }, "strip", z.ZodTypeAny, {
        source: string;
        target: string;
        mode?: "copy" | "symlink" | undefined;
    }, {
        source: string;
        target: string;
        mode?: "copy" | "symlink" | undefined;
    }>, "many">>;
}, "strict", z.ZodTypeAny, {
    id: string;
    platform: "linux" | "macos" | "windows";
    workspacePath: string;
    files?: {
        source: string;
        target: string;
        mode?: "copy" | "symlink" | undefined;
    }[] | undefined;
    hostname?: string | undefined;
    sshAddress?: string | undefined;
    tailscaleName?: string | undefined;
    connection?: "local" | "ssh" | "tailscale" | undefined;
    bunPath?: string | undefined;
    tags?: string[] | undefined;
    metadata?: Record<string, unknown> | undefined;
    packages?: {
        name: string;
        bin?: string | undefined;
        manager?: "bun" | "brew" | "apt" | "custom" | undefined;
        version?: string | undefined;
        appId?: string | undefined;
        verify?: boolean | undefined;
        mcpHealthUrl?: string | undefined;
        exactBunRegistry?: {
            quarantine: {
                minimumReleaseAge: 604800;
                exactExclusions: ["@hasnaxyz/infinity", "@hasnaxyz/factory", "@hasna/secrets", "@hasna/events"];
            };
            schema: "machines.exact_bun_registry.v1";
            order: number;
            mode: "live-global";
            source: {
                provider: "files" | "task-attachment";
                ref: string;
                sha256: string;
                sizeBytes: number;
            };
            archiveSha256: string;
            registryIntegrity: string;
            secretRefs: ["hasna/npm/live/publish-token", "hasnaxyz/npm/live/publish-token"];
            probe: {
                sdkImport: string;
                cli: {
                    bin: string;
                    args: ["--help"];
                };
            };
            rollback: "byte-preimage";
        } | undefined;
    }[] | undefined;
    apps?: {
        name: string;
        manager?: "brew" | "apt" | "custom" | "cask" | "winget" | undefined;
        packageName?: string | undefined;
        installCommand?: string | undefined;
        probeCommand?: string | undefined;
        expectedVersion?: string | undefined;
    }[] | undefined;
    aliases?: string[] | undefined;
    friendlyName?: string | undefined;
    updatedAt?: string | undefined;
}, {
    id: string;
    platform: "linux" | "macos" | "windows";
    workspacePath: string;
    files?: {
        source: string;
        target: string;
        mode?: "copy" | "symlink" | undefined;
    }[] | undefined;
    hostname?: string | undefined;
    sshAddress?: string | undefined;
    tailscaleName?: string | undefined;
    connection?: "local" | "ssh" | "tailscale" | undefined;
    bunPath?: string | undefined;
    tags?: string[] | undefined;
    metadata?: Record<string, unknown> | undefined;
    packages?: {
        name: string;
        bin?: string | undefined;
        manager?: "bun" | "brew" | "apt" | "custom" | undefined;
        version?: string | undefined;
        appId?: string | undefined;
        verify?: boolean | undefined;
        mcpHealthUrl?: string | undefined;
        exactBunRegistry?: {
            quarantine: {
                minimumReleaseAge: 604800;
                exactExclusions: ["@hasnaxyz/infinity", "@hasnaxyz/factory", "@hasna/secrets", "@hasna/events"];
            };
            schema: "machines.exact_bun_registry.v1";
            order: number;
            mode: "live-global";
            source: {
                provider: "files" | "task-attachment";
                ref: string;
                sha256: string;
                sizeBytes: number;
            };
            archiveSha256: string;
            registryIntegrity: string;
            secretRefs: ["hasna/npm/live/publish-token", "hasnaxyz/npm/live/publish-token"];
            probe: {
                sdkImport: string;
                cli: {
                    bin: string;
                    args: ["--help"];
                };
            };
            rollback: "byte-preimage";
        } | undefined;
    }[] | undefined;
    apps?: {
        name: string;
        manager?: "brew" | "apt" | "custom" | "cask" | "winget" | undefined;
        packageName?: string | undefined;
        installCommand?: string | undefined;
        probeCommand?: string | undefined;
        expectedVersion?: string | undefined;
    }[] | undefined;
    aliases?: string[] | undefined;
    friendlyName?: string | undefined;
    updatedAt?: string | undefined;
}>, {
    id: string;
    platform: "linux" | "macos" | "windows";
    workspacePath: string;
    files?: {
        source: string;
        target: string;
        mode?: "copy" | "symlink" | undefined;
    }[] | undefined;
    hostname?: string | undefined;
    sshAddress?: string | undefined;
    tailscaleName?: string | undefined;
    connection?: "local" | "ssh" | "tailscale" | undefined;
    bunPath?: string | undefined;
    tags?: string[] | undefined;
    metadata?: Record<string, unknown> | undefined;
    packages?: {
        name: string;
        bin?: string | undefined;
        manager?: "bun" | "brew" | "apt" | "custom" | undefined;
        version?: string | undefined;
        appId?: string | undefined;
        verify?: boolean | undefined;
        mcpHealthUrl?: string | undefined;
        exactBunRegistry?: {
            quarantine: {
                minimumReleaseAge: 604800;
                exactExclusions: ["@hasnaxyz/infinity", "@hasnaxyz/factory", "@hasna/secrets", "@hasna/events"];
            };
            schema: "machines.exact_bun_registry.v1";
            order: number;
            mode: "live-global";
            source: {
                provider: "files" | "task-attachment";
                ref: string;
                sha256: string;
                sizeBytes: number;
            };
            archiveSha256: string;
            registryIntegrity: string;
            secretRefs: ["hasna/npm/live/publish-token", "hasnaxyz/npm/live/publish-token"];
            probe: {
                sdkImport: string;
                cli: {
                    bin: string;
                    args: ["--help"];
                };
            };
            rollback: "byte-preimage";
        } | undefined;
    }[] | undefined;
    apps?: {
        name: string;
        manager?: "brew" | "apt" | "custom" | "cask" | "winget" | undefined;
        packageName?: string | undefined;
        installCommand?: string | undefined;
        probeCommand?: string | undefined;
        expectedVersion?: string | undefined;
    }[] | undefined;
    aliases?: string[] | undefined;
    friendlyName?: string | undefined;
    updatedAt?: string | undefined;
}, {
    id: string;
    platform: "linux" | "macos" | "windows";
    workspacePath: string;
    files?: {
        source: string;
        target: string;
        mode?: "copy" | "symlink" | undefined;
    }[] | undefined;
    hostname?: string | undefined;
    sshAddress?: string | undefined;
    tailscaleName?: string | undefined;
    connection?: "local" | "ssh" | "tailscale" | undefined;
    bunPath?: string | undefined;
    tags?: string[] | undefined;
    metadata?: Record<string, unknown> | undefined;
    packages?: {
        name: string;
        bin?: string | undefined;
        manager?: "bun" | "brew" | "apt" | "custom" | undefined;
        version?: string | undefined;
        appId?: string | undefined;
        verify?: boolean | undefined;
        mcpHealthUrl?: string | undefined;
        exactBunRegistry?: {
            quarantine: {
                minimumReleaseAge: 604800;
                exactExclusions: ["@hasnaxyz/infinity", "@hasnaxyz/factory", "@hasna/secrets", "@hasna/events"];
            };
            schema: "machines.exact_bun_registry.v1";
            order: number;
            mode: "live-global";
            source: {
                provider: "files" | "task-attachment";
                ref: string;
                sha256: string;
                sizeBytes: number;
            };
            archiveSha256: string;
            registryIntegrity: string;
            secretRefs: ["hasna/npm/live/publish-token", "hasnaxyz/npm/live/publish-token"];
            probe: {
                sdkImport: string;
                cli: {
                    bin: string;
                    args: ["--help"];
                };
            };
            rollback: "byte-preimage";
        } | undefined;
    }[] | undefined;
    apps?: {
        name: string;
        manager?: "brew" | "apt" | "custom" | "cask" | "winget" | undefined;
        packageName?: string | undefined;
        installCommand?: string | undefined;
        probeCommand?: string | undefined;
        expectedVersion?: string | undefined;
    }[] | undefined;
    aliases?: string[] | undefined;
    friendlyName?: string | undefined;
    updatedAt?: string | undefined;
}>;
export declare const fleetSchema: z.ZodEffects<z.ZodObject<{
    version: z.ZodLiteral<1>;
    generatedAt: z.ZodOptional<z.ZodString>;
    packages: z.ZodOptional<z.ZodArray<z.ZodEffects<z.ZodObject<{
        name: z.ZodString;
        manager: z.ZodOptional<z.ZodEnum<["bun", "brew", "apt", "custom"]>>;
        version: z.ZodOptional<z.ZodString>;
        appId: z.ZodOptional<z.ZodString>;
        bin: z.ZodOptional<z.ZodString>;
        verify: z.ZodOptional<z.ZodBoolean>;
        mcpHealthUrl: z.ZodOptional<z.ZodString>;
        exactBunRegistry: z.ZodOptional<z.ZodEffects<z.ZodObject<{
            schema: z.ZodLiteral<"machines.exact_bun_registry.v1">;
            order: z.ZodNumber;
            mode: z.ZodLiteral<"live-global">;
            source: z.ZodObject<{
                provider: z.ZodEnum<["files", "task-attachment"]>;
                ref: z.ZodString;
                sha256: z.ZodString;
                sizeBytes: z.ZodNumber;
            }, "strict", z.ZodTypeAny, {
                provider: "files" | "task-attachment";
                ref: string;
                sha256: string;
                sizeBytes: number;
            }, {
                provider: "files" | "task-attachment";
                ref: string;
                sha256: string;
                sizeBytes: number;
            }>;
            archiveSha256: z.ZodString;
            registryIntegrity: z.ZodString;
            secretRefs: z.ZodTuple<[z.ZodLiteral<"hasna/npm/live/publish-token">, z.ZodLiteral<"hasnaxyz/npm/live/publish-token">], null>;
            quarantine: z.ZodObject<{
                minimumReleaseAge: z.ZodLiteral<604800>;
                exactExclusions: z.ZodTuple<[z.ZodLiteral<"@hasnaxyz/infinity">, z.ZodLiteral<"@hasnaxyz/factory">, z.ZodLiteral<"@hasna/secrets">, z.ZodLiteral<"@hasna/events">], null>;
            }, "strict", z.ZodTypeAny, {
                minimumReleaseAge: 604800;
                exactExclusions: ["@hasnaxyz/infinity", "@hasnaxyz/factory", "@hasna/secrets", "@hasna/events"];
            }, {
                minimumReleaseAge: 604800;
                exactExclusions: ["@hasnaxyz/infinity", "@hasnaxyz/factory", "@hasna/secrets", "@hasna/events"];
            }>;
            probe: z.ZodObject<{
                sdkImport: z.ZodString;
                cli: z.ZodObject<{
                    bin: z.ZodString;
                    args: z.ZodTuple<[z.ZodLiteral<"--help">], null>;
                }, "strict", z.ZodTypeAny, {
                    bin: string;
                    args: ["--help"];
                }, {
                    bin: string;
                    args: ["--help"];
                }>;
            }, "strict", z.ZodTypeAny, {
                sdkImport: string;
                cli: {
                    bin: string;
                    args: ["--help"];
                };
            }, {
                sdkImport: string;
                cli: {
                    bin: string;
                    args: ["--help"];
                };
            }>;
            rollback: z.ZodLiteral<"byte-preimage">;
        }, "strict", z.ZodTypeAny, {
            quarantine: {
                minimumReleaseAge: 604800;
                exactExclusions: ["@hasnaxyz/infinity", "@hasnaxyz/factory", "@hasna/secrets", "@hasna/events"];
            };
            schema: "machines.exact_bun_registry.v1";
            order: number;
            mode: "live-global";
            source: {
                provider: "files" | "task-attachment";
                ref: string;
                sha256: string;
                sizeBytes: number;
            };
            archiveSha256: string;
            registryIntegrity: string;
            secretRefs: ["hasna/npm/live/publish-token", "hasnaxyz/npm/live/publish-token"];
            probe: {
                sdkImport: string;
                cli: {
                    bin: string;
                    args: ["--help"];
                };
            };
            rollback: "byte-preimage";
        }, {
            quarantine: {
                minimumReleaseAge: 604800;
                exactExclusions: ["@hasnaxyz/infinity", "@hasnaxyz/factory", "@hasna/secrets", "@hasna/events"];
            };
            schema: "machines.exact_bun_registry.v1";
            order: number;
            mode: "live-global";
            source: {
                provider: "files" | "task-attachment";
                ref: string;
                sha256: string;
                sizeBytes: number;
            };
            archiveSha256: string;
            registryIntegrity: string;
            secretRefs: ["hasna/npm/live/publish-token", "hasnaxyz/npm/live/publish-token"];
            probe: {
                sdkImport: string;
                cli: {
                    bin: string;
                    args: ["--help"];
                };
            };
            rollback: "byte-preimage";
        }>, {
            quarantine: {
                minimumReleaseAge: 604800;
                exactExclusions: ["@hasnaxyz/infinity", "@hasnaxyz/factory", "@hasna/secrets", "@hasna/events"];
            };
            schema: "machines.exact_bun_registry.v1";
            order: number;
            mode: "live-global";
            source: {
                provider: "files" | "task-attachment";
                ref: string;
                sha256: string;
                sizeBytes: number;
            };
            archiveSha256: string;
            registryIntegrity: string;
            secretRefs: ["hasna/npm/live/publish-token", "hasnaxyz/npm/live/publish-token"];
            probe: {
                sdkImport: string;
                cli: {
                    bin: string;
                    args: ["--help"];
                };
            };
            rollback: "byte-preimage";
        }, {
            quarantine: {
                minimumReleaseAge: 604800;
                exactExclusions: ["@hasnaxyz/infinity", "@hasnaxyz/factory", "@hasna/secrets", "@hasna/events"];
            };
            schema: "machines.exact_bun_registry.v1";
            order: number;
            mode: "live-global";
            source: {
                provider: "files" | "task-attachment";
                ref: string;
                sha256: string;
                sizeBytes: number;
            };
            archiveSha256: string;
            registryIntegrity: string;
            secretRefs: ["hasna/npm/live/publish-token", "hasnaxyz/npm/live/publish-token"];
            probe: {
                sdkImport: string;
                cli: {
                    bin: string;
                    args: ["--help"];
                };
            };
            rollback: "byte-preimage";
        }>>;
    }, "strict", z.ZodTypeAny, {
        name: string;
        bin?: string | undefined;
        manager?: "bun" | "brew" | "apt" | "custom" | undefined;
        version?: string | undefined;
        appId?: string | undefined;
        verify?: boolean | undefined;
        mcpHealthUrl?: string | undefined;
        exactBunRegistry?: {
            quarantine: {
                minimumReleaseAge: 604800;
                exactExclusions: ["@hasnaxyz/infinity", "@hasnaxyz/factory", "@hasna/secrets", "@hasna/events"];
            };
            schema: "machines.exact_bun_registry.v1";
            order: number;
            mode: "live-global";
            source: {
                provider: "files" | "task-attachment";
                ref: string;
                sha256: string;
                sizeBytes: number;
            };
            archiveSha256: string;
            registryIntegrity: string;
            secretRefs: ["hasna/npm/live/publish-token", "hasnaxyz/npm/live/publish-token"];
            probe: {
                sdkImport: string;
                cli: {
                    bin: string;
                    args: ["--help"];
                };
            };
            rollback: "byte-preimage";
        } | undefined;
    }, {
        name: string;
        bin?: string | undefined;
        manager?: "bun" | "brew" | "apt" | "custom" | undefined;
        version?: string | undefined;
        appId?: string | undefined;
        verify?: boolean | undefined;
        mcpHealthUrl?: string | undefined;
        exactBunRegistry?: {
            quarantine: {
                minimumReleaseAge: 604800;
                exactExclusions: ["@hasnaxyz/infinity", "@hasnaxyz/factory", "@hasna/secrets", "@hasna/events"];
            };
            schema: "machines.exact_bun_registry.v1";
            order: number;
            mode: "live-global";
            source: {
                provider: "files" | "task-attachment";
                ref: string;
                sha256: string;
                sizeBytes: number;
            };
            archiveSha256: string;
            registryIntegrity: string;
            secretRefs: ["hasna/npm/live/publish-token", "hasnaxyz/npm/live/publish-token"];
            probe: {
                sdkImport: string;
                cli: {
                    bin: string;
                    args: ["--help"];
                };
            };
            rollback: "byte-preimage";
        } | undefined;
    }>, {
        name: string;
        bin?: string | undefined;
        manager?: "bun" | "brew" | "apt" | "custom" | undefined;
        version?: string | undefined;
        appId?: string | undefined;
        verify?: boolean | undefined;
        mcpHealthUrl?: string | undefined;
        exactBunRegistry?: {
            quarantine: {
                minimumReleaseAge: 604800;
                exactExclusions: ["@hasnaxyz/infinity", "@hasnaxyz/factory", "@hasna/secrets", "@hasna/events"];
            };
            schema: "machines.exact_bun_registry.v1";
            order: number;
            mode: "live-global";
            source: {
                provider: "files" | "task-attachment";
                ref: string;
                sha256: string;
                sizeBytes: number;
            };
            archiveSha256: string;
            registryIntegrity: string;
            secretRefs: ["hasna/npm/live/publish-token", "hasnaxyz/npm/live/publish-token"];
            probe: {
                sdkImport: string;
                cli: {
                    bin: string;
                    args: ["--help"];
                };
            };
            rollback: "byte-preimage";
        } | undefined;
    }, {
        name: string;
        bin?: string | undefined;
        manager?: "bun" | "brew" | "apt" | "custom" | undefined;
        version?: string | undefined;
        appId?: string | undefined;
        verify?: boolean | undefined;
        mcpHealthUrl?: string | undefined;
        exactBunRegistry?: {
            quarantine: {
                minimumReleaseAge: 604800;
                exactExclusions: ["@hasnaxyz/infinity", "@hasnaxyz/factory", "@hasna/secrets", "@hasna/events"];
            };
            schema: "machines.exact_bun_registry.v1";
            order: number;
            mode: "live-global";
            source: {
                provider: "files" | "task-attachment";
                ref: string;
                sha256: string;
                sizeBytes: number;
            };
            archiveSha256: string;
            registryIntegrity: string;
            secretRefs: ["hasna/npm/live/publish-token", "hasnaxyz/npm/live/publish-token"];
            probe: {
                sdkImport: string;
                cli: {
                    bin: string;
                    args: ["--help"];
                };
            };
            rollback: "byte-preimage";
        } | undefined;
    }>, "many">>;
    freeze: z.ZodOptional<z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        reason: z.ZodOptional<z.ZodString>;
        frozenAt: z.ZodOptional<z.ZodString>;
        until: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        reason?: string | undefined;
        frozenAt?: string | undefined;
        until?: string | undefined;
    }, {
        name: string;
        reason?: string | undefined;
        frozenAt?: string | undefined;
        until?: string | undefined;
    }>, "many">>;
    machines: z.ZodArray<z.ZodEffects<z.ZodObject<{
        id: z.ZodString;
        aliases: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        friendlyName: z.ZodOptional<z.ZodString>;
        updatedAt: z.ZodOptional<z.ZodString>;
        hostname: z.ZodOptional<z.ZodString>;
        sshAddress: z.ZodOptional<z.ZodString>;
        tailscaleName: z.ZodOptional<z.ZodString>;
        platform: z.ZodEnum<["linux", "macos", "windows"]>;
        connection: z.ZodOptional<z.ZodEnum<["local", "ssh", "tailscale"]>>;
        workspacePath: z.ZodString;
        bunPath: z.ZodOptional<z.ZodString>;
        tags: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        packages: z.ZodOptional<z.ZodArray<z.ZodEffects<z.ZodObject<{
            name: z.ZodString;
            manager: z.ZodOptional<z.ZodEnum<["bun", "brew", "apt", "custom"]>>;
            version: z.ZodOptional<z.ZodString>;
            appId: z.ZodOptional<z.ZodString>;
            bin: z.ZodOptional<z.ZodString>;
            verify: z.ZodOptional<z.ZodBoolean>;
            mcpHealthUrl: z.ZodOptional<z.ZodString>;
            exactBunRegistry: z.ZodOptional<z.ZodEffects<z.ZodObject<{
                schema: z.ZodLiteral<"machines.exact_bun_registry.v1">;
                order: z.ZodNumber;
                mode: z.ZodLiteral<"live-global">;
                source: z.ZodObject<{
                    provider: z.ZodEnum<["files", "task-attachment"]>;
                    ref: z.ZodString;
                    sha256: z.ZodString;
                    sizeBytes: z.ZodNumber;
                }, "strict", z.ZodTypeAny, {
                    provider: "files" | "task-attachment";
                    ref: string;
                    sha256: string;
                    sizeBytes: number;
                }, {
                    provider: "files" | "task-attachment";
                    ref: string;
                    sha256: string;
                    sizeBytes: number;
                }>;
                archiveSha256: z.ZodString;
                registryIntegrity: z.ZodString;
                secretRefs: z.ZodTuple<[z.ZodLiteral<"hasna/npm/live/publish-token">, z.ZodLiteral<"hasnaxyz/npm/live/publish-token">], null>;
                quarantine: z.ZodObject<{
                    minimumReleaseAge: z.ZodLiteral<604800>;
                    exactExclusions: z.ZodTuple<[z.ZodLiteral<"@hasnaxyz/infinity">, z.ZodLiteral<"@hasnaxyz/factory">, z.ZodLiteral<"@hasna/secrets">, z.ZodLiteral<"@hasna/events">], null>;
                }, "strict", z.ZodTypeAny, {
                    minimumReleaseAge: 604800;
                    exactExclusions: ["@hasnaxyz/infinity", "@hasnaxyz/factory", "@hasna/secrets", "@hasna/events"];
                }, {
                    minimumReleaseAge: 604800;
                    exactExclusions: ["@hasnaxyz/infinity", "@hasnaxyz/factory", "@hasna/secrets", "@hasna/events"];
                }>;
                probe: z.ZodObject<{
                    sdkImport: z.ZodString;
                    cli: z.ZodObject<{
                        bin: z.ZodString;
                        args: z.ZodTuple<[z.ZodLiteral<"--help">], null>;
                    }, "strict", z.ZodTypeAny, {
                        bin: string;
                        args: ["--help"];
                    }, {
                        bin: string;
                        args: ["--help"];
                    }>;
                }, "strict", z.ZodTypeAny, {
                    sdkImport: string;
                    cli: {
                        bin: string;
                        args: ["--help"];
                    };
                }, {
                    sdkImport: string;
                    cli: {
                        bin: string;
                        args: ["--help"];
                    };
                }>;
                rollback: z.ZodLiteral<"byte-preimage">;
            }, "strict", z.ZodTypeAny, {
                quarantine: {
                    minimumReleaseAge: 604800;
                    exactExclusions: ["@hasnaxyz/infinity", "@hasnaxyz/factory", "@hasna/secrets", "@hasna/events"];
                };
                schema: "machines.exact_bun_registry.v1";
                order: number;
                mode: "live-global";
                source: {
                    provider: "files" | "task-attachment";
                    ref: string;
                    sha256: string;
                    sizeBytes: number;
                };
                archiveSha256: string;
                registryIntegrity: string;
                secretRefs: ["hasna/npm/live/publish-token", "hasnaxyz/npm/live/publish-token"];
                probe: {
                    sdkImport: string;
                    cli: {
                        bin: string;
                        args: ["--help"];
                    };
                };
                rollback: "byte-preimage";
            }, {
                quarantine: {
                    minimumReleaseAge: 604800;
                    exactExclusions: ["@hasnaxyz/infinity", "@hasnaxyz/factory", "@hasna/secrets", "@hasna/events"];
                };
                schema: "machines.exact_bun_registry.v1";
                order: number;
                mode: "live-global";
                source: {
                    provider: "files" | "task-attachment";
                    ref: string;
                    sha256: string;
                    sizeBytes: number;
                };
                archiveSha256: string;
                registryIntegrity: string;
                secretRefs: ["hasna/npm/live/publish-token", "hasnaxyz/npm/live/publish-token"];
                probe: {
                    sdkImport: string;
                    cli: {
                        bin: string;
                        args: ["--help"];
                    };
                };
                rollback: "byte-preimage";
            }>, {
                quarantine: {
                    minimumReleaseAge: 604800;
                    exactExclusions: ["@hasnaxyz/infinity", "@hasnaxyz/factory", "@hasna/secrets", "@hasna/events"];
                };
                schema: "machines.exact_bun_registry.v1";
                order: number;
                mode: "live-global";
                source: {
                    provider: "files" | "task-attachment";
                    ref: string;
                    sha256: string;
                    sizeBytes: number;
                };
                archiveSha256: string;
                registryIntegrity: string;
                secretRefs: ["hasna/npm/live/publish-token", "hasnaxyz/npm/live/publish-token"];
                probe: {
                    sdkImport: string;
                    cli: {
                        bin: string;
                        args: ["--help"];
                    };
                };
                rollback: "byte-preimage";
            }, {
                quarantine: {
                    minimumReleaseAge: 604800;
                    exactExclusions: ["@hasnaxyz/infinity", "@hasnaxyz/factory", "@hasna/secrets", "@hasna/events"];
                };
                schema: "machines.exact_bun_registry.v1";
                order: number;
                mode: "live-global";
                source: {
                    provider: "files" | "task-attachment";
                    ref: string;
                    sha256: string;
                    sizeBytes: number;
                };
                archiveSha256: string;
                registryIntegrity: string;
                secretRefs: ["hasna/npm/live/publish-token", "hasnaxyz/npm/live/publish-token"];
                probe: {
                    sdkImport: string;
                    cli: {
                        bin: string;
                        args: ["--help"];
                    };
                };
                rollback: "byte-preimage";
            }>>;
        }, "strict", z.ZodTypeAny, {
            name: string;
            bin?: string | undefined;
            manager?: "bun" | "brew" | "apt" | "custom" | undefined;
            version?: string | undefined;
            appId?: string | undefined;
            verify?: boolean | undefined;
            mcpHealthUrl?: string | undefined;
            exactBunRegistry?: {
                quarantine: {
                    minimumReleaseAge: 604800;
                    exactExclusions: ["@hasnaxyz/infinity", "@hasnaxyz/factory", "@hasna/secrets", "@hasna/events"];
                };
                schema: "machines.exact_bun_registry.v1";
                order: number;
                mode: "live-global";
                source: {
                    provider: "files" | "task-attachment";
                    ref: string;
                    sha256: string;
                    sizeBytes: number;
                };
                archiveSha256: string;
                registryIntegrity: string;
                secretRefs: ["hasna/npm/live/publish-token", "hasnaxyz/npm/live/publish-token"];
                probe: {
                    sdkImport: string;
                    cli: {
                        bin: string;
                        args: ["--help"];
                    };
                };
                rollback: "byte-preimage";
            } | undefined;
        }, {
            name: string;
            bin?: string | undefined;
            manager?: "bun" | "brew" | "apt" | "custom" | undefined;
            version?: string | undefined;
            appId?: string | undefined;
            verify?: boolean | undefined;
            mcpHealthUrl?: string | undefined;
            exactBunRegistry?: {
                quarantine: {
                    minimumReleaseAge: 604800;
                    exactExclusions: ["@hasnaxyz/infinity", "@hasnaxyz/factory", "@hasna/secrets", "@hasna/events"];
                };
                schema: "machines.exact_bun_registry.v1";
                order: number;
                mode: "live-global";
                source: {
                    provider: "files" | "task-attachment";
                    ref: string;
                    sha256: string;
                    sizeBytes: number;
                };
                archiveSha256: string;
                registryIntegrity: string;
                secretRefs: ["hasna/npm/live/publish-token", "hasnaxyz/npm/live/publish-token"];
                probe: {
                    sdkImport: string;
                    cli: {
                        bin: string;
                        args: ["--help"];
                    };
                };
                rollback: "byte-preimage";
            } | undefined;
        }>, {
            name: string;
            bin?: string | undefined;
            manager?: "bun" | "brew" | "apt" | "custom" | undefined;
            version?: string | undefined;
            appId?: string | undefined;
            verify?: boolean | undefined;
            mcpHealthUrl?: string | undefined;
            exactBunRegistry?: {
                quarantine: {
                    minimumReleaseAge: 604800;
                    exactExclusions: ["@hasnaxyz/infinity", "@hasnaxyz/factory", "@hasna/secrets", "@hasna/events"];
                };
                schema: "machines.exact_bun_registry.v1";
                order: number;
                mode: "live-global";
                source: {
                    provider: "files" | "task-attachment";
                    ref: string;
                    sha256: string;
                    sizeBytes: number;
                };
                archiveSha256: string;
                registryIntegrity: string;
                secretRefs: ["hasna/npm/live/publish-token", "hasnaxyz/npm/live/publish-token"];
                probe: {
                    sdkImport: string;
                    cli: {
                        bin: string;
                        args: ["--help"];
                    };
                };
                rollback: "byte-preimage";
            } | undefined;
        }, {
            name: string;
            bin?: string | undefined;
            manager?: "bun" | "brew" | "apt" | "custom" | undefined;
            version?: string | undefined;
            appId?: string | undefined;
            verify?: boolean | undefined;
            mcpHealthUrl?: string | undefined;
            exactBunRegistry?: {
                quarantine: {
                    minimumReleaseAge: 604800;
                    exactExclusions: ["@hasnaxyz/infinity", "@hasnaxyz/factory", "@hasna/secrets", "@hasna/events"];
                };
                schema: "machines.exact_bun_registry.v1";
                order: number;
                mode: "live-global";
                source: {
                    provider: "files" | "task-attachment";
                    ref: string;
                    sha256: string;
                    sizeBytes: number;
                };
                archiveSha256: string;
                registryIntegrity: string;
                secretRefs: ["hasna/npm/live/publish-token", "hasnaxyz/npm/live/publish-token"];
                probe: {
                    sdkImport: string;
                    cli: {
                        bin: string;
                        args: ["--help"];
                    };
                };
                rollback: "byte-preimage";
            } | undefined;
        }>, "many">>;
        apps: z.ZodOptional<z.ZodArray<z.ZodEffects<z.ZodObject<{
            name: z.ZodString;
            manager: z.ZodOptional<z.ZodEnum<["brew", "cask", "apt", "winget", "custom"]>>;
            packageName: z.ZodOptional<z.ZodString>;
            installCommand: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
            probeCommand: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
            expectedVersion: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
        }, "strip", z.ZodTypeAny, {
            name: string;
            manager?: "brew" | "apt" | "custom" | "cask" | "winget" | undefined;
            packageName?: string | undefined;
            installCommand?: string | undefined;
            probeCommand?: string | undefined;
            expectedVersion?: string | undefined;
        }, {
            name: string;
            manager?: "brew" | "apt" | "custom" | "cask" | "winget" | undefined;
            packageName?: string | undefined;
            installCommand?: string | undefined;
            probeCommand?: string | undefined;
            expectedVersion?: string | undefined;
        }>, {
            name: string;
            manager?: "brew" | "apt" | "custom" | "cask" | "winget" | undefined;
            packageName?: string | undefined;
            installCommand?: string | undefined;
            probeCommand?: string | undefined;
            expectedVersion?: string | undefined;
        }, {
            name: string;
            manager?: "brew" | "apt" | "custom" | "cask" | "winget" | undefined;
            packageName?: string | undefined;
            installCommand?: string | undefined;
            probeCommand?: string | undefined;
            expectedVersion?: string | undefined;
        }>, "many">>;
        files: z.ZodOptional<z.ZodArray<z.ZodObject<{
            source: z.ZodString;
            target: z.ZodString;
            mode: z.ZodOptional<z.ZodEnum<["copy", "symlink"]>>;
        }, "strip", z.ZodTypeAny, {
            source: string;
            target: string;
            mode?: "copy" | "symlink" | undefined;
        }, {
            source: string;
            target: string;
            mode?: "copy" | "symlink" | undefined;
        }>, "many">>;
    }, "strict", z.ZodTypeAny, {
        id: string;
        platform: "linux" | "macos" | "windows";
        workspacePath: string;
        files?: {
            source: string;
            target: string;
            mode?: "copy" | "symlink" | undefined;
        }[] | undefined;
        hostname?: string | undefined;
        sshAddress?: string | undefined;
        tailscaleName?: string | undefined;
        connection?: "local" | "ssh" | "tailscale" | undefined;
        bunPath?: string | undefined;
        tags?: string[] | undefined;
        metadata?: Record<string, unknown> | undefined;
        packages?: {
            name: string;
            bin?: string | undefined;
            manager?: "bun" | "brew" | "apt" | "custom" | undefined;
            version?: string | undefined;
            appId?: string | undefined;
            verify?: boolean | undefined;
            mcpHealthUrl?: string | undefined;
            exactBunRegistry?: {
                quarantine: {
                    minimumReleaseAge: 604800;
                    exactExclusions: ["@hasnaxyz/infinity", "@hasnaxyz/factory", "@hasna/secrets", "@hasna/events"];
                };
                schema: "machines.exact_bun_registry.v1";
                order: number;
                mode: "live-global";
                source: {
                    provider: "files" | "task-attachment";
                    ref: string;
                    sha256: string;
                    sizeBytes: number;
                };
                archiveSha256: string;
                registryIntegrity: string;
                secretRefs: ["hasna/npm/live/publish-token", "hasnaxyz/npm/live/publish-token"];
                probe: {
                    sdkImport: string;
                    cli: {
                        bin: string;
                        args: ["--help"];
                    };
                };
                rollback: "byte-preimage";
            } | undefined;
        }[] | undefined;
        apps?: {
            name: string;
            manager?: "brew" | "apt" | "custom" | "cask" | "winget" | undefined;
            packageName?: string | undefined;
            installCommand?: string | undefined;
            probeCommand?: string | undefined;
            expectedVersion?: string | undefined;
        }[] | undefined;
        aliases?: string[] | undefined;
        friendlyName?: string | undefined;
        updatedAt?: string | undefined;
    }, {
        id: string;
        platform: "linux" | "macos" | "windows";
        workspacePath: string;
        files?: {
            source: string;
            target: string;
            mode?: "copy" | "symlink" | undefined;
        }[] | undefined;
        hostname?: string | undefined;
        sshAddress?: string | undefined;
        tailscaleName?: string | undefined;
        connection?: "local" | "ssh" | "tailscale" | undefined;
        bunPath?: string | undefined;
        tags?: string[] | undefined;
        metadata?: Record<string, unknown> | undefined;
        packages?: {
            name: string;
            bin?: string | undefined;
            manager?: "bun" | "brew" | "apt" | "custom" | undefined;
            version?: string | undefined;
            appId?: string | undefined;
            verify?: boolean | undefined;
            mcpHealthUrl?: string | undefined;
            exactBunRegistry?: {
                quarantine: {
                    minimumReleaseAge: 604800;
                    exactExclusions: ["@hasnaxyz/infinity", "@hasnaxyz/factory", "@hasna/secrets", "@hasna/events"];
                };
                schema: "machines.exact_bun_registry.v1";
                order: number;
                mode: "live-global";
                source: {
                    provider: "files" | "task-attachment";
                    ref: string;
                    sha256: string;
                    sizeBytes: number;
                };
                archiveSha256: string;
                registryIntegrity: string;
                secretRefs: ["hasna/npm/live/publish-token", "hasnaxyz/npm/live/publish-token"];
                probe: {
                    sdkImport: string;
                    cli: {
                        bin: string;
                        args: ["--help"];
                    };
                };
                rollback: "byte-preimage";
            } | undefined;
        }[] | undefined;
        apps?: {
            name: string;
            manager?: "brew" | "apt" | "custom" | "cask" | "winget" | undefined;
            packageName?: string | undefined;
            installCommand?: string | undefined;
            probeCommand?: string | undefined;
            expectedVersion?: string | undefined;
        }[] | undefined;
        aliases?: string[] | undefined;
        friendlyName?: string | undefined;
        updatedAt?: string | undefined;
    }>, {
        id: string;
        platform: "linux" | "macos" | "windows";
        workspacePath: string;
        files?: {
            source: string;
            target: string;
            mode?: "copy" | "symlink" | undefined;
        }[] | undefined;
        hostname?: string | undefined;
        sshAddress?: string | undefined;
        tailscaleName?: string | undefined;
        connection?: "local" | "ssh" | "tailscale" | undefined;
        bunPath?: string | undefined;
        tags?: string[] | undefined;
        metadata?: Record<string, unknown> | undefined;
        packages?: {
            name: string;
            bin?: string | undefined;
            manager?: "bun" | "brew" | "apt" | "custom" | undefined;
            version?: string | undefined;
            appId?: string | undefined;
            verify?: boolean | undefined;
            mcpHealthUrl?: string | undefined;
            exactBunRegistry?: {
                quarantine: {
                    minimumReleaseAge: 604800;
                    exactExclusions: ["@hasnaxyz/infinity", "@hasnaxyz/factory", "@hasna/secrets", "@hasna/events"];
                };
                schema: "machines.exact_bun_registry.v1";
                order: number;
                mode: "live-global";
                source: {
                    provider: "files" | "task-attachment";
                    ref: string;
                    sha256: string;
                    sizeBytes: number;
                };
                archiveSha256: string;
                registryIntegrity: string;
                secretRefs: ["hasna/npm/live/publish-token", "hasnaxyz/npm/live/publish-token"];
                probe: {
                    sdkImport: string;
                    cli: {
                        bin: string;
                        args: ["--help"];
                    };
                };
                rollback: "byte-preimage";
            } | undefined;
        }[] | undefined;
        apps?: {
            name: string;
            manager?: "brew" | "apt" | "custom" | "cask" | "winget" | undefined;
            packageName?: string | undefined;
            installCommand?: string | undefined;
            probeCommand?: string | undefined;
            expectedVersion?: string | undefined;
        }[] | undefined;
        aliases?: string[] | undefined;
        friendlyName?: string | undefined;
        updatedAt?: string | undefined;
    }, {
        id: string;
        platform: "linux" | "macos" | "windows";
        workspacePath: string;
        files?: {
            source: string;
            target: string;
            mode?: "copy" | "symlink" | undefined;
        }[] | undefined;
        hostname?: string | undefined;
        sshAddress?: string | undefined;
        tailscaleName?: string | undefined;
        connection?: "local" | "ssh" | "tailscale" | undefined;
        bunPath?: string | undefined;
        tags?: string[] | undefined;
        metadata?: Record<string, unknown> | undefined;
        packages?: {
            name: string;
            bin?: string | undefined;
            manager?: "bun" | "brew" | "apt" | "custom" | undefined;
            version?: string | undefined;
            appId?: string | undefined;
            verify?: boolean | undefined;
            mcpHealthUrl?: string | undefined;
            exactBunRegistry?: {
                quarantine: {
                    minimumReleaseAge: 604800;
                    exactExclusions: ["@hasnaxyz/infinity", "@hasnaxyz/factory", "@hasna/secrets", "@hasna/events"];
                };
                schema: "machines.exact_bun_registry.v1";
                order: number;
                mode: "live-global";
                source: {
                    provider: "files" | "task-attachment";
                    ref: string;
                    sha256: string;
                    sizeBytes: number;
                };
                archiveSha256: string;
                registryIntegrity: string;
                secretRefs: ["hasna/npm/live/publish-token", "hasnaxyz/npm/live/publish-token"];
                probe: {
                    sdkImport: string;
                    cli: {
                        bin: string;
                        args: ["--help"];
                    };
                };
                rollback: "byte-preimage";
            } | undefined;
        }[] | undefined;
        apps?: {
            name: string;
            manager?: "brew" | "apt" | "custom" | "cask" | "winget" | undefined;
            packageName?: string | undefined;
            installCommand?: string | undefined;
            probeCommand?: string | undefined;
            expectedVersion?: string | undefined;
        }[] | undefined;
        aliases?: string[] | undefined;
        friendlyName?: string | undefined;
        updatedAt?: string | undefined;
    }>, "many">;
}, "strict", z.ZodTypeAny, {
    machines: {
        id: string;
        platform: "linux" | "macos" | "windows";
        workspacePath: string;
        files?: {
            source: string;
            target: string;
            mode?: "copy" | "symlink" | undefined;
        }[] | undefined;
        hostname?: string | undefined;
        sshAddress?: string | undefined;
        tailscaleName?: string | undefined;
        connection?: "local" | "ssh" | "tailscale" | undefined;
        bunPath?: string | undefined;
        tags?: string[] | undefined;
        metadata?: Record<string, unknown> | undefined;
        packages?: {
            name: string;
            bin?: string | undefined;
            manager?: "bun" | "brew" | "apt" | "custom" | undefined;
            version?: string | undefined;
            appId?: string | undefined;
            verify?: boolean | undefined;
            mcpHealthUrl?: string | undefined;
            exactBunRegistry?: {
                quarantine: {
                    minimumReleaseAge: 604800;
                    exactExclusions: ["@hasnaxyz/infinity", "@hasnaxyz/factory", "@hasna/secrets", "@hasna/events"];
                };
                schema: "machines.exact_bun_registry.v1";
                order: number;
                mode: "live-global";
                source: {
                    provider: "files" | "task-attachment";
                    ref: string;
                    sha256: string;
                    sizeBytes: number;
                };
                archiveSha256: string;
                registryIntegrity: string;
                secretRefs: ["hasna/npm/live/publish-token", "hasnaxyz/npm/live/publish-token"];
                probe: {
                    sdkImport: string;
                    cli: {
                        bin: string;
                        args: ["--help"];
                    };
                };
                rollback: "byte-preimage";
            } | undefined;
        }[] | undefined;
        apps?: {
            name: string;
            manager?: "brew" | "apt" | "custom" | "cask" | "winget" | undefined;
            packageName?: string | undefined;
            installCommand?: string | undefined;
            probeCommand?: string | undefined;
            expectedVersion?: string | undefined;
        }[] | undefined;
        aliases?: string[] | undefined;
        friendlyName?: string | undefined;
        updatedAt?: string | undefined;
    }[];
    version: 1;
    packages?: {
        name: string;
        bin?: string | undefined;
        manager?: "bun" | "brew" | "apt" | "custom" | undefined;
        version?: string | undefined;
        appId?: string | undefined;
        verify?: boolean | undefined;
        mcpHealthUrl?: string | undefined;
        exactBunRegistry?: {
            quarantine: {
                minimumReleaseAge: 604800;
                exactExclusions: ["@hasnaxyz/infinity", "@hasnaxyz/factory", "@hasna/secrets", "@hasna/events"];
            };
            schema: "machines.exact_bun_registry.v1";
            order: number;
            mode: "live-global";
            source: {
                provider: "files" | "task-attachment";
                ref: string;
                sha256: string;
                sizeBytes: number;
            };
            archiveSha256: string;
            registryIntegrity: string;
            secretRefs: ["hasna/npm/live/publish-token", "hasnaxyz/npm/live/publish-token"];
            probe: {
                sdkImport: string;
                cli: {
                    bin: string;
                    args: ["--help"];
                };
            };
            rollback: "byte-preimage";
        } | undefined;
    }[] | undefined;
    generatedAt?: string | undefined;
    freeze?: {
        name: string;
        reason?: string | undefined;
        frozenAt?: string | undefined;
        until?: string | undefined;
    }[] | undefined;
}, {
    machines: {
        id: string;
        platform: "linux" | "macos" | "windows";
        workspacePath: string;
        files?: {
            source: string;
            target: string;
            mode?: "copy" | "symlink" | undefined;
        }[] | undefined;
        hostname?: string | undefined;
        sshAddress?: string | undefined;
        tailscaleName?: string | undefined;
        connection?: "local" | "ssh" | "tailscale" | undefined;
        bunPath?: string | undefined;
        tags?: string[] | undefined;
        metadata?: Record<string, unknown> | undefined;
        packages?: {
            name: string;
            bin?: string | undefined;
            manager?: "bun" | "brew" | "apt" | "custom" | undefined;
            version?: string | undefined;
            appId?: string | undefined;
            verify?: boolean | undefined;
            mcpHealthUrl?: string | undefined;
            exactBunRegistry?: {
                quarantine: {
                    minimumReleaseAge: 604800;
                    exactExclusions: ["@hasnaxyz/infinity", "@hasnaxyz/factory", "@hasna/secrets", "@hasna/events"];
                };
                schema: "machines.exact_bun_registry.v1";
                order: number;
                mode: "live-global";
                source: {
                    provider: "files" | "task-attachment";
                    ref: string;
                    sha256: string;
                    sizeBytes: number;
                };
                archiveSha256: string;
                registryIntegrity: string;
                secretRefs: ["hasna/npm/live/publish-token", "hasnaxyz/npm/live/publish-token"];
                probe: {
                    sdkImport: string;
                    cli: {
                        bin: string;
                        args: ["--help"];
                    };
                };
                rollback: "byte-preimage";
            } | undefined;
        }[] | undefined;
        apps?: {
            name: string;
            manager?: "brew" | "apt" | "custom" | "cask" | "winget" | undefined;
            packageName?: string | undefined;
            installCommand?: string | undefined;
            probeCommand?: string | undefined;
            expectedVersion?: string | undefined;
        }[] | undefined;
        aliases?: string[] | undefined;
        friendlyName?: string | undefined;
        updatedAt?: string | undefined;
    }[];
    version: 1;
    packages?: {
        name: string;
        bin?: string | undefined;
        manager?: "bun" | "brew" | "apt" | "custom" | undefined;
        version?: string | undefined;
        appId?: string | undefined;
        verify?: boolean | undefined;
        mcpHealthUrl?: string | undefined;
        exactBunRegistry?: {
            quarantine: {
                minimumReleaseAge: 604800;
                exactExclusions: ["@hasnaxyz/infinity", "@hasnaxyz/factory", "@hasna/secrets", "@hasna/events"];
            };
            schema: "machines.exact_bun_registry.v1";
            order: number;
            mode: "live-global";
            source: {
                provider: "files" | "task-attachment";
                ref: string;
                sha256: string;
                sizeBytes: number;
            };
            archiveSha256: string;
            registryIntegrity: string;
            secretRefs: ["hasna/npm/live/publish-token", "hasnaxyz/npm/live/publish-token"];
            probe: {
                sdkImport: string;
                cli: {
                    bin: string;
                    args: ["--help"];
                };
            };
            rollback: "byte-preimage";
        } | undefined;
    }[] | undefined;
    generatedAt?: string | undefined;
    freeze?: {
        name: string;
        reason?: string | undefined;
        frozenAt?: string | undefined;
        until?: string | undefined;
    }[] | undefined;
}>, {
    machines: {
        id: string;
        platform: "linux" | "macos" | "windows";
        workspacePath: string;
        files?: {
            source: string;
            target: string;
            mode?: "copy" | "symlink" | undefined;
        }[] | undefined;
        hostname?: string | undefined;
        sshAddress?: string | undefined;
        tailscaleName?: string | undefined;
        connection?: "local" | "ssh" | "tailscale" | undefined;
        bunPath?: string | undefined;
        tags?: string[] | undefined;
        metadata?: Record<string, unknown> | undefined;
        packages?: {
            name: string;
            bin?: string | undefined;
            manager?: "bun" | "brew" | "apt" | "custom" | undefined;
            version?: string | undefined;
            appId?: string | undefined;
            verify?: boolean | undefined;
            mcpHealthUrl?: string | undefined;
            exactBunRegistry?: {
                quarantine: {
                    minimumReleaseAge: 604800;
                    exactExclusions: ["@hasnaxyz/infinity", "@hasnaxyz/factory", "@hasna/secrets", "@hasna/events"];
                };
                schema: "machines.exact_bun_registry.v1";
                order: number;
                mode: "live-global";
                source: {
                    provider: "files" | "task-attachment";
                    ref: string;
                    sha256: string;
                    sizeBytes: number;
                };
                archiveSha256: string;
                registryIntegrity: string;
                secretRefs: ["hasna/npm/live/publish-token", "hasnaxyz/npm/live/publish-token"];
                probe: {
                    sdkImport: string;
                    cli: {
                        bin: string;
                        args: ["--help"];
                    };
                };
                rollback: "byte-preimage";
            } | undefined;
        }[] | undefined;
        apps?: {
            name: string;
            manager?: "brew" | "apt" | "custom" | "cask" | "winget" | undefined;
            packageName?: string | undefined;
            installCommand?: string | undefined;
            probeCommand?: string | undefined;
            expectedVersion?: string | undefined;
        }[] | undefined;
        aliases?: string[] | undefined;
        friendlyName?: string | undefined;
        updatedAt?: string | undefined;
    }[];
    version: 1;
    packages?: {
        name: string;
        bin?: string | undefined;
        manager?: "bun" | "brew" | "apt" | "custom" | undefined;
        version?: string | undefined;
        appId?: string | undefined;
        verify?: boolean | undefined;
        mcpHealthUrl?: string | undefined;
        exactBunRegistry?: {
            quarantine: {
                minimumReleaseAge: 604800;
                exactExclusions: ["@hasnaxyz/infinity", "@hasnaxyz/factory", "@hasna/secrets", "@hasna/events"];
            };
            schema: "machines.exact_bun_registry.v1";
            order: number;
            mode: "live-global";
            source: {
                provider: "files" | "task-attachment";
                ref: string;
                sha256: string;
                sizeBytes: number;
            };
            archiveSha256: string;
            registryIntegrity: string;
            secretRefs: ["hasna/npm/live/publish-token", "hasnaxyz/npm/live/publish-token"];
            probe: {
                sdkImport: string;
                cli: {
                    bin: string;
                    args: ["--help"];
                };
            };
            rollback: "byte-preimage";
        } | undefined;
    }[] | undefined;
    generatedAt?: string | undefined;
    freeze?: {
        name: string;
        reason?: string | undefined;
        frozenAt?: string | undefined;
        until?: string | undefined;
    }[] | undefined;
}, {
    machines: {
        id: string;
        platform: "linux" | "macos" | "windows";
        workspacePath: string;
        files?: {
            source: string;
            target: string;
            mode?: "copy" | "symlink" | undefined;
        }[] | undefined;
        hostname?: string | undefined;
        sshAddress?: string | undefined;
        tailscaleName?: string | undefined;
        connection?: "local" | "ssh" | "tailscale" | undefined;
        bunPath?: string | undefined;
        tags?: string[] | undefined;
        metadata?: Record<string, unknown> | undefined;
        packages?: {
            name: string;
            bin?: string | undefined;
            manager?: "bun" | "brew" | "apt" | "custom" | undefined;
            version?: string | undefined;
            appId?: string | undefined;
            verify?: boolean | undefined;
            mcpHealthUrl?: string | undefined;
            exactBunRegistry?: {
                quarantine: {
                    minimumReleaseAge: 604800;
                    exactExclusions: ["@hasnaxyz/infinity", "@hasnaxyz/factory", "@hasna/secrets", "@hasna/events"];
                };
                schema: "machines.exact_bun_registry.v1";
                order: number;
                mode: "live-global";
                source: {
                    provider: "files" | "task-attachment";
                    ref: string;
                    sha256: string;
                    sizeBytes: number;
                };
                archiveSha256: string;
                registryIntegrity: string;
                secretRefs: ["hasna/npm/live/publish-token", "hasnaxyz/npm/live/publish-token"];
                probe: {
                    sdkImport: string;
                    cli: {
                        bin: string;
                        args: ["--help"];
                    };
                };
                rollback: "byte-preimage";
            } | undefined;
        }[] | undefined;
        apps?: {
            name: string;
            manager?: "brew" | "apt" | "custom" | "cask" | "winget" | undefined;
            packageName?: string | undefined;
            installCommand?: string | undefined;
            probeCommand?: string | undefined;
            expectedVersion?: string | undefined;
        }[] | undefined;
        aliases?: string[] | undefined;
        friendlyName?: string | undefined;
        updatedAt?: string | undefined;
    }[];
    version: 1;
    packages?: {
        name: string;
        bin?: string | undefined;
        manager?: "bun" | "brew" | "apt" | "custom" | undefined;
        version?: string | undefined;
        appId?: string | undefined;
        verify?: boolean | undefined;
        mcpHealthUrl?: string | undefined;
        exactBunRegistry?: {
            quarantine: {
                minimumReleaseAge: 604800;
                exactExclusions: ["@hasnaxyz/infinity", "@hasnaxyz/factory", "@hasna/secrets", "@hasna/events"];
            };
            schema: "machines.exact_bun_registry.v1";
            order: number;
            mode: "live-global";
            source: {
                provider: "files" | "task-attachment";
                ref: string;
                sha256: string;
                sizeBytes: number;
            };
            archiveSha256: string;
            registryIntegrity: string;
            secretRefs: ["hasna/npm/live/publish-token", "hasnaxyz/npm/live/publish-token"];
            probe: {
                sdkImport: string;
                cli: {
                    bin: string;
                    args: ["--help"];
                };
            };
            rollback: "byte-preimage";
        } | undefined;
    }[] | undefined;
    generatedAt?: string | undefined;
    freeze?: {
        name: string;
        reason?: string | undefined;
        frozenAt?: string | undefined;
        until?: string | undefined;
    }[] | undefined;
}>;
export declare function normalizeFriendlyName(value: string | null | undefined): string | null;
export declare function machineDisplayName(machine: Pick<MachineManifest, "id" | "friendlyName">): string;
export declare function getManifestSourceRef(options?: ReadManifestWithSourceOptions): ManifestSourceRef;
export declare function getDefaultManifest(): FleetManifest;
export declare function readManifest(path?: string): FleetManifest;
export declare function readManifestWithSource(options?: ReadManifestWithSourceOptions): {
    manifest: FleetManifest;
    info: ManifestLoadInfo;
};
export declare function validateManifest(path?: string): FleetManifest;
export declare function writeManifest(manifest: FleetManifest, path?: string): string;
export declare function getManifestMachine(machineId: string, path?: string): MachineManifest | null;
/** Resolve canonical ids first, then the legacy aliases retained by a re-keyed machine. */
export declare function findManifestMachine(manifest: FleetManifest, machineId: string): MachineManifest | null;
export declare function detectCurrentMachineManifest(): MachineManifest;
