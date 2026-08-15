import { describe, expect, test } from "bun:test";
import { getAppDriver, listAppDrivers } from "./registry.js";
import { ghosttyAvailability } from "./ghostty/driver.js";

describe("app registry", () => {
  test("ghostty driver is registered", () => {
    const driver = getAppDriver("ghostty");
    expect(driver).toBeDefined();
    expect(driver!.name).toBe("ghostty");
  });

  test("lookup is case-insensitive", () => {
    expect(getAppDriver("Ghostty")).toBeDefined();
    expect(getAppDriver("GHOSTTY")).toBeDefined();
  });

  test("unknown apps return undefined", () => {
    expect(getAppDriver("notepad")).toBeUndefined();
  });

  test("listAppDrivers includes ghostty with a description", () => {
    const drivers = listAppDrivers();
    const ghostty = drivers.find((d) => d.name === "ghostty");
    expect(ghostty).toBeDefined();
    expect(ghostty!.description.length).toBeGreaterThan(0);
    expect(typeof ghostty!.available).toBe("function");
  });
});

describe("ghostty availability", () => {
  test("available on darwin when the app bundle exists", () => {
    const a = ghosttyAvailability({ platform: "darwin", hasAppBundle: true, hasBinary: false });
    expect(a.available).toBe(true);
  });

  test("available on darwin when only the binary is on PATH", () => {
    const a = ghosttyAvailability({ platform: "darwin", hasAppBundle: false, hasBinary: true });
    expect(a.available).toBe(true);
  });

  test("unavailable on linux with a reason", () => {
    const a = ghosttyAvailability({ platform: "linux", hasAppBundle: false, hasBinary: true });
    expect(a.available).toBe(false);
    expect(a.reason).toMatch(/macOS/i);
  });

  test("unavailable on darwin without app or binary, with a reason", () => {
    const a = ghosttyAvailability({ platform: "darwin", hasAppBundle: false, hasBinary: false });
    expect(a.available).toBe(false);
    expect(a.reason).toMatch(/not (found|installed)/i);
  });
});
