import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import {
  formatArtifactScanReport,
  resolveAssetInventoryWaivers,
  scanPublishedArtifact,
} from "@hasna/contracts/artifact-scan";

function run(command: string[], cwd: string): string {
  const result = Bun.spawnSync(command, { cwd, stdout: "pipe", stderr: "pipe" });
  const stdout = new TextDecoder().decode(result.stdout).trim();
  if (result.exitCode !== 0) {
    const stderr = new TextDecoder().decode(result.stderr).trim();
    throw new Error(`${command.join(" ")} exited ${result.exitCode}\n${stdout}\n${stderr}`);
  }
  return stdout;
}

const repoRoot = join(import.meta.dir, "..");
const workspace = mkdtempSync(join(tmpdir(), "actions-artifact-scan-"));

try {
  const packed = run(["bun", "pm", "pack", "--destination", workspace, "--ignore-scripts", "--quiet"], repoRoot);
  const archive = isAbsolute(packed) ? packed : join(workspace, packed);
  const waivers = resolveAssetInventoryWaivers(join(repoRoot, "hasna.contract.json"));
  for (const note of waivers.notes) console.log(`waiver: ${note}`);
  const report = scanPublishedArtifact(archive, { waivedKinds: waivers.kinds });
  console.log(formatArtifactScanReport(report));
  if (!report.ok) process.exit(1);
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
