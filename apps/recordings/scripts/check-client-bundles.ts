#!/usr/bin/env bun
/**
 * Post-build client-bundle ratchet.
 *
 * The package deliberately still ships an opt-in local SQLite implementation,
 * but none of its published client entry points may inline or statically import
 * that engine. Bun must preserve the dynamic boundary by emitting SQLite only
 * into split chunks. `recordings-serve` is a backend owner and is intentionally
 * outside this client-entry check.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const sqliteSpecifier = ["bun", "sqlite"].join(":");
const clientEntries = [
  "dist/cli/index.js",
  "dist/mcp/index.js",
  "dist/index.js",
  "dist/storage.js",
  "dist/sdk/index.js",
] as const;

function fail(message: string): never {
  throw new Error(`client bundle ratchet: ${message}`);
}

function javascriptFiles(root: string, output: string[] = []): string[] {
  if (!existsSync(root)) return output;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) javascriptFiles(path, output);
    else if (entry.isFile() && entry.name.endsWith(".js")) output.push(path);
  }
  return output;
}

for (const entry of clientEntries) {
  const path = join(packageRoot, entry);
  if (!existsSync(path)) fail(`missing published client entry ${entry}`);
  if (readFileSync(path, "utf8").includes(sqliteSpecifier)) {
    fail(`${entry} contains ${sqliteSpecifier}; build this entry with splitting enabled`);
  }
}

const chunkRoot = join(packageRoot, "dist", "chunks");
const carriers = javascriptFiles(chunkRoot)
  .filter((path) => readFileSync(path, "utf8").includes(sqliteSpecifier))
  .map((path) => relative(packageRoot, path))
  .sort();
if (carriers.length === 0) {
  fail("no split chunk contains the local SQLite implementation; the positive counter-control disappeared");
}
if (carriers.some((path) => !path.startsWith("dist/chunks/sqlite-store-"))) {
  fail(`SQLite escaped its named local chunks: ${carriers.join(", ")}`);
}

console.log(
  `client bundle ratchet: ${clientEntries.length} published entries are SQLite-free; ` +
    `${carriers.length} local SQLite chunk(s) retained`,
);
