#!/usr/bin/env bun
/**
 * Ensures all bin/*.js files have the bun shebang and are executable.
 * Run after `bun build` since --outfile mode doesn't add shebangs.
 */
import { readFileSync, writeFileSync, chmodSync, readdirSync } from "fs";
import { join } from "path";

const SHEBANG = "#!/usr/bin/env bun\n";
const binDir = join(import.meta.dir, "..", "bin");

for (const file of readdirSync(binDir)) {
  if (!file.endsWith(".js")) continue;
  const path = join(binDir, file);
  const content = readFileSync(path, "utf8");
  if (!content.startsWith("#!")) {
    writeFileSync(path, SHEBANG + content);
    console.log(`Added shebang to ${file}`);
  } else {
    console.log(`${file} already has shebang`);
  }
  chmodSync(path, 0o755);
}
