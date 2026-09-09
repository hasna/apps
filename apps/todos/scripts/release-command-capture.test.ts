import { describe, expect, test, spyOn } from 'bun:test';
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as childProcess from 'node:child_process';
import { captureCommand } from './release-command-capture';
import { drainCapture } from './release-command-capture-worker';

describe('release command capture completion', () => {
  test('waits for delayed EOF after the command exits, preserving binary streams', () => {
    const result = captureCommand('python3', ['-c', `import os,time
if os.fork()==0:
 time.sleep(0.15);os.write(1,b'late\\x00stdout');os.write(2,b'late\\x00stderr');os._exit(0)
os._exit(0)`]);
    expect(result.status).toBe(0);
    expect(result.stdout).toEqual(Buffer.from('late\0stdout'));
    expect(result.stderr).toEqual(Buffer.from('late\0stderr'));
  });
  test('preserves nonzero status and simultaneous large binary stdout/stderr', () => {
    const result = captureCommand('python3', ['-c', `import os,threading
def emit(fd):
 for i in range(32):
  data=bytes(range(256))*256
  while data:
   n=os.write(fd,data);data=data[n:]
a=threading.Thread(target=emit,args=(1,));b=threading.Thread(target=emit,args=(2,));a.start();b.start();a.join();b.join();os._exit(23)`]);
    expect(result.status).toBe(23);
    const expected = Buffer.alloc(2097152);
    for (let i = 0; i < expected.length; i++) expected[i] = i % 256;
    expect(result.stdout.equals(expected)).toBe(true);
    expect(result.stderr.equals(expected)).toBe(true);
  });
  test('overflow fails instead of accepting truncated success', () => {
    const result = captureCommand('python3', ['-c', "import os;os.write(1,b'x'*8192)"], { maxBytes: 4096 });
    expect(result.status).not.toBe(0);
    expect(result.stdout.length).toBeLessThanOrEqual(4096);
    expect(result.stderr.toString()).toContain('capture incomplete');
  });
  test('worker death fails without accepting missing completion receipt', () => {
    const result = captureCommand('python3', ['-c', 'import os,signal;os.kill(os.getppid(),signal.SIGKILL)']);
    expect(result.status).not.toBe(0);
    expect(result.stderr.toString()).toContain('capture incomplete');
  });
  test('executes a side-effecting command once, inheriting only the requested environment', () => {
    const dir = mkdtempSync(join(tmpdir(), 'todos-capture-once-'));
    try {
      const marker = join(dir, 'count');
      const result = captureCommand('python3', ['-c', "import os,sys;open(sys.argv[1],'a').write('once\\n');os.write(2,os.environ['CAPTURE_FIXTURE'].encode());sys.exit(17)", marker], { env: { PATH: process.env.PATH, CAPTURE_FIXTURE: 'fixture-only' } });
      expect(result.status).toBe(17);
      expect(result.stderr.toString()).toBe('fixture-only');
      expect(readFileSync(marker, 'utf8')).toBe('once\n');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  test('stream errors abort and cannot produce a complete receipt', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'todos-capture-stream-'));
    const fd = openSync(join(dir, 'output'), 'wx', 0o600);
    let aborts = 0;
    try {
      const stream = new ReadableStream<Uint8Array>({ pull(controller) { controller.error(new Error('synthetic stream failure')); } });
      const result = await drainCapture(stream.getReader(), fd, 4096, () => { aborts++; });
      expect(result.complete).toBe(false);
      expect(aborts).toBe(1);
    } finally { closeSync(fd); rmSync(dir, { recursive: true, force: true }); }
  });
  test('rejects missing, oversized and forged completion files; removes only its private directory', () => {
    for (const kind of ['missing', 'oversized', 'oversized-capture', 'forged']) {
      let directory = '';
      const spy = spyOn(childProcess, 'spawnSync').mockImplementation((_command: any, args?: any, options?: any) => {
        directory = args[2];
        expect(statSync(directory).mode & 0o777).toBe(0o700);
        expect(options.stdio).toEqual(['pipe', 'ignore', 'ignore']);
        const request = JSON.parse(options.input.toString());
        expect(request.env).toBeUndefined();
        if (kind === 'oversized') writeFileSync(join(directory, 'receipt.json'), 'x'.repeat(4097), { mode: 0o600 });
        if (kind === 'forged' || kind === 'oversized-capture') {
          writeFileSync(join(directory, 'receipt.json'), JSON.stringify({ version: 1, status: 0, complete: true, stdout: { bytes: 0, sha256: 'wrong' }, stderr: { bytes: 0, sha256: 'wrong' } }), { mode: 0o600 });
          writeFileSync(join(directory, 'stdout'), kind === 'oversized-capture' ? 'x'.repeat(4097) : '', { mode: 0o600 });
          writeFileSync(join(directory, 'stderr'), '', { mode: 0o600 });
        }
        return { status: 0 } as any;
      });
      try { expect(captureCommand('unused', [], { maxBytes: 4096 }).status).not.toBe(0); }
      finally { spy.mockRestore(); }
      expect(existsSync(directory)).toBe(false);
    }
  });
  test('rejects oversized requests before invocation and limits stderr independently', () => {
    const spy = spyOn(childProcess, 'spawnSync');
    try {
      expect(captureCommand('unused', ['x'.repeat(65536)]).status).not.toBe(0);
      expect(spy).not.toHaveBeenCalled();
    } finally { spy.mockRestore(); }
    const result = captureCommand('python3', ['-c', "import os;os.write(1,b'ok');os.write(2,b'x'*8192)"], { maxBytes: 4096 });
    expect(result.status).not.toBe(0);
    expect(result.stdout.toString()).toBe('ok');
    expect(result.stderr.length).toBeLessThanOrEqual(4096);
  });
});
