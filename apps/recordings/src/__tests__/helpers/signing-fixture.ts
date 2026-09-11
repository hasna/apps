import { lstatSync, realpathSync } from "node:fs";
import { basename } from "node:path";
import { tmpdir } from "node:os";

/** Test-only confinement. An unrecognized process cannot reach host signing tools. */
export function signingFixtureCommand(root: string, command: string[]): string[] {
  const details = lstatSync(root);
  if (root !== realpathSync(root) || !details.isDirectory() || details.isSymbolicLink() ||
      details.uid !== process.getuid?.() || (details.mode & 0o777) !== 0o700 ||
      !basename(root).startsWith("recordings-") || !root.startsWith(`${realpathSync(tmpdir())}/`)) {
    throw new Error("signing fixture requires a canonical owned private temporary root");
  }
  if (process.platform !== "darwin") return command;
  const tools = [process.execPath, "/bin/bash", "/bin/sh", "/usr/bin/env", "/usr/bin/uname",
    "/usr/bin/git", "/Library/Developer/CommandLineTools/usr/bin/git",
    "/usr/bin/dirname", "/bin/pwd", "/usr/bin/awk", "/usr/bin/basename", "/bin/cat",
    "/bin/chmod", "/bin/cp", "/usr/bin/head", "/bin/hostname", "/bin/mkdir",
    "/usr/bin/mktemp", "/bin/mv", "/bin/ln", "/bin/rmdir", "/bin/rm", "/usr/bin/sed",
    "/usr/bin/tr", "/usr/bin/grep", "/usr/bin/find", "/bin/ls", "/usr/bin/id",
    "/usr/bin/stat", "/usr/bin/tar", "/usr/bin/bsdtar", "/usr/bin/shasum", "/usr/bin/perl", "/usr/bin/perl5.34"];
  const profile = `(version 1)
(allow default)
(deny network*)
(deny signal)
(allow signal (target same-sandbox))
(deny process-exec (require-not (require-any ${tools.map(tool => `(literal ${JSON.stringify(tool)})`).join(" ")} (subpath ${JSON.stringify(root)}))))
(deny file-write* (require-all (regex #"^/") (require-not (require-any (subpath ${JSON.stringify(root)}) (literal "/dev/null")))))
(deny file-read* (subpath "/Applications") (subpath "/Library/Keychains")
  (subpath "/Library/Application Support/com.apple.TCC")
  (regex #"^/Users/[^/]+/Library/(Keychains|Preferences|Application Support/com.apple.TCC)(/|$)")
  (regex #"^/Users/[^/]+/\\.hasna/recordings(/|$)"))`;
  return ["/usr/bin/sandbox-exec", "-p", profile, ...command];
}

/** Assert replacement sites, so upstream script changes cannot silently drop isolation. */
export function replaceFixtureText(source: string, before: string, after: string): string {
  if (!source.includes(before)) throw new Error(`signing fixture replacement is missing: ${before}`);
  return source.replaceAll(before, after);
}
