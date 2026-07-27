import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  assertRemoteTempDir,
  createRemoteTempDir,
  removeRemoteTempDir,
} from '../scripts/lib/remote-temp-dir.mjs';

const repoRoot = resolve(import.meta.dir, '..');
const script = join(repoRoot, 'scripts', 'smoke-machine-sync-release.mjs');
const openFilesBoundaryScript = join(repoRoot, 'scripts', 'smoke-open-files-installed-boundary.mjs');

/**
 * `node` as well as `process.execPath`.
 *
 * Under `bun test` `process.execPath` is always bun, so a suite that only ever spawns it has no
 * way to observe node-only behaviour - which is how a node-only silent no-op shipped past a
 * four-leg `runtime: [bun, node]` matrix whose only test step is `bun test`. `node` is already a
 * hard requirement of this suite (tests/package-release.test.ts spawns it directly).
 */
const runtimes = [...new Set(['node', process.execPath])];

/**
 * Symlinks and `#!/bin/sh` PATH stubs are POSIX mechanisms; the defects they pin (pnpm-style
 * symlinked installs, macOS `/tmp -> /private/tmp`) are POSIX defects. Windows is in the
 * `test-matrix` job, so these skip there rather than failing for an unrelated reason.
 */
const posixOnly = test.skipIf(process.platform === 'win32');

