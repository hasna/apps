import { expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";

const root = join(import.meta.dir, "../..");

test("installed Contracts exact pins resolve to the declared version, not an incompatible workspace", () => {
  let checked = 0;
  for (const member of readdirSync(join(root, "apps"))) {
    const manifestPath = join(root, "apps", member, "package.json");
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const pin = manifest.dependencies?.["@hasna/contracts"] ?? manifest.devDependencies?.["@hasna/contracts"];
    if (typeof pin !== "string" || !/^\d+\.\d+\.\d+$/.test(pin)) continue;
    let directory = dirname(manifestPath);
    for (;;) {
      const candidate = join(directory, "node_modules/@hasna/contracts/package.json");
      if (existsSync(candidate)) {
        const installed = JSON.parse(readFileSync(candidate, "utf8"));
        if (installed.name === "@hasna/contracts") {
          expect(installed.version, `${manifest.name} declares Contracts ${pin}`).toBe(pin);
          break;
        }
      }
      const parent = dirname(directory);
      if (parent === directory) throw new Error(`No Contracts manifest for ${manifest.name}`);
      directory = parent;
    }
    checked++;
  }
  expect(checked).toBeGreaterThan(0);
});
