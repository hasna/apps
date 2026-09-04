#!/usr/bin/env bun
/**
 * Pack this repo the way `npm publish` would, then scan what actually shipped.
 *
 * Scans the TARBALL, never `src/` — a source-directory scan reports on files
 * that may never be published and misses built output that is. Wired into
 * `prepack` (metadata.release.artifactScan in hasna.contract.json).
 *
 * Packing uses `--ignore-scripts`: without it, packing from inside `prepack`
 * re-enters `prepack` forever. The scanner is the `contracts` binary from the
 * pinned dependency, not `bunx` — an unpinned package runner resolves to
 * whatever is newest at publish time, and a resolution failure silently
 * becomes a non-run. It is resolved through the installed package's own
 * declared bin (not node_modules/.bin): bun creates no .bin shim for
 * workspace-linked members, so the shim path dies with ENOENT in a fresh
 * checkout.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { npmPackCommand, packedFilename } from './pack-output.mjs';

function resolveContractsCli() {
  const packageJsonPath = fileURLToPath(import.meta.resolve('@hasna/contracts/package.json'));
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  const bin = typeof packageJson.bin === 'string' ? packageJson.bin : packageJson.bin?.contracts;
  if (typeof bin !== 'string' || bin.length === 0) {
    throw new Error('@hasna/contracts does not declare the contracts CLI');
  }
  return resolve(dirname(packageJsonPath), bin);
}

function run(command, cwd) {
  const result = Bun.spawnSync(command, { cwd, stdout: 'pipe', stderr: 'pipe' });
  const stdout = new TextDecoder().decode(result.stdout).trim();
  if (result.exitCode !== 0) {
    const stderr = new TextDecoder().decode(result.stderr).trim();
    throw new Error(`${command.join(' ')} exited ${result.exitCode}\n${stdout}\n${stderr}`);
  }
  return stdout;
}

const repoRoot = join(import.meta.dir, '..');
const workspace = mkdtempSync(join(tmpdir(), 'notes-artifact-scan-'));

try {
  const filename = packedFilename(run(npmPackCommand(workspace), repoRoot));
  const archive = join(workspace, filename);

  const scanner = resolveContractsCli();
  const result = Bun.spawnSync([scanner, 'artifact-scan', archive], {
    cwd: repoRoot,
    stdout: 'inherit',
    stderr: 'inherit',
  });
  if (result.exitCode !== 0) {
    console.error(
      '\nA published artifact must not carry a bulk asset inventory. See @hasna/contracts CONTRACT.md clause B.',
    );
    process.exit(result.exitCode ?? 1);
  }
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
