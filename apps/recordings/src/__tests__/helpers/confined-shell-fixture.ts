import { lstatSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Test-only process boundary. The production scripts never import this file. */
export function confinedShellCommand(root: string, command: string[], executables: string[] = []): string[] {
  const details = lstatSync(root);
  if (!details.isDirectory() || details.isSymbolicLink() || realpathSync(root) !== root ||
      details.uid !== process.getuid?.() || (details.mode & 0o777) !== 0o700) {
    throw new Error("shell fixture requires an owned canonical private root");
  }
  if (process.platform !== "darwin") return command;
  const literals = [...new Set([process.execPath, ...executables])].map((path) => `(literal ${JSON.stringify(path)})`).join(" ");
  const deniedReads = [
    "/Applications", "/Library/Application Support/com.apple.TCC",
    join(homedir(), "Applications"), join(homedir(), "Library", "Application Support", "com.apple.TCC"),
    join(homedir(), "Library", "Keychains"), join(homedir(), ".hasna", "recordings"),
    join(homedir(), "Library", "Preferences", "com.hasna.recordings.plist"),
  ].map((path) => `(subpath ${JSON.stringify(path)})`).join(" ");
  const profile = `(version 1)
(allow default)
(deny network*)
(deny signal)
(allow signal (target same-sandbox))
(deny process-exec (require-not (require-any ${literals} (subpath ${JSON.stringify(root)}))))
(deny file-read* ${deniedReads})
(deny file-write* (require-all (regex #"^/") (require-not (require-any (subpath ${JSON.stringify(root)}) (literal "/dev/null")))))`;
  return ["/usr/bin/sandbox-exec", "-p", profile, ...command];
}

/** Inject owned tool capabilities into a COPY, after the real Darwin selection. */
export function adaptShellFixtureTools(source: string, boundary: string, tools: Record<string, string>): string {
  if (source.split(boundary).length !== 2) throw new Error("shell fixture process boundary is missing or ambiguous");
  const bindings = Object.entries(tools).map(([name, path]) => {
    if (!/^[A-Z][A-Z0-9_]*_EXECUTABLE$/.test(name)) throw new Error("invalid fixture tool binding");
    const details = lstatSync(path);
    if (!details.isFile() || details.isSymbolicLink() || details.uid !== process.getuid?.() || (details.mode & 0o022) !== 0 || (details.mode & 0o111) === 0) {
      throw new Error("fixture tool must be an owned regular executable");
    }
    return `${name}='${path.replaceAll("'", "'\\''")}'`;
  });
  return source.replace(boundary, `# Test-only owned process capabilities; platform selection above is unchanged.\n${bindings.join("\n")}\n${boundary}`);
}

export const benignShellExecutables = [
  "/bin/bash", "/bin/sh", "/usr/bin/uname", "/usr/bin/dirname", "/bin/pwd",
  "/usr/bin/basename", "/usr/bin/env", "/bin/mv", "/bin/rm", "/usr/bin/sed",
  "/bin/sleep", "/usr/bin/tr", "/bin/ps", "/bin/kill", "/usr/bin/mktemp",
];
