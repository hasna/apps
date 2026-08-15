import { describe, test, expect } from "bun:test";
import { DEVICE_PRESETS, listDevicePresets, isMobileViewport } from "./responsive.js";

describe("responsive testing (OPE9-00269)", () => {
  describe("DEVICE_PRESETS", () => {
    test("has mobile phone presets", () => {
      expect(DEVICE_PRESETS["iphone-se"]).toBeDefined();
      expect(DEVICE_PRESETS["iphone-14"]).toBeDefined();
      expect(DEVICE_PRESETS["pixel-7"]).toBeDefined();
      expect(DEVICE_PRESETS["samsung-s23"]).toBeDefined();
    });

    test("has tablet presets", () => {
      expect(DEVICE_PRESETS["ipad"]).toBeDefined();
      expect(DEVICE_PRESETS["ipad-pro"]).toBeDefined();
    });

    test("has desktop presets", () => {
      expect(DEVICE_PRESETS["desktop"]).toBeDefined();
      expect(DEVICE_PRESETS["desktop-wide"]).toBeDefined();
      expect(DEVICE_PRESETS["desktop-large"]).toBeDefined();
    });

    test("has breakpoint presets", () => {
      expect(DEVICE_PRESETS["mobile"]).toBeDefined();
      expect(DEVICE_PRESETS["tablet"]).toBeDefined();
      expect(DEVICE_PRESETS["laptop"]).toBeDefined();
    });

    test("all presets have valid viewport dimensions", () => {
      for (const [name, preset] of Object.entries(DEVICE_PRESETS)) {
        expect(preset.viewport.width).toBeGreaterThan(0);
        expect(preset.viewport.height).toBeGreaterThan(0);
        expect(typeof name).toBe("string");
      }
    });

    test("mobile presets are smaller than desktop", () => {
      const mobile = DEVICE_PRESETS["iphone-se"]!.viewport;
      const desktop = DEVICE_PRESETS["desktop"]!.viewport;
      expect(mobile.width).toBeLessThan(desktop.width);
    });
  });

  describe("listDevicePresets", () => {
    test("returns array of preset names", () => {
      const names = listDevicePresets();
      expect(names.length).toBeGreaterThan(0);
      expect(names).toContain("iphone-se");
      expect(names).toContain("desktop");
      expect(names).toContain("tablet");
    });
  });
});
