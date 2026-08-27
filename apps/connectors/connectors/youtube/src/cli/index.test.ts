import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

/**
 * Regression test for finding code-connectors-1 (P1):
 * `download --list-formats` interpolated the user-controlled `videoId` positional
 * argument into a shell string run with `execSync`, so a videoId like
 * `x"; touch <marker>; #` executed arbitrary shell (reachable through the `download`
 * CLI command exposed by the connector).
 */
describe('connect-youtube download --list-formats', () => {
  let tmp: string;
  let binDir: string;
  let argvLog: string;
  let marker: string;

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'ytdlp-'));
    binDir = join(tmp, 'bin');
    argvLog = join(tmp, 'argv.log');
    marker = join(tmp, 'shell-injected');
    mkdirSync(binDir, { recursive: true });

    // Stub yt-dlp: records its argv, exits 0 (so `which yt-dlp` passes).
    const stub = join(binDir, 'yt-dlp');
    writeFileSync(stub, '#!/bin/sh\necho "$@" > "$YTDLP_ARGV_LOG"\nexit 0\n', { mode: 0o755 });
    chmodSync(stub, 0o755);
  });

  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('does not execute shell commands from videoId; URL is one argv item', () => {
    const payload = `x"; touch ${marker}; #`;
    const cliPath = join(import.meta.dir, 'index.ts');

    const res = spawnSync(
      process.execPath,
      [cliPath, 'videos', 'download', payload, '--list-formats'],
      {
        cwd: join(import.meta.dir, '..', '..'),
        env: {
          ...process.env,
          PATH: `${binDir}:${process.env.PATH ?? ''}`,
          YTDLP_ARGV_LOG: argvLog,
        },
        encoding: 'utf-8',
      },
    );

    // Command must succeed for the list-formats path (stub exits 0).
    expect(res.status).toBe(0);

    // The injected `touch` must never run.
    expect(existsSync(marker)).toBe(false);

    // yt-dlp must receive the URL as a single unparsed argument.
    const expected = ['-F', `https://www.youtube.com/watch?v=${payload}`].join(' ') + '\n';
    expect(readFileSync(argvLog, 'utf-8')).toBe(expected);
  });
});
