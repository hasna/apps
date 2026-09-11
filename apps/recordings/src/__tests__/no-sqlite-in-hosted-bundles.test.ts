// The shipped hosted binaries must not carry a local database engine.
//
// `recordings` and `recordings-mcp` fail closed without a credential, but until
// the LocalStore moved behind the gated dynamic import in src/local/load.ts the
// bundler still emitted `bun:sqlite` and the whole src/db tree into
// dist/cli/index.js and dist/mcp/index.js: a hosted-only binary shipping the
// engine it is forbidden to use, one static import away from a silent local
// fallback. Static reachability is the property, so it is asserted on a REAL
// bundle of the real entry points — the same entries, target and externals
// `build:cli` / `build:mcp` use — rather than on a grep over the sources, which
// a transitive import would walk straight past.
//
// The local store itself is NOT expected to disappear: the opt-in
// (HASNA_RECORDINGS_LOCAL=1) still works, and this test proves the sqlite code
// is emitted as a CHUNK the entry only reaches through `import()`, outside
// dist/cli and dist/mcp.

import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..", "..");
const SQLITE = ["bun", "sqlite"].join(":");

const SHARED_EXTERNALS = ["openai", "@aws-sdk/client-s3"];

async function bundle(
  entry: string,
  options: { external: string[]; splitting: boolean },
): Promise<Bun.BuildOutput> {
  // Retried, because a bundle reads hundreds of files off a working tree that
  // a sibling build may be rewriting at the same moment ("Unexpected reading
  // file: …/apps/contracts/dist/client/transport.js", observed on a station
  // running several package builds at once). That is a filesystem race, not a
  // module graph, and the property under test is the module graph — a
  // transient read must not read as "the CLI imports sqlite".
  let lastErrors: string[] = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const built = await Bun.build({
      entrypoints: [join(repoRoot, entry)],
      target: "bun",
      root: join(repoRoot, "src"),
      splitting: options.splitting,
      naming: { chunk: "chunks/[name]-[hash].[ext]" },
      external: [...SHARED_EXTERNALS, ...options.external],
      throw: false,
    });
    const errors = built.logs.filter((log) => log.level === "error");
    if (built.success && errors.length === 0) return built;
    lastErrors = errors.map(String);
  }
  throw new Error(`bundling ${entry} failed after 3 attempts: ${lastErrors.join(" | ")}`);
}

async function entryText(built: Bun.BuildOutput): Promise<string> {
  const entries = built.outputs.filter((output) => output.kind === "entry-point");
  expect(entries.length).toBe(1);
  return entries[0]!.text();
}

describe("no local database engine in the hosted bundles", () => {
  // `build:cli` — bin `recordings`.
  test("the CLI entry bundle never imports the sqlite driver", async () => {
    const built = await bundle("src/cli/index.ts", {
      external: ["commander", "chalk"],
      splitting: true,
    });
    expect(await entryText(built)).not.toContain(SQLITE);
  });

  // `build:mcp` — bin `recordings-mcp`.
  test("the MCP entry bundle never imports the sqlite driver", async () => {
    const built = await bundle("src/mcp/index.ts", {
      external: ["@modelcontextprotocol/sdk"],
      splitting: true,
    });
    expect(await entryText(built)).not.toContain(SQLITE);
  });

  // `build:lib` — the `./sdk` export subpath, which must stay self-contained.
  test("the SDK bundle never imports the sqlite driver", async () => {
    const built = await bundle("src/sdk/index.ts", { external: [], splitting: false });
    expect(await entryText(built)).not.toContain(SQLITE);
  });

  // The engine is deferred, not deleted: the opt-in local store still works,
  // and its code lands in a chunk the entry reaches only through `import()`.
  test("the local store is still shipped, as a chunk outside the entry", async () => {
    const built = await bundle("src/cli/index.ts", {
      external: ["commander", "chalk"],
      splitting: true,
    });
    const carriers: string[] = [];
    for (const output of built.outputs) {
      if ((await output.text()).includes(SQLITE)) carriers.push(output.path);
    }
    expect(carriers.length).toBe(1);
    expect(carriers[0]).toContain("chunks/sqlite-store");
    expect(await entryText(built)).toContain("chunks/sqlite-store");
  });
});
