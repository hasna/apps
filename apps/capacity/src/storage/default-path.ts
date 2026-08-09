import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * The zero-config on-box SQLite location. Capacity owns `~/.hasna/capacity/`;
 * the pre-rename default inside the accounts app's own data directory
 * (`~/.hasna/accounts/accounts.db`) is honoured only when it already exists and
 * no store exists at the owned location, so data written under the old default
 * keeps opening while new stores never land inside another app's directory —
 * a directory this package neither owns nor controls the permissions of, and
 * which the owner-only path check therefore rightly refuses on shared boxes.
 */
export function defaultDatabasePath(): string {
  const canonical = join(homedir(), ".hasna", "capacity", "capacity.db");
  if (existsSync(canonical)) return canonical;
  const legacy = join(homedir(), ".hasna", "accounts", "accounts.db");
  if (existsSync(legacy)) return legacy;
  return canonical;
}
