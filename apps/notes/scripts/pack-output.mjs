import { isAbsolute } from 'node:path';

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
