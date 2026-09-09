import { closeSync, openSync, writeSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { MAX_CAPTURE_BYTES, MAX_CAPTURE_REQUEST_BYTES } from './release-command-capture';

export async function drainCapture(reader: ReadableStreamDefaultReader<Uint8Array>, fd: number, limit: number, abort: () => void): Promise<{ bytes: number; sha256: string; complete: boolean }> {
  let bytes = 0;
  const hash = createHash('sha256');
  let complete = false;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) { complete = true; break; }
      const accepted = chunk.value.subarray(0, Math.max(0, limit - bytes));
      let offset = 0;
      while (offset < accepted.length) {
        const written = writeSync(fd, accepted, offset, accepted.length - offset);
        if (written <= 0) throw new Error('capture write failed');
        offset += written;
      }
      hash.update(accepted); bytes += accepted.length;
      if (accepted.length !== chunk.value.length) throw new Error('capture limit');
    }
  } catch { abort(); }
  finally { reader.releaseLock(); }
  return { bytes, sha256: hash.digest('hex'), complete };
}

async function main(): Promise<void> {
  const chunks: Uint8Array[] = [];
  let length = 0;
  for await (const chunk of Bun.stdin.stream()) {
    length += chunk.length;
    if (length > MAX_CAPTURE_REQUEST_BYTES) throw new Error('request limit');
    chunks.push(chunk);
  }
  const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (typeof input.command !== 'string' || !input.command || !Array.isArray(input.args) || input.args.some((arg: unknown) => typeof arg !== 'string') || typeof input.cwd !== 'string' || !Number.isSafeInteger(input.maxBytes) || input.maxBytes < 1 || input.maxBytes > MAX_CAPTURE_BYTES) throw new Error('invalid request');
  const directory = process.argv[2];
  if (!directory) throw new Error('missing capture directory');
  const stdoutFd = openSync(join(directory, 'stdout'), 'wx', 0o600);
  let stdoutClosed = false;
  let stderrFd: number | undefined;
  try {
    stderrFd = openSync(join(directory, 'stderr'), 'wx', 0o600);
    const child = Bun.spawn([input.command, ...input.args], { cwd: input.cwd, env: process.env, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
    const outReader = child.stdout.getReader();
    const errReader = child.stderr.getReader();
    let aborted = false;
    const abort = () => {
      if (aborted) return;
      aborted = true;
      try { child.kill('SIGKILL'); } catch { /* child may already have exited */ }
      void outReader.cancel().catch(() => {});
      void errReader.cancel().catch(() => {});
    };
    const [stdout, stderr, status] = await Promise.all([
      drainCapture(outReader, stdoutFd, input.maxBytes, abort),
      drainCapture(errReader, stderrFd, input.maxBytes, abort), child.exited,
    ]);
    closeSync(stdoutFd); stdoutClosed = true;
    closeSync(stderrFd); stderrFd = undefined;
    writeFileSync(join(directory, 'receipt.json'), JSON.stringify({ version: 1, status: Number.isInteger(status) && status >= 0 && status <= 255 ? status : 1, complete: !aborted && stdout.complete && stderr.complete, stdout, stderr }), { flag: 'wx', mode: 0o600 });
  } finally {
    // stdout may already have closed; this scope owns both descriptors only.
    if (!stdoutClosed) closeSync(stdoutFd);
    if (stderrFd !== undefined) closeSync(stderrFd);
  }
}

if (import.meta.main) main().catch(() => { process.exitCode = 1; });
