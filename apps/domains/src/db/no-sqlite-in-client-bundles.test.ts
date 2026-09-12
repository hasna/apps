/**
 * Ratchet: `bun:sqlite` must be unreachable from every CLIENT entrypoint.
 *
 * `domains` has no local client mode — `getStore()` only ever returns
 * ApiStore and `lib/client-storage-policy.ts` REFUSES the legacy local-path
 * variables — so no client bundle has any business importing sqlite. One did
 * anyway: `cli/commands/doctor.ts` pulled the store module through a dynamic
 * `import()`, which materialises the whole module namespace, defeats
 * per-export tree-shaking and dragged LocalStore → `db/database.ts` →
 * `bun:sqlite` into `dist/cli/index.js` (1 hit, measured 2026-09-11).
 *
 * The check bundles each client entrypoint exactly as `bun run build` does
 * except that every bare specifier stays external — so this exercises OUR
 * source graph and its tree-shaking, deterministically, without depending on
 * `node_modules` or a sibling workspace's `dist/` being stable mid-run.
 * `bun:sqlite` is a Bun builtin and therefore always emitted as a literal
 * `import … from "bun:sqlite"` when it survives, which is what we grep for.
 *
 * The sqlite modules (`db/database.ts`, `db/local-store.ts`) stay in the tree
 * for the explicit storage fixtures; no client entrypoint may reach them.
 */

import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

const PKG_ROOT = resolve(import.meta.dir, "../..");

/** Every entrypoint an end user can run or import; none may reach sqlite. */
const CLIENT_ENTRYPOINTS = ["src/cli/index.ts", "src/mcp/index.ts", "src/sdk/index.ts"] as const;

describe("no bun:sqlite in the client bundles", () => {
  for (const entry of CLIENT_ENTRYPOINTS) {
    test(
      `${entry} bundles without bun:sqlite`,
      async () => {
        const result = await Bun.build({
          entrypoints: [resolve(PKG_ROOT, entry)],
          target: "bun",
          packages: "external",
        });
        expect(result.logs.filter((l) => l.level === "error").map(String)).toEqual([]);
        expect(result.success).toBe(true);
        expect(result.outputs.length).toBeGreaterThan(0);
        for (const artifact of result.outputs) {
          const code = await artifact.text();
          expect({ entry, sqlite: code.includes("bun:sqlite") }).toEqual({ entry, sqlite: false });
        }
      },
      60_000,
    );
  }
});
