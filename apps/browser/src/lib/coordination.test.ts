/**
 * Regression for the publish-guard TS2307 class (todos 0cbbd621): the
 * browser prepack build's `build:types` step (tsc) type-checks
 * src/lib/coordination.ts, whose dynamic import of the OPTIONAL
 * @hasna/conversations SDK must resolve without the workspace member's built
 * dist existing. In a fresh checkout apps/conversations/dist is gitignored
 * and absent — and the publish-guard packs members alphabetically, browser
 * before conversations — so a literal `import("@hasna/conversations")`
 * specifier fails tsc with TS2307 at every PR head and on main itself,
 * blocking the whole merge queue.
 *
 * The module is an optional runtime integration (loaded in a try/catch, every
 * use is `as any`), so the import is expressed with a non-literal specifier
 * that TypeScript resolves at runtime only — the same pattern as
 * src/engines/kernel.ts and src/lib/auth.ts. This test runs tsc on exactly
 * the failing module with the member's tsconfig compiler options and asserts
 * exit 0.
 *
 * Two-sided: whenever apps/conversations/dist is absent (the fresh-checkout
 * gate context, and the condition under which the defect was red), the
 * literal specifier fails this check with TS2307 and the non-literal
 * specifier passes. Runtime behavior of the SDK wrapper is covered by
 * src/lib/integrations.test.ts.
 */
import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const BROWSER_ROOT = path.resolve(import.meta.dir, "..", "..");

const TSC_ENTRY = path.join(BROWSER_ROOT, "node_modules", "typescript", "bin", "tsc");

function runTscOnCoordination(): { rc: number; out: string } {
  if (!fs.existsSync(TSC_ENTRY)) {
    throw new Error(`typescript not installed in apps/browser: ${TSC_ENTRY}`);
  }
  // Mirror apps/browser/tsconfig.json compilerOptions (the build:types
  // resolution context), single-file scope so the check is fast and names
  // exactly the module under regression.
  const args = [
    TSC_ENTRY,
    "--noEmit",
    "--target", "ES2022",
    "--module", "ESNext",
    "--moduleResolution", "bundler",
    "--lib", "ES2022,DOM",
    "--jsx", "react-jsx",
    "--strict",
    "--skipLibCheck",
    "--esModuleInterop",
    "--allowSyntheticDefaultImports",
    "--types", "bun-types",
    "src/lib/coordination.ts",
  ];
  try {
    const out = execFileSync(process.execPath, args, {
      cwd: BROWSER_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { rc: 0, out };
  } catch (e: any) {
    const out = String(e?.stdout ?? "") + String(e?.stderr ?? "");
    return { rc: typeof e?.status === "number" ? e.status : 1, out };
  }
}

describe("coordination prepack typecheck (publish-guard regression, 0cbbd621)", () => {
  test("coordination.ts type-checks with @hasna/conversations as an optional runtime module", () => {
    const { rc, out } = runTscOnCoordination();
    expect(rc, `tsc on src/lib/coordination.ts failed (rc=${rc}):\n${out}`).toBe(0);
  });
});
