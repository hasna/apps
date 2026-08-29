import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * O15-04563 — bun 1.3.14 ESM default-export interop regression
 * (same class as O15-04049 in @hasna/todos).
 *
 * The bundled CLI and its external `ink` dependency load `signal-exit` at
 * runtime: ink's render chain (`build/render.js` -> `build/ink.js`) does
 * `import signalExit from 'signal-exit'`, and `build/instance.js` does
 * `_interopRequireDefault(require("signal-exit"))`. signal-exit 4.x ships an
 * ESM build selected through the package `exports` "import" condition;
 * bun 1.3.14 crashes evaluating that mjs build's default-export interop
 * (`SyntaxError: Missing 'default' export in module
 * signal-exit/dist/mjs/index.js`, reproduced as "Multiple exports with the
 * same name onExit") whenever the hoisted 4.x copy satisfies the resolution
 * — exactly what bun's global-install hoisting did on station01 when
 * @hasna/conversations' ink chain resolved `signal-exit` to a root-hoisted
 * 4.1.0 (pulled in via execa/foreground-child/spawndamnit via
 * @changesets/git). The CJS v3 build (no `exports` map) is immune.
 *
 * The manifest therefore pins `signal-exit` to 3.0.7 as a DIRECT dependency:
 * in any install layout — including the fleet global install, where other
 * packages hoist signal-exit@4.1.0 to the shared root — the conflicting
 * direct range forces a CJS 3.x copy inside the @hasna/conversations tree,
 * so both the bundle's ink import chain and ink's own `require("signal-exit")`
 * resolve the CJS build.
 */
describe("signal-exit resolves to the CJS v3 build (O15-04563)", () => {
  test("the manifest declares signal-exit pinned below v4", () => {
    const pkg = JSON.parse(
      readFileSync(join(import.meta.dir, "..", "..", "package.json"), "utf8"),
    ) as { dependencies?: Record<string, string> };

    const range = pkg.dependencies?.["signal-exit"];
    // The pin is the fix: without a direct declaration, a resolver may
    // satisfy ink's ^3.0.7 from a hoisted signal-exit@4.1.0 (bun 1.3.14
    // global-install hoisting did exactly that on station01).
    expect(range).toBeDefined();
    // v4+ is the interop-hostile line; only the 3.x CJS line is safe.
    expect(range).toMatch(/^3\./);
  });

  test("resolving signal-exit from the CLI source tree lands on the CJS v3 build", () => {
    // v3 has no "exports" map, so Bun.resolveSync on the bare specifier
    // resolves the entry FILE (index.js); resolve the manifest directly.
    const resolved = Bun.resolveSync("signal-exit/package.json", join(import.meta.dir, "index.tsx"));
    const pkg = JSON.parse(
      readFileSync(resolved, "utf8"),
    ) as { version: string; exports?: unknown; main?: string };

    expect(pkg.version.startsWith("3.")).toBe(true);
    // v3 ships no conditional "exports" map, so the mjs "import" condition
    // that breaks under bun 1.3.14 can never be selected at runtime.
    expect(pkg.exports).toBeUndefined();
    expect(pkg.main ?? "index.js").toContain("index.js");
  });

  test("ink's own signal-exit resolution stays on the CJS v3 build", () => {
    // ink/build/instance.js does `_interopRequireDefault(require("signal-exit"))`
    // and ink/build/ink.js does `import signalExit from 'signal-exit'` — the
    // exact interop surfaces that crashed. Resolve the way ink resolves.
    const inkDir = join(import.meta.dir, "..", "..", "node_modules", "ink", "build");
    const resolved = Bun.resolveSync("signal-exit/package.json", inkDir);
    const pkg = JSON.parse(
      readFileSync(resolved, "utf8"),
    ) as { version: string; exports?: unknown };

    expect(pkg.version.startsWith("3.")).toBe(true);
    expect(pkg.exports).toBeUndefined();
  });
});
