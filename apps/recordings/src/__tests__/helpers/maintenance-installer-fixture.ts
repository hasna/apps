import { cpSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { adaptShellFixtureTools } from "./confined-shell-fixture";
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const identity = "11111111-1111-4111-8111-111111111111";
export const maintenanceFixtureIdentity = createHash("sha256").update(identity).digest("hex");
export function prepareMaintenanceInstaller(root: string, repository: string, home: string, bin: string) {
  // Preserve Linux's existing explicit fixture overrides and recovery hooks.
  if (process.platform !== "darwin") return { path: join(repository, "scripts/install_macos_app.sh"), target: "station02" };
  const scripts = join(root, "scripts");
  mkdirSync(join(scripts, "policy"), { recursive: true });
  for (const file of ["install_macos_app.sh", "smoke_macos_app.sh", "macos_artifact.ts", "enforce_identity_migration.sh", "read_local_only_targets.sh", "policy/local-only-approved-targets.txt"]) {
    cpSync(join(repository, "scripts", file), join(scripts, file));
  }
  const target = readFileSync(join(scripts, "policy/local-only-approved-targets.txt"), "utf8").split("\n").map(x => x.trim()).find(x => x && !x.startsWith("#"))!;
  const write = (name: string, body: string) => {
    const path = join(bin, name); writeFileSync(path, `#!/bin/bash\nset -euo pipefail\n${body}\n`); chmodSync(path, 0o755); return path;
  };
  const noop = write("denied-tool", "exit 90");
  const tools: Record<string, string> = {};
  for (const tool of ["CODESIGN", "DITTO", "LSOF", "MDFIND", "OPEN", "SPCTL", "SQLITE3", "SYSPOLICY_CHECK", "XCRUN", "SW_VERS"]) tools[`${tool}_EXECUTABLE`] = noop;
  tools.HOSTNAME_EXECUTABLE = write("hostname-owned", `printf '%s\\n' ${quote(target)}`);
  tools.IOREG_EXECUTABLE = write("ioreg-owned", `printf '"IOPlatformUUID" = "${identity}"\\n'`);
  tools.MKTEMP_EXECUTABLE = write("mktemp-owned", `template="\${@: -1}"\ncase "$template" in /tmp/*) template=${quote(root)}"/\${template##*/}";; esac\nexec /usr/bin/mktemp -d "$template"`);
  tools.PS_EXECUTABLE = write("ps-owned", `
[ "$#" = 4 ] && [ "$1" = -o ] && [ "$2" = lstart= ] && [ "$3" = -p ] && [[ "$4" =~ ^[1-9][0-9]*$ ]] || exit 90
# Owned reader leases supply fixture process evidence. Never query host processes.
for owner in ${quote(join(home, ".hasna/.recordings-store-readers"))}/lease-*/owner; do
  [ -f "$owner" ] || continue
  if [ "$(/usr/bin/sed -n 1p "$owner")" = "$4" ]; then /usr/bin/sed -n 2p "$owner"; exit 0; fi
done
kill -0 "$4" 2>/dev/null || exit 1
printf 'Mon Sep 7 12:00:00 2026\\n'`);
  tools.BUN_EXECUTABLE = write("artifact-owned", `
case "$*" in
  *" native-fs-guard-check") exit 0;;
  *" fsync-tree "*|*" fsync-directory "*) exit 0;;
esac
printf '%s\\n' "$*" >> ${quote(join(root, "artifact-verification.log"))}
exit 79`);
  let script = readFileSync(join(scripts, "install_macos_app.sh"), "utf8");
  if (process.platform === "darwin") script = adaptShellFixtureTools(script, "test_fault_hooks_enabled() {", tools);
  writeFileSync(join(scripts, "install_macos_app.sh"), script);
  return { path: join(scripts, "install_macos_app.sh"), target };
}
