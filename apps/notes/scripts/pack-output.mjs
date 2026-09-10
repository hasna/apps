import { isAbsolute, join } from 'node:path';
import { writeFileSync } from 'node:fs';

export function npmPackCommand(destination) {
  // An outer `npm pack --dry-run` exposes npm_config_dry_run to prepack.
  // This inner pack must still materialize the exact archive for the scanner.
  return ['npm', 'pack', '--json', '--pack-destination', destination, '--ignore-scripts', '--dry-run=false'];
}

export function packedFilename(output) {
  const packed = JSON.parse(output);
  if (!Array.isArray(packed) || packed.length !== 1 || typeof packed[0]?.filename !== 'string') {
    throw new Error('npm pack did not return exactly one artifact filename');
  }
  const filename = packed[0].filename;
  if (!filename.endsWith('.tgz') || isAbsolute(filename) || /[\\/]/.test(filename)) {
    throw new Error('npm pack returned a non-local artifact filename');
  }
  return filename;
}

// stdout is the machine protocol. A successful npm command may independently
// print update notices to stderr; retain them without appending them to JSON.
export function runSdkPackageCommand(command, { cwd, env, log, expected = 0, evidenceDir }) {
  const result = Bun.spawnSync(command, { cwd, env, stdout: 'pipe', stderr: 'pipe', timeout: 180_000 });
  const stdout = new TextDecoder().decode(result.stdout);
  const stderr = new TextDecoder().decode(result.stderr);
  writeFileSync(join(evidenceDir, log), stdout);
  writeFileSync(join(evidenceDir, `${log}.stderr.log`), stderr);
  if (result.exitCode !== expected) throw new Error(`${log}: expected exit ${expected}, got ${result.exitCode}; see ${evidenceDir}`);
  return stdout;
}
