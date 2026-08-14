// App driver registry — deterministic app orchestration for `computer open`
// and `computer apps`. Drivers register here; lookup is case-insensitive.

import type { AppDriver } from "./types.js";
import { ghosttyDriver } from "./ghostty/driver.js";

const drivers = new Map<string, AppDriver>();

export function registerAppDriver(driver: AppDriver): void {
  drivers.set(driver.name.toLowerCase(), driver);
}

export function getAppDriver(name: string): AppDriver | undefined {
  return drivers.get(name.toLowerCase());
}

export function listAppDrivers(): AppDriver[] {
  return [...drivers.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// ── Built-in drivers ─────────────────────────────────────────────────
registerAppDriver(ghosttyDriver);
