import { chmodSync, closeSync, constants, fstatSync, mkdtempSync, openSync, readSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

export const MAX_CAPTURE_BYTES = 256 * 1024 * 1024;
export const MAX_CAPTURE_REQUEST_BYTES = 64 * 1024;
export type CaptureResult = { status: number; stdout: Buffer; stderr: Buffer };
const incomplete = (): CaptureResult => ({ status: 1, stdout: Buffer.alloc(0), stderr: Buffer.from('release command capture incomplete\n') });

function privateFile(path: string, limit: number): Buffer {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o600 || stat.size > limit) throw new Error('invalid capture');
    const data = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < data.length) {
      const count = readSync(fd, data, offset, data.length - offset, null);
      if (count === 0) throw new Error('invalid capture');
      offset += count;
    }
    if (readSync(fd, Buffer.alloc(1), 0, 1, null) !== 0 || fstatSync(fd).size !== stat.size) throw new Error('invalid capture');
    return data;
  } finally { closeSync(fd); }
}

/** Single execution. The synchronous supervisor never captures a pipe: the
 * worker acknowledges only after async EOF on both streams and child exit.
 * This defends against observed, not yet reproduced, sync capture truncation.
 */
export function captureCommand(command: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv; maxBytes?: number } = {}): CaptureResult {
  const maxBytes = options.maxBytes ?? MAX_CAPTURE_BYTES;
  let directory: string | undefined;
  let result = incomplete();
  try {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_CAPTURE_BYTES) return result;
    const input = Buffer.from(JSON.stringify({ command, args, cwd: options.cwd ?? process.cwd(), maxBytes }));
    if (input.length > MAX_CAPTURE_REQUEST_BYTES) return result;
    directory = mkdtempSync(join(tmpdir(), 'todos-release-command-'));
    chmodSync(directory, 0o700);
    // Environment is inherited in memory, never serialized to a request file.
    const worker = spawnSync(process.execPath, ['--no-env-file', join(import.meta.dir, 'release-command-capture-worker.ts'), directory], {
      env: options.env ?? process.env, input, stdio: ['pipe', 'ignore', 'ignore'],
    });
    if (worker.error || worker.status !== 0) return result;
    const receipt = JSON.parse(privateFile(join(directory, 'receipt.json'), 4096).toString('utf8'));
    if (!receipt || receipt.version !== 1 || !Number.isInteger(receipt.status) || receipt.status < 0 || receipt.status > 255 || typeof receipt.complete !== 'boolean') return result;
    const stdout = privateFile(join(directory, 'stdout'), maxBytes);
    const stderr = privateFile(join(directory, 'stderr'), maxBytes);
    for (const [name, bytes] of [['stdout', stdout], ['stderr', stderr]] as const) {
      const proof = receipt[name];
      if (!proof || proof.bytes !== bytes.length || proof.sha256 !== createHash('sha256').update(bytes).digest('hex')) return result;
    }
    result = { status: receipt.complete ? receipt.status : (receipt.status || 1), stdout,
      stderr: receipt.complete ? stderr : Buffer.concat([stderr.subarray(0, Math.max(0, maxBytes - 36)), Buffer.from('\nrelease command capture incomplete\n')]).subarray(0, maxBytes) };
  } catch { result = incomplete(); }
  finally {
    if (directory) {
      try { rmSync(directory, { recursive: true, force: true }); }
      catch { result = incomplete(); }
    }
  }
  return result;
}
