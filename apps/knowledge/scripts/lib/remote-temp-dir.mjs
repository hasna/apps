import { posix } from 'node:path';

/**
 * Validate a path that will later be handed to `rm -rf` on a remote host.
 *
 * What this actually defends against - stated precisely, because an earlier version of this
 * comment described an unreachable code path:
 *
 * `runRemote` goes through `runChecked`, which throws on a non-zero remote exit. A *failing*
 * `mktemp -d` exits 1, so it aborts the run and never yields an empty string. The reachable
 * hole is the remote exiting **zero** with stdout that is not the path: an ssh `Banner`, a
 * chatty login profile, or a `ForceCommand` wrapper prepends lines, and a wrapper can mask
 * the real exit status entirely. Whatever lands in that variable is then passed as a
 * `--peer-workspace` argv element and, more importantly, interpolated into the remote shell
 * strings `cd <value> && knowledge ...` and `rm -rf <value>`.
 *
 * That is the same class as the 2026-07-24 incident - a delete target taken on faith from a
 * command's output - which is why the check belongs at the assignment rather than relying on
 * `shellQuote` downstream to neutralise a value that should never have been accepted.
 *
 * Accepts only what this exact template could have produced: `mktemp` replaces the trailing
 * run of `X` in place, so the result is the template's fixed prefix followed by a single
 * non-empty path component. Checking against the template's parent directory alone is not
 * enough - it would accept any unrelated directory sitting beside the temp dir - so a
 * template whose final component is nothing but `X` (`/tmp/XXXXXX`) is refused outright:
 * its prefix is a bare directory, which would silently degrade this into exactly that
 * parent-only check. The bound is derived from the template, so it stays correct if the
 * template moves.
 *
 * @param {string} remote Remote host, used in the error message only.
 * @param {unknown} dir Trimmed stdout of the remote `mktemp -d`.
 * @param {string} template Absolute template passed to `mktemp -d`, ending in `XXX...`.
 * @returns {string} The validated directory.
 * @throws {Error} If the value is anything other than a directory that template could create.
 */
export function assertRemoteTempDir(remote, dir, template) {
  const fail = (why) => {
    throw new Error(
      `Refusing to use remote temp dir from ${remote}: ${why}. `
      + `Template ${template}, got ${JSON.stringify(dir)}. `
      + 'This value is used as an `rm -rf` target on the remote host.'
    );
  };

  if (typeof template !== 'string' || !template.startsWith('/')) {
    throw new Error(`Remote temp dir template must be an absolute path, got ${JSON.stringify(template)}.`);
  }
  // A template containing `.` or `..` makes the derived bound meaningless, and the template
  // is built from a caller-supplied version string. Require it to be already normalized
  // rather than normalizing silently, so a surprising template is loud instead of accepted.
  if (posix.normalize(template) !== template) {
    throw new Error(
      `Remote temp dir template must be normalized (no "." or ".." segments), got ${JSON.stringify(template)}.`
    );
  }
  // POSIX mktemp requires at least three trailing X in the final component.
  const match = template.match(/^(.*[^X])(X{3,})$/);
  if (!match) {
    throw new Error(`Remote temp dir template must end in at least three X, got ${JSON.stringify(template)}.`);
  }
  const [, prefix, xRun] = match;
  // Without a fixed part in the final component, `prefix` is a bare directory and every
  // sibling under it would validate - the parent-only check this function exists to avoid.
  if (prefix.endsWith('/')) {
    throw new Error(
      'Remote temp dir template must have a fixed prefix in its final component '
      + `(e.g. /tmp/knowledge-XXXXXX, not /tmp/XXXXXX), got ${JSON.stringify(template)}.`
    );
  }

  if (typeof dir !== 'string' || dir === '') fail('mktemp -d produced no path');
  if (/[\r\n]/.test(dir)) fail('path spans multiple lines');
  // Redundant while the template is absolute and normalized (prefix then starts with `/`),
  // kept as a cheap invariant so a future change to the template rules cannot quietly admit
  // a relative delete target.
  if (!dir.startsWith('/')) fail('path is not absolute');
  if (!dir.startsWith(prefix)) fail(`path does not start with the template prefix ${prefix}`);

  const suffix = dir.slice(prefix.length);
  if (suffix === '') fail('path is the bare template prefix, so mktemp created nothing');
  if (suffix.includes('/')) fail('path descends below the directory the template would create');
  // mktemp replaces the X run with exactly that many characters from [A-Za-z0-9]. Requiring
  // the same shape is what makes "only what this template could have produced" literally
  // true, rather than "anything under the prefix without a slash in it".
  if (suffix.length !== xRun.length) {
    fail(`path suffix is ${suffix.length} characters, but the template's X run is ${xRun.length}`);
  }
  if (!/^[A-Za-z0-9]+$/.test(suffix)) fail('path suffix contains characters mktemp never generates');

  return dir;
}