describe('machine sync release smoke script', () => {
  test('prints help without requiring ssh or installed packages', () => {
    const result = spawnSync(process.execPath, [script, '--help'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('smoke-machine-sync-release.mjs');
    expect(result.stdout).toContain('sync doctor');
    expect(result.stdout).toContain('@hasna/machines hidden locally');
    expect(result.stdout).toContain('--peer-workspace omitted');
  });

  test('renders dry-run release evidence plan as JSON', () => {
    const result = spawnSync(process.execPath, [
      script,
      '--dry-run',
      '--json',
      '--remote',
      'linux-node-a',
      '--peer',
      'linux-node-a',
      '--knowledge-version',
      '0.0.0-test',
      '--machines-version',
      '0.0.0-machines',
    ], {
      cwd: repoRoot,
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    const output = JSON.parse(result.stdout);
    expect(output).toMatchObject({
      ok: true,
      dry_run: true,
      remote: 'linux-node-a',
      peer: 'linux-node-a',
      knowledge_version: '0.0.0-test',
      machines_version: '0.0.0-machines',
      no_machines_sync: true,
      no_machines_registry_sync: true,
    });
    expect(output.checks).toContain('run knowledge machines adapter smoke locally and remotely');
    expect(output.checks).toContain('assert artifact manifest modified_at/provenance/raw-source boundary');
    expect(output.checks).toContain('assert final bidirectional dry-run has zero conflicts');
    expect(output.checks).toContain('run isolated installed-package sync with @hasna/machines and machines CLI hidden');
    expect(output.checks).toContain('learn registry fallback then run isolated hidden-machines sync with --peer-workspace omitted');
  });

  /**
   * Regression for a silent no-op this script's own direct-invocation guard introduced.
   *
   * The guard compared `resolve(process.argv[1])` with `fileURLToPath(import.meta.url)`. Node
   * resolves the main module through symlinks before deriving `import.meta.url` while
   * `resolve()` is purely lexical, so through ANY symlinked path the two never matched: `main()`
   * never ran, nothing was printed, and the process exited 0. A caller checking only the exit
   * status - which is what a release gate does - recorded a green smoke that had done nothing.
   *
   * Measured at the broken commit against the packed tarball, and reproduced here:
   *   node node_modules/@hasna/knowledge/scripts/smoke-machine-sync-release.mjs --dry-run --json
   *     -> empty stdout, exit 0
   *   node <symlink>/scripts/smoke-machine-sync-release.mjs --totally-bogus
   *     -> exit 0, instead of raising "Unknown argument"
   *
   * Both real-world shapes are covered: a symlinked checkout, and the pnpm-style
   * `node_modules/@hasna/knowledge -> <store>/package` layout a real install produces. macOS is
   * the same shape via `/tmp -> /private/tmp`, which is where the PR's own documented
   * `npm pack && tar xzf && node scripts/...` evidence procedure would have silently "passed".
   *
   * Bun keeps the link path on both sides and is unaffected, which is exactly why this must run
   * under `node` and not `process.execPath`.
   */
  posixOnly('runs when invoked through a symlinked path, under every runtime', () => {
    const sandbox = mkdtempSync(join(tmpdir(), 'knowledge-smoke-symlink-'));
    try {
      const plainLink = join(sandbox, 'checkout-link');
      symlinkSync(repoRoot, plainLink, 'dir');
      const installedLink = join(sandbox, 'node_modules', '@hasna', 'knowledge');
      mkdirSync(dirname(installedLink), { recursive: true });
      symlinkSync(repoRoot, installedLink, 'dir');

      for (const runtime of runtimes) {
        // The real path is the control: it passed even while every symlinked path was a no-op,
        // so without it "help printed" would not distinguish the fix from the defect.
        for (const root of [repoRoot, plainLink, installedLink]) {
          const where = `${runtime} via ${root}`;
          const linked = join(root, 'scripts', 'smoke-machine-sync-release.mjs');

          const help = spawnSync(runtime, [linked, '--help'], { cwd: sandbox, encoding: 'utf8' });
          expect(help.status, where).toBe(0);
          expect(help.stdout, where).toContain('smoke-machine-sync-release.mjs');

          // Exit 0 with no output is precisely what the defect produced, so a successful exit
          // proves nothing on its own: an unknown argument must still be a real failure.
          const bogus = spawnSync(runtime, [linked, '--totally-bogus'], { cwd: sandbox, encoding: 'utf8' });
          expect(bogus.status, where).not.toBe(0);
          expect(bogus.stderr, where).toContain('Unknown argument');
        }
      }

      // The reviewer's verbatim reproduction: a pnpm-style install invoked under node.
      const dryRun = spawnSync('node', [
        join(installedLink, 'scripts', 'smoke-machine-sync-release.mjs'),
        '--dry-run',
        '--json',
      ], { cwd: sandbox, encoding: 'utf8' });
      expect(dryRun.status, dryRun.stderr).toBe(0);
      expect(dryRun.stdout).not.toBe('');
      expect(JSON.parse(dryRun.stdout)).toMatchObject({ ok: true, dry_run: true });
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  /**
   * Regression for the defect this PR is named after on the import side: `main()` at module
   * scope meant merely importing the file ran `bun install -g` locally and
   * `ssh <remote> bun install -g` on a fleet host before any argument was inspected. It fired
   * for real during review.
   *
   * Reverting the guard to a bare `main();` left the whole suite green, because nothing loaded
   * the module. This test loads it - in a child process whose PATH puts recorders in front of
   * `bash`, `bun` and `ssh`, so the mutation is caught by an assertion rather than by installing
   * a package on whoever runs the suite.
   *
   * Both argv shapes are covered: `node -e`, where `process.argv[1]` is undefined (the case the
   * `!== undefined` check exists for), and an ordinary importer module, where argv[1] is defined
   * but is a different file.
   */
  posixOnly('importing the script installs nothing and never reaches the remote', () => {
    const sandbox = mkdtempSync(join(tmpdir(), 'knowledge-smoke-import-'));
    try {
      const binDir = join(sandbox, 'bin');
      mkdirSync(binDir, { recursive: true });
      const marker = join(sandbox, 'side-effects.log');
      // `bash` is stubbed alongside `bun` and `ssh` because the script shells out via
      // `bash -lc`, and a real login shell would put the real bun back on PATH ahead of a stub.
      for (const name of ['bash', 'bun', 'ssh']) {
        const shim = join(binDir, name);
        writeFileSync(shim, `#!/bin/sh\necho "$0 $*" >> ${JSON.stringify(marker)}\nexit 0\n`);
        chmodSync(shim, 0o755);
      }
      // Stubs first, real PATH behind it so the runtimes themselves still resolve.
      const env = { ...process.env, PATH: `${binDir}:${process.env.PATH ?? ''}` };
      const scriptUrl = pathToFileURL(script).href;

      // Control. Without it, "no marker" could equally mean the stubs were never reachable and
      // the test would pass against any implementation at all.
      const probe = join(sandbox, 'probe.mjs');
      writeFileSync(probe, [
        "import { spawnSync } from 'node:child_process';",
        "spawnSync('bash', ['-lc', \"bun install -g '@hasna/knowledge@0.0.0-test'\"], { env: process.env });",
        "spawnSync('ssh', ['linux-node-a', \"bun install -g '@hasna/knowledge@0.0.0-test'\"], { env: process.env });",
        '',
      ].join('\n'));
      spawnSync('node', [probe], { cwd: sandbox, encoding: 'utf8', env });
      expect(existsSync(marker), 'the PATH stubs must be reachable or this test proves nothing').toBe(true);
      expect(readFileSync(marker, 'utf8')).toContain('ssh');
      rmSync(marker);

      const evaluated = spawnSync('node', [
        '-e',
        'import(process.env.SMOKE_SCRIPT_URL).catch((error) => { console.error(error); process.exit(1); });',
      ], { cwd: sandbox, encoding: 'utf8', env: { ...env, SMOKE_SCRIPT_URL: scriptUrl } });
      // The marker first: it is the assertion that names the defect. A bare `main();` also
      // exits non-zero here once the stubs break it, but "it installed something" is what the
      // failure should say.
      expect(existsSync(marker), 'node -e import must not install anything').toBe(false);
      expect(evaluated.status, evaluated.stderr).toBe(0);
      expect(evaluated.stdout).toBe('');

      const importer = join(sandbox, 'importer.mjs');
      writeFileSync(importer, 'await import(process.env.SMOKE_SCRIPT_URL);\n');
      for (const runtime of runtimes) {
        const imported = spawnSync(runtime, [importer], {
          cwd: sandbox,
          encoding: 'utf8',
          env: { ...env, SMOKE_SCRIPT_URL: scriptUrl },
        });
        expect(existsSync(marker), `import under ${runtime} must not install anything`).toBe(false);
        expect(imported.status, `${runtime}: ${imported.stderr}`).toBe(0);
        expect(imported.stdout, runtime).toBe('');
      }
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });
});

describe('installed open-files boundary smoke script', () => {
  test('prints help without requiring installed files or knowledge commands', () => {
    const result = spawnSync(process.execPath, [openFilesBoundaryScript, '--help'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('smoke-open-files-installed-boundary.mjs');
    expect(result.stdout).toContain('installed open-files to open-knowledge source-boundary smoke');
    expect(result.stdout).toContain('scan both knowledge SQLite stores and artifacts');
  });

  test('renders dry-run installed open-files boundary evidence plan as JSON', () => {
    const result = spawnSync(process.execPath, [
      openFilesBoundaryScript,
      '--dry-run',
      '--json',
      '--files-bin',
      'files-test',
      '--knowledge-bin',
      'knowledge-test',
    ], {
      cwd: repoRoot,
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    const output = JSON.parse(result.stdout);
    expect(output).toMatchObject({
      ok: true,
      dry_run: true,
      files_bin: 'files-test',
      knowledge_bin: 'knowledge-test',
    });
    expect(output.checks).toContain('run installed files sources/index/manifest/doctor/resolve/extract-text');
    expect(output.checks).toContain('redact raw sentinel before knowledge ingest');
    expect(output.checks).toContain('scan source and peer knowledge SQLite/artifacts for raw sentinel and base64');
  });
});

/**
 * `runSyncSmoke` sends `rm -rf <remoteDir>` over ssh, where remoteDir came from a remote
 * `mktemp -d`. Taking a delete target on faith from a command's output is the same class of
 * defect as the 2026-07-24 incident, where an empty `$(bun pm cache)` turned
 * `rm -rf "$(cmd)"/*` into `rm -rf /*`.
 *
 * Precisely which case is live: `runRemote` goes through `runChecked`, which throws on a
 * non-zero remote exit, so a *failing* `mktemp -d` (exit 1) aborts the run and never assigns
 * an empty string. The reachable hole is the remote exiting **zero** with stdout that is not
 * the path - an ssh `Banner`, a chatty login profile, or a `ForceCommand` wrapper prepending
 * lines or masking the status. Measured verbatim:
 *
 *     $ echo "Welcome to linux-node-a"; mktemp -d /tmp/knowledge-banner-XXXXXX
 *     Welcome to linux-node-a
 *     /tmp/knowledge-banner-jjuN3k
 *
 * exit 0, so `runChecked` passes it through; the guard rejects it as multi-line.
 *
 * Scope, stated exactly rather than implied: these cases exercise `assertRemoteTempDir` ALONE.
 * They prove it rejects bad input rather than merely accepting good input, and nothing more -
 * in particular they do not pin that anything calls it. That is the next describe block's job,
 * and the distinction is not academic: deleting both call sites once left this whole file
 * green. No `rm` runs anywhere here.
 */
describe('remote temp dir guard', () => {
  const remote = 'linux-node-a';
  const template = '/tmp/knowledge-linux-node-a-0.0.0-test-XXXXXX';

  test('accepts what a successful mktemp -d actually returns', () => {
    expect(assertRemoteTempDir(remote, '/tmp/knowledge-linux-node-a-0.0.0-test-Ab3De9', template))
      .toBe('/tmp/knowledge-linux-node-a-0.0.0-test-Ab3De9');
  });

  test('rejects the empty output a failing mktemp -d leaves behind', () => {
    // Defence in depth rather than the live defect: runChecked aborts on a non-zero remote
    // exit, so an empty value cannot reach here via a failing mktemp. It can via a wrapper
    // that exits 0 without printing a path.
    expect(() => assertRemoteTempDir(remote, '', template)).toThrow(/produced no path/);
    expect(() => assertRemoteTempDir(remote, '   '.trim(), template)).toThrow(/produced no path/);
  });

  test('rejects paths that are not a temp dir this template could have created', () => {
    for (const bad of [
      '/',
      '/tmp',
      '/usr',
      '/home/hasna',
      '/tmp/somebody-elses-dir',
      'knowledge-linux-node-a-0.0.0-test-Ab3De9',
      './relative',
      '/tmp/knowledge-linux-node-a-0.0.0-test-Ab3De9/../../etc',
    ]) {
      expect(() => assertRemoteTempDir(remote, bad, template))
        .toThrow(/Refusing to use remote temp dir/);
    }
  });

  test('rejects multi-line output, so only the first line is never silently used', () => {
    expect(() => assertRemoteTempDir(
      remote,
      '/tmp/knowledge-linux-node-a-0.0.0-test-Ab3De9\nmktemp: failed',
      template,
    )).toThrow(/multiple lines/);
  });

  test('the failure names the path and says why it matters', () => {
    expect(() => assertRemoteTempDir(remote, '', template))
      .toThrow(/used as an `rm -rf` target on the remote host/);
  });

  test('rejects a sibling directory that merely shares the temp parent', () => {
    // Checking only the parent directory would accept this, and `rm -rf` would then delete
    // somebody else's directory.
    expect(() => assertRemoteTempDir(remote, '/tmp/somebody-elses-dir', template))
      .toThrow(/does not start with the template prefix/);
  });

  test('rejects a malformed template rather than deriving a bogus bound from it', () => {
    expect(() => assertRemoteTempDir(remote, '/tmp/x', 'relative-XXXXXX'))
      .toThrow(/must be an absolute path/);
    expect(() => assertRemoteTempDir(remote, '/tmp/x', '/tmp/no-placeholder'))
      .toThrow(/must end in at least three X/);
  });

  /**
   * Regression for the review finding that this guard silently degraded into the
   * parent-directory-only check it exists to avoid. With a template like `/tmp/XXXXXX` the
   * derived prefix is a bare directory, so every sibling under it validated:
   * `/tmp/XXXXXX` accepted `/tmp/somebody-elses-dir`, and `/XXXXXX` accepted `/etc`.
   */
  test('refuses a template whose final component is only X, which would accept any sibling', () => {
    for (const badTemplate of ['/tmp/XXXXXX', '/XXXXXX', '/home/hasna/XXXXXXXX']) {
      expect(() => assertRemoteTempDir(remote, '/tmp/anything', badTemplate))
        .toThrow(/must have a fixed prefix in its final component/);
    }
  });

  test('refuses a template containing . or .., which makes the derived bound meaningless', () => {
    // The template is built from a caller-supplied version string.
    expect(() => assertRemoteTempDir(
      remote,
      '/tmp/knowledge-x/../../../home/hasna-AbCdEf',
      '/tmp/knowledge-x/../../../home/hasna-XXXXXX',
    )).toThrow(/must be normalized/);
    expect(() => assertRemoteTempDir(remote, '/tmp/k-AbCdEf', '/tmp/./k-XXXXXX'))
      .toThrow(/must be normalized/);
  });

  test('rejects the bare template prefix, which means mktemp created nothing', () => {
    expect(() => assertRemoteTempDir(remote, '/tmp/knowledge-linux-node-a-0.0.0-test-', template))
      .toThrow(/mktemp created nothing/);
  });

  test('rejects the banner-first shape the docstring calls the live case', () => {
    // Documented as the reachable hole but previously untested: only path-then-junk was
    // covered, never junk-then-path.
    expect(() => assertRemoteTempDir(
      remote,
      'Welcome to linux-node-a\n/tmp/knowledge-linux-node-a-0.0.0-test-Ab3De9',
      template,
    )).toThrow(/multiple lines/);
  });

  test('rejects a suffix mktemp could not have generated', () => {
    const base = '/tmp/knowledge-linux-node-a-0.0.0-test-';
    // mktemp replaces the X run with exactly that many [A-Za-z0-9] characters.
    expect(() => assertRemoteTempDir(remote, `${base}Z`, template)).toThrow(/X run is 6/);
    expect(() => assertRemoteTempDir(remote, `${base}ZZZZZZZZZZ`, template)).toThrow(/X run is 6/);
    expect(() => assertRemoteTempDir(remote, `${base}A B123`, template))
      .toThrow(/characters mktemp never generates/);
    expect(() => assertRemoteTempDir(remote, `${base}$(id)`, template)).toThrow();
    expect(assertRemoteTempDir(remote, `${base}Ab3De9`, template)).toBe(`${base}Ab3De9`);
  });

  test('a suffix containing a separator reports descent, not a charset complaint', () => {
    // The charset rule below would also reject this, but the descent message is the useful
    // one. Asserting the message pins the ordering so the clearer diagnostic cannot be lost.
    expect(() => assertRemoteTempDir(
      remote,
      '/tmp/knowledge-linux-node-a-0.0.0-test-Ab3De9/nested',
      template,
    )).toThrow(/descends below the directory the template would create/);
  });

  test('rejects a lone carriage return, not just a newline', () => {
    // The multi-line check is /[\r\n]/; a fixture using only \n would let it be narrowed to
    // /\n/ unnoticed.
    expect(() => assertRemoteTempDir(
      remote,
      '/tmp/knowledge-linux-node-a-0.0.0-test-Ab3De9\rjunk',
      template,
    )).toThrow(/multiple lines/);
  });

  test('rejects shell metacharacters and separators in the suffix by charset, not by length', () => {
    // Each of these is exactly 6 characters, so only the charset rule can reject them. The
    // earlier fixtures were all the wrong length, leaving the charset check - the
    // shell-metacharacter backstop - pinned by nothing.
    const base = '/tmp/knowledge-linux-node-a-0.0.0-test-';
    for (const suffix of ['Ab3De.', 'Ab3De-', 'Ab3De_', 'Ab3De$', 'Ab3De;', 'Ab3De*', 'Ab3De ']) {
      expect(() => assertRemoteTempDir(remote, `${base}${suffix}`, template))
        .toThrow(/characters mktemp never generates/);
    }
    expect(assertRemoteTempDir(remote, `${base}Ab3De9`, template)).toBe(`${base}Ab3De9`);
  });

  test('requires at least three X, the POSIX minimum the template rule cites', () => {
    // Pins the documented boundary: without this, X{3,} could be relaxed to X{1,} unnoticed.
    expect(() => assertRemoteTempDir(remote, '/tmp/k-A', '/tmp/k-X')).toThrow(/at least three X/);
    expect(() => assertRemoteTempDir(remote, '/tmp/k-AB', '/tmp/k-XX')).toThrow(/at least three X/);
    expect(assertRemoteTempDir(remote, '/tmp/k-ABC', '/tmp/k-XXX')).toBe('/tmp/k-ABC');
  });

  test('rejects a relative path even though the template bound implies absoluteness', () => {
    expect(() => assertRemoteTempDir(remote, 'tmp/knowledge-linux-node-a-0.0.0-test-Ab3De9', template))
      .toThrow(/not absolute/);
  });
});

/**
 * The validator above is only worth anything if it is on the path that creates the temp dir and
 * on the path that deletes it. Nothing pinned that: removing both calls reverted the fix this
 * PR exists to make and left every test in this file passing.
 *
 * `createRemoteTempDir` and `removeRemoteTempDir` therefore take their ssh work as a parameter,
 * so these tests drive the real functions - the ones that decide whether the validator runs -
 * with stubs, instead of a private re-implementation of them. Deleting either validation call
 * now fails here.
 *
 * The negative in the delete case is the one that matters: when the value does not validate, the
 * remote delete must not be ATTEMPTED at all. Asserting only that a throw happened would still
 * pass if the `rm -rf` had already been sent.
 *
 * They live in `scripts/lib/`, not in the smoke script, deliberately: importing the smoke script
 * into this suite is what installed a package on a reviewer's machine, and a test file that
 * imports it would re-arm exactly that trap the moment the direct-invocation guard regressed.
 */
describe('remote temp dir guard wiring', () => {
  const remote = 'linux-node-a';
  const template = '/tmp/knowledge-linux-node-a-0.0.0-test-XXXXXX';
  const good = '/tmp/knowledge-linux-node-a-0.0.0-test-Ab3De9';

  // Everything a wrapper can hand back while still exiting 0, which is the reachable hole:
  // runChecked already aborts on a non-zero remote exit.
  const rejectedValues = [
    '',
    'Welcome to linux-node-a\n/tmp/knowledge-linux-node-a-0.0.0-test-Ab3De9',
    `${good}\nmktemp: failed`,
    '/tmp/somebody-elses-dir',
    `${good}/nested`,
    '/',
    '/home/hasna',
  ];

  test('createRemoteTempDir validates what mktemp returned before returning it', () => {
    // `undefined` is a create-only case - a wrapper that returned nothing at all. On the delete
    // side a nullish value means creation never happened, which is a separate test below.
    for (const bad of [...rejectedValues, undefined]) {
      expect(() => createRemoteTempDir(remote, template, () => bad), JSON.stringify(bad))
        .toThrow(/Refusing to use remote temp dir/);
    }
  });

  test('createRemoteTempDir trims and returns a path the template could have produced', () => {
    expect(createRemoteTempDir(remote, template, () => `${good}\n`)).toBe(good);
  });

  test('createRemoteTempDir validates against the same template it asked mktemp for', () => {
    // A guard checking a different template than the one that created the directory would be
    // no guard at all.
    const asked: Array<[string, string]> = [];
    createRemoteTempDir(remote, template, (host, requested) => {
      asked.push([host, requested]);
      return good;
    });
    expect(asked).toEqual([[remote, template]]);
  });

  test('removeRemoteTempDir never attempts a delete for a value that does not validate', () => {
    const deleted: string[] = [];
    const reported: string[] = [];
    const io = {
      deleteDir: (dir: string) => { deleted.push(dir); },
      report: (what: string) => { reported.push(what); },
    };

    for (const bad of rejectedValues) {
      expect(removeRemoteTempDir(remote, bad, template, io), JSON.stringify(bad)).toBe(false);
    }

    expect(deleted).toEqual([]);
    expect(reported).toHaveLength(rejectedValues.length);
    for (const what of reported) expect(what).toContain('refusing remote cleanup');
  });

  test('removeRemoteTempDir deletes exactly the validated directory', () => {
    const deleted: string[] = [];
    const reported: string[] = [];
    const result = removeRemoteTempDir(remote, good, template, {
      deleteDir: (dir: string) => { deleted.push(dir); },
      report: (what: string) => { reported.push(what); },
    });

    expect(result).toBe(true);
    expect(deleted).toEqual([good]);
    expect(reported).toEqual([]);
  });

  test('removeRemoteTempDir does nothing, and reports nothing, when creation never happened', () => {
    // runSyncSmoke calls this from `finally` with remoteDir still null whenever creation threw.
    const deleted: string[] = [];
    const reported: string[] = [];
    const io = {
      deleteDir: (dir: string) => { deleted.push(dir); },
      report: (what: string) => { reported.push(what); },
    };

    expect(removeRemoteTempDir(remote, null, template, io)).toBe(false);
    expect(removeRemoteTempDir(remote, undefined, template, io)).toBe(false);
    expect(deleted).toEqual([]);
    expect(reported).toEqual([]);
  });

  test('removeRemoteTempDir reports a failed delete instead of throwing out of a finally', () => {
    // A throw here would replace the in-flight smoke failure with a cleanup error and skip the
    // rest of the cleanup.
    const reported: string[] = [];
    expect(() => removeRemoteTempDir(remote, good, template, {
      deleteDir: () => { throw new Error('ssh: command not found'); },
      report: (what: string) => { reported.push(what); },
    })).not.toThrow();
    expect(reported).toHaveLength(1);
    expect(reported[0]).toContain(good);
  });

  /**
   * The behavioural tests above pin the gate; this pins that the gate is on the path.
   * `mktemp -d` and `rm -rf` may each appear exactly once in the smoke script, inside the helper
   * handed to the guarded function - so an inlined, unvalidated delete cannot quietly grow
   * beside it.
   *
   * Read through the transpiler rather than the raw file, for the same reason the published
   * import check does: the docstrings around these helpers quote the very commands being
   * counted, and stripping comments with anything less than a parser is a guess that fails
   * silently.
   */
  test('the smoke script reaches remote mktemp and rm -rf only through the guarded helpers', () => {
    const code = new Bun.Transpiler({ loader: 'js' })
      .transformSync(readFileSync(script, 'utf8'))
      .replace(/\s+/g, ' ');

    expect([...code.matchAll(/mktemp -d/g)]).toHaveLength(1);
    expect([...code.matchAll(/rm -rf/g)]).toHaveLength(1);
    expect(code).toMatch(/import \{ createRemoteTempDir, removeRemoteTempDir \} from ['"]\.\/lib\/remote-temp-dir\.mjs['"]/);
    expect(code).toMatch(/createRemoteTempDir\(options\.remote, remoteTemplate, remoteMktemp\)/);
    expect(code).toMatch(/removeRemoteTempDir\(options\.remote, remoteDir, remoteTemplate, \{/);
    expect(code).toMatch(/deleteDir: \(?dir\)? => remoteRemoveDir\(options\.remote, dir\)/);
  });
});
