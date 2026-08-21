/** Ordered list of template files that make up the kit. */
export declare const KIT_TEMPLATE_FILES: readonly ["own.ts", "backend.ts", "tls.ts", "query.ts", "pool.ts", "migrations.ts", "health.ts", "index.ts", "README.md"];
/** Files emitted by older kit versions and removed during regeneration. */
export declare const RETIRED_KIT_FILES: readonly ["mode.ts"];
export type KitTemplateFile = (typeof KIT_TEMPLATE_FILES)[number];
/** Relative directory the kit is stamped into inside a target repo. */
export declare const KIT_TARGET_SUBDIR = "src/generated/storage-kit";
export declare const KIT_MANIFEST_FILE = ".storage-kit-manifest.json";
export declare const KIT_VERSION_PLACEHOLDER = "__KIT_VERSION__";
export interface KitManifest {
    generator: string;
    kitVersion: string;
    files: Record<string, string>;
}
/**
 * Whether a kit version is compatible with the target repo's declared
 * `@hasna/contracts` dependency range. `null` means "no verdict" — the range
 * or version is unparseable (`workspace:`, `*`, prerelease) and the check
 * stays silent rather than guessing.
 *
 * The comparison is major.minor only. In the fleet's 0.x lineage a minor
 * line is the compatibility boundary (`^0.8.5` means `0.8.x`), so a kit
 * stamped on a different minor line than the declared dependency is drift
 * even when the generated files happen to be self-contained.
 */
export declare function kitMatchesDeclaredDependency(kitVersion: string, declared: string): boolean | null;
/** Read the target repo's declared `@hasna/contracts` dependency, if any. */
export declare function readDeclaredKitDependency(targetRepo: string): string | null;
/** Walk up from `start` to the `@hasna/contracts` package root (has package.json). */
export declare function findPackageRoot(start?: string): string;
/** Resolve the templates directory. */
export declare function resolveTemplatesDir(): string;
/** Read the `@hasna/contracts` version — the value stamped as KIT_VERSION. */
export declare function getKitVersion(): string;
/** Render a single template into its final, stamped content for `version`. */
export declare function renderKitFile(file: KitTemplateFile, version: string, templatesDir?: string): string;
export declare function sha256(content: string): string;
export interface RenderedKit {
    version: string;
    files: Record<string, string>;
    manifest: KitManifest;
}
/** Render the entire kit (all files + manifest) for `version` without touching disk. */
export declare function renderKit(version?: string): RenderedKit;
export interface GenerateKitOptions {
    targetRepo: string;
    version?: string;
    /** Update `hasna.contract.json` kitVersion. Default true. */
    writeContract?: boolean;
}
export interface GenerateKitResult {
    version: string;
    targetDir: string;
    written: string[];
    removed: string[];
    contractUpdated: boolean;
}
/** Stamp the kit into `targetRepo`. Overwrites the generated dir deterministically. */
export declare function generateKit(options: GenerateKitOptions): GenerateKitResult;
/** Write `kitVersion` into `<targetRepo>/hasna.contract.json` if present. */
export declare function writeKitVersionToContract(targetRepo: string, version: string): boolean;
export type KitFileStatus = "ok" | "modified" | "missing";
export interface KitCheckFileResult {
    file: string;
    status: KitFileStatus;
}
export interface KitCheckResult {
    ok: boolean;
    version: string;
    targetDir: string;
    files: KitCheckFileResult[];
    extras: string[];
    /** Present when the on-disk manifest records a different kitVersion. */
    staleVersion: string | null;
    /**
     * Present when the target repo declares an `@hasna/contracts` dependency on
     * a different minor line than the kit it carries — e.g. kit 0.4.2 under a
     * `^0.8.5` dependency. The remedy is regenerating the kit or aligning the
     * dependency, never hand-editing the kit.
     */
    depVersionMismatch: {
        kitVersion: string;
        declared: string;
    } | null;
}
export interface CheckKitOptions {
    targetRepo: string;
    version?: string;
}
/**
 * Compare the on-disk kit against a fresh render for `version` (defaults to the
 * installed package version). Any content difference — stale version or a hand
 * edit — surfaces as `modified`/`missing`. Extra files are reported too.
 */
export declare function checkKit(options: CheckKitOptions): KitCheckResult;
