// Vendor the @hasna/contracts storage-kit into src/generated/storage-kit/.
//
// @hasna/contracts is PINNED to EXACTLY 0.4.1 (registry devDependency "0.4.1",
// no caret), so this invokes the generator CLI from that exact installed
// version — never @latest. This stamps the canonical templates +
// .storage-kit-manifest.json (sha256 per file) and writes kitVersion 0.4.1 into
// hasna.contract.json — identical output to `bunx @hasna/contracts@0.4.1 vendor-kit .`.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const PINNED_CONTRACTS_VERSION = "0.4.1";
// The package `exports` map only exposes "." (import-only), so the CLI subpath
// is not resolvable via require.resolve — load it by direct path from the
// installed package root, same as scripts/conformance.ts.
const pkgRoot = join(process.cwd(), "node_modules", "@hasna", "contracts");
const cli = join(pkgRoot, "dist", "cli", "index.js");
// Guard: refuse to vendor from anything other than the pinned version.
const pkgPath = join(pkgRoot, "package.json");
const found = JSON.parse(readFileSync(pkgPath, "utf8")).version as string;
if (found !== PINNED_CONTRACTS_VERSION) {
  console.error(`vendor-kit: expected @hasna/contracts@${PINNED_CONTRACTS_VERSION}, found ${found}`);
  process.exit(1);
}
const result = spawnSync("bun", ["run", cli, "vendor-kit", process.cwd(), ...process.argv.slice(2)], {
  stdio: "inherit",
});
process.exit(result.status ?? 1);
