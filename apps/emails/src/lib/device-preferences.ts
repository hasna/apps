import { closeSync, constants, fstatSync, openSync, mkdirSync, readSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { getDataRoot } from "../paths.js";

type PreferenceFile = "tui-attachments" | "tui-preferences";
function preferencePath(name: PreferenceFile): string {
  if (name !== "tui-attachments" && name !== "tui-preferences") throw new Error("Unknown device preference file");
  return join(getDataRoot(), "config", `${name}.json`);
}
/** Only dedicated device preferences; never mail, credentials or legacy config. */
export function readDevicePreferences(name: PreferenceFile): Record<string, unknown> {
  let fd: number | undefined;
  try {
    fd = openSync(preferencePath(name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 16384) return {};
    const bytes = Buffer.alloc(stat.size + 1);
    const count = readSync(fd, bytes, 0, bytes.length, 0);
    if (count !== stat.size) return {};
    const value = JSON.parse(bytes.subarray(0, count).toString("utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch { return {}; } finally { if (fd !== undefined) closeSync(fd); }
}
export function writeDevicePreferences(name: PreferenceFile, value: Record<string, unknown>): void {
  const path = preferencePath(name);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(value) + "\n", { flag: "wx", mode: 0o600 });
    renameSync(temporary, path);
  } finally { rmSync(temporary, { force: true }); }
}
