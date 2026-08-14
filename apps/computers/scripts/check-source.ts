import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const roots = ["src", "scripts", "tests"];
const errors: string[] = [];

function walk(path: string): void {
  for (const name of readdirSync(path)) {
    const file = join(path, name);
    if (statSync(file).isDirectory()) walk(file);
    else if (/\.(?:ts|json|md|sql)$/.test(file)) {
      const text = readFileSync(file, "utf8");
      if (text.includes("\r")) errors.push(`${file}: contains CR characters`);
      text.split("\n").forEach((line, index) => {
        if (/[ \t]+$/.test(line)) errors.push(`${file}:${index + 1}: trailing whitespace`);
        if (line.includes("\t")) errors.push(`${file}:${index + 1}: tab character`);
      });
    }
  }
}

for (const root of roots) walk(root);
if (errors.length > 0) { process.stderr.write(`${errors.join("\n")}\n`); process.exit(1); }
process.stdout.write("source checks passed\n");
