/** How a reachable package got into the tree. */
export type EdgeScope = "production" | "development";
export interface DependencyEdge {
    /** The forbidden package that is reachable. */
    packageName: string;
    scope: EdgeScope;
    /** Root -> ... -> packageName, for the finding message. */
    path: string[];
    source: "package.json" | "bun.lock";
    /** The manifest section that opened the path, when it starts at the root. */
    section?: string;
}
/**
 * Sections that pull a package into an install.
 *
 * `overrides`/`resolutions` are here because pinning a version is an edge even
 * when nothing else names the package, and `trustedDependencies`/
 * `bundleDependencies` because they are arrays of names, not version maps.
 */
export declare const PRODUCTION_SECTIONS: readonly ["dependencies", "optionalDependencies", "peerDependencies"];
export declare const DEVELOPMENT_SECTIONS: readonly ["devDependencies"];
export declare const PIN_SECTIONS: readonly ["overrides", "resolutions"];
export declare const NAME_LIST_SECTIONS: readonly ["bundleDependencies", "bundledDependencies", "trustedDependencies"];
/**
 * Parse JSON that may carry trailing commas.
 *
 * `bun.lock` is JSONC: it is written with a trailing comma after the last
 * entry of most objects. Stripping them has to skip string contents, or a
 * `file:../cloud-shim` specifier could be mangled.
 */
export declare function parseLooseJson(text: string): unknown | null;
/** Direct edges declared by the scanned package's own manifest. */
export declare function manifestEdges(manifest: unknown, forbidden: readonly string[]): DependencyEdge[];
/**
 * Is this resolution a local path link rather than a registry download?
 *
 * This decides whether the package's devDependencies get installed, and npm
 * semantics do not predict it. Measured on bun 1.3.14, isolated probe repos:
 *
 *   1. root -> `commander@13.1.0` (registry): commander lands, none of its six
 *      devDependencies do. Registry dev edges are not installed.
 *   2. root -> `file:../pkg-a`, pkg-a devDepends on registry `commander`:
 *      commander LANDS, hoisted to the root. A linked package is built from
 *      source, so its dev edges are installed.
 *
 * WHAT THIS FLAG GATES, so the comment does not outrun the code: `node.linked`
 * decides whether to follow a node's DEVELOPMENT edges, and — via
 * `isHoistedInstall` — whether a transitive linked resolution is reachable at
 * all. The topology half is measured in `isHoistedInstall`.
 */
export declare function isLinkedResolution(id: string): boolean;
/**
 * The package name inside a bun lockfile resolution id.
 *
 * Ids look like `pg@8.22.0` or `@hasna/cloud@file:../cloud-shim`; the scope
 * sigil means the separating `@` is not the first character.
 */
export declare function nameFromResolutionId(id: string): string | null;
/**
 * The package a resolution id really installs, when its key is an alias for
 * something else.
 *
 * `file:`, `link:` and `workspace:` name a DIRECTORY and `npm:` names a
 * registry package, so any of them can pull the retired runtime into the tree
 * under a name that is on no list: `bun install` records a dependency on
 * `../cloud-shim` declared as `@hasna/legacy` as
 * `@hasna/legacy@file:../cloud-shim`, and the key alone says nothing at all.
 *
 * Returns null for the ordinary case where the id resolves to its own name.
 */
export declare function resolutionTarget(id: string): string | null;
/**
 * Every forbidden package reachable from the workspaces of `bun.lock`.
 *
 * Install semantics as bun actually implements them:
 *
 *   - every workspace's production AND development sections are installed;
 *   - a registry package's production edges are followed, its dev edges are
 *     not — nobody installs a dependency's devDependencies;
 *   - a LINKED package's dev edges ARE followed, because bun installs them.
 *     See `isLinkedResolution` for the measurement.
 *
 * Anything reached through a development hop is reported as development, so a
 * dev-only edge cannot be laundered into a production verdict by a later
 * production hop.
 *
 * Reachability is keyed by NAME rather than by the lockfile's nesting path.
 * Where one name has several entries their edges are unioned, which can only
 * over-approximate — the safe direction for a gate.
 *
 * Returns null when the lockfile cannot be understood, so the caller can fall
 * back to the text scan rather than silently reporting a clean tree.
 */
export declare function lockfileEdges(lockText: string, forbidden: readonly string[]): DependencyEdge[] | null;
/**
 * The walk's full result: the edges it found, and the forbidden names it
 * deliberately DECIDED were not installed.
 *
 * The second half is what lets the caller keep a text fallback for package
 * names without reintroducing the false positive this module exists to remove.
 * `hasna/logs` names the retired runtime in its lockfile and does not install
 * it; a stale or hand-edited `packages` entry names it and the walk never
 * reaches it at all. Those look identical to a substring and are opposite
 * answers, so the walk has to say which one it made.
 *
 * `clearedByLayout` is populated ONLY where the hoisted-layout filter dropped a
 * node — the one shape measured on bun 1.3.14 (see `isHoistedInstall`). Silence
 * about a name the walk never examined is not a clearance.
 */
export interface LockfileWalk {
    edges: DependencyEdge[];
    /** Forbidden names proved unreachable by the install layout, not merely unvisited. */
    clearedByLayout: string[];
}
export declare function lockfileWalk(lockText: string, forbidden: readonly string[]): LockfileWalk | null;
