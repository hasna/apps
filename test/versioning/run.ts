import { join } from "node:path";

const args = process.argv.slice(2);
const unknown = args.filter((arg) => arg !== "--strict");
if (unknown.length > 0) {
  console.error(`Unknown versioning test option: ${unknown.join(", ")}`);
  process.exit(2);
}

const env = { ...process.env };
if (args.includes("--strict")) env.VERSIONING_STRICT = "1";

const result = Bun.spawnSync({
  cmd: [Bun.argv[0]!, "test", join(import.meta.dir, "versioning.test.ts")],
  env,
  stdout: "inherit",
  stderr: "inherit",
});
process.exit(result.exitCode);
