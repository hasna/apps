import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const entries: Record<string, string> = {
  "dist/index.js": "src/index.ts",
  "dist/sdk.js": "src/sdk.ts",
  "dist/contracts.js": "src/contracts.ts",
  "dist/providers.js": "src/providers.ts",
  "dist/local-public.js": "src/local-public.ts",
  "dist/storage.js": "src/storage.ts",
  "dist/bin/computers.js": "src/bin/computers.ts",
  "dist/bin/computers-serve.js": "src/bin/computers-serve.ts",
  "dist/bin/computers-mcp.js": "src/bin/computers-mcp.ts",
  "dist/bin/computers-worker.js": "src/bin/computers-worker.ts",
  "dist/bin/computers-resident.js": "src/bin/computers-resident.ts",
  "dist/bin/computers-migrate.js": "src/bin/computers-migrate.ts",
};

for (const [output, entry] of Object.entries(entries)) {
  mkdirSync(dirname(output), { recursive: true });
  const process = Bun.spawn(["bun", "build", entry, "--outfile", output, "--target", "bun", "--format", "esm"], { stdout: "inherit", stderr: "inherit" });
  const code = await process.exited;
  if (code !== 0) throw new Error(`Build failed for ${entry}`);
  if (output.includes("/bin/")) chmodSync(output, 0o755);
}
