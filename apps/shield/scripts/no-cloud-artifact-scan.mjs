#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const forbidden = [
  ["@hasna", "cloud"].join("/"),
  ["open", "cloud"].join("-"),
  ["cloud", "mcp"].join("-"),
  "register" + "Cloud",
  "Sqlite" + "Adapter",
  "Pg" + "Adapter",
  [".hasna", "cloud"].join("/"),
  "HASNA_" + "CLOUD_",
  "HASNA_" + "RDS",
  ["cloud", "sync"].join(" "),
];

const pack = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
  cwd: process.cwd(),
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});

if (pack.status !== 0) {
  process.stderr.write(pack.stderr || pack.stdout);
  process.exit(pack.status ?? 1);
}

const packages = JSON.parse(pack.stdout);
const files = packages.flatMap((pkg) => pkg.files.map((file) => file.path));
const hits = [];

for (const file of files) {
  const text = readFileSync(file, "utf8");
  for (const needle of forbidden) {
    if (text.includes(needle)) hits.push(`${file} contains ${needle}`);
  }
}

if (hits.length > 0) {
  process.stderr.write(`Retired shared-cloud markers found in packed artifact:\n${hits.join("\n")}\n`);
  process.exit(1);
}

process.stdout.write(`Packed artifact no-cloud scan passed (${files.length} files).\n`);