/**
 * Create a remote temp dir, returning only a path this exact template could have produced.
 *
 * `makeTempDir` is injected rather than imported so this module never spawns a process - the
 * published script stays the only thing that talks to ssh - and, more to the point, so a test
 * can drive THIS function, the one that decides whether the validator runs at all. Exercising
 * `assertRemoteTempDir` on its own proves the validator works but pins nothing about it being
 * wired in: deleting the call below used to leave the entire suite green.
 *
 * @param {string} remote Remote host.
 * @param {string} template Absolute template passed to `mktemp -d`, ending in `XXX...`.
 * @param {(remote: string, template: string) => string} makeTempDir Runs `mktemp -d <template>`
 *   on `remote` and returns its stdout. Expected to throw on a non-zero remote exit.
 * @returns {string} The validated directory.
 * @throws {Error} If the value is anything other than a directory that template could create.
 */
export function createRemoteTempDir(remote, template, makeTempDir) {
  const raw = makeTempDir(remote, template);
  // A non-string reaches the guard as-is rather than dying on `.trim()`, so a wrapper returning
  // something unexpected produces the explanatory refusal instead of a bare TypeError.
  const dir = typeof raw === 'string' ? raw.trim() : raw;
  return assertRemoteTempDir(remote, dir, template);
}

/**
 * Delete a remote temp dir, but only after re-checking that the value is still something
 * `template` could have produced, and without ever throwing.
 *
 * That re-check is the last gate in front of a recursive delete on another machine, which is
 * why it lives here rather than inline in the caller's `finally`: the property worth pinning is
 * a negative - `deleteDir` must NOT be called when the value does not validate - and a negative
 * is unobservable while the gate sits in a cleanup block no test can drive.
 *
 * Callers use this from `finally`, where a throw would replace the in-flight exception and skip
 * the remaining cleanup, so every step is contained and problems are handed to `report`.
 *
 * @param {string} remote Remote host.
 * @param {string|null|undefined} dir Candidate delete target; nullish means there is nothing to
 *   clean up, which is normal when creation itself failed.
 * @param {string} template The template `dir` was created from.
 * @param {{
 *   deleteDir: (dir: string) => void,
 *   report: (what: string, error: unknown) => void,
 * }} io `deleteDir` performs the remote delete; `report` records a cleanup problem and must not
 *   throw.
 * @returns {boolean} Whether the delete was attempted.
 */
export function removeRemoteTempDir(remote, dir, template, { deleteDir, report }) {
  if (dir === null || dir === undefined) return false;

  try {
    assertRemoteTempDir(remote, dir, template);
  } catch (error) {
    report('refusing remote cleanup, temp dir no longer validates', error);
    return false;
  }

  try {
    deleteDir(dir);
  } catch (error) {
    report(`remote cleanup of ${dir} could not be spawned`, error);
  }
  return true;
}
