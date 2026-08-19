/**
 * Ambient type fallback for the @hasna/secrets/scanner subpath.
 *
 * Why this file exists: @hasna/secrets is a workspace member that does NOT
 * commit its dist/ (unlike apps/events, whose committed dist is what lets the
 * search member's existing @hasna/events import type-check in every CI job).
 * The publish-guard job runs only `bun install` and then `npm pack --dry-run`
 * per member, so apps/secrets/dist does not exist there — and the search
 * member's prepack (`bun run build`) ends in `tsc --emitDeclarationOnly`,
 * which must resolve `@hasna/secrets/scanner` at type level. Without a
 * fallback, TS2307 refuses the build in exactly the job that exists to vet
 * the tarball.
 *
 * How it behaves: an ambient `declare module` is used by tsc ONLY when module
 * resolution cannot find the real module. Wherever apps/secrets/dist exists
 * (local dev, the turbo build-test job), the REAL scanner types are used and
 * this stub is inert. It is not shipped — `files` publishes dist/ only — and
 * at runtime the real module is always loaded (bun build leaves the bare
 * dynamic-import specifier external; @hasna/secrets is a declared dependency
 * of this package).
 *
 * Keep this subset shape-compatible with apps/secrets/src/scanner.ts. The
 * capture writer consumes only `findings[].detector` and validates the
 * runtime surface itself (the typeof guard in writer.ts), so a stale stub
 * fails fast rather than misbehaving.
 */
declare module "@hasna/secrets/scanner" {
  export interface ExposureFinding {
    id: string;
    detector: string;
  }
  export interface ExposureScanResult {
    findings: ExposureFinding[];
    findingCount: number;
    truncated: boolean;
  }
  export interface InputExposureScanOptions {
    text?: string;
    limit?: number;
    maxBytes?: number;
    timeoutMs?: number;
  }
  export function scanInputExposures(
    options: InputExposureScanOptions,
  ): ExposureScanResult;
}
