import { describe, test, expect } from "bun:test";
import { THROTTLE_PROFILES } from "./offline-mode.js";

describe("offline mode and throttling (OPE9-00271)", () => {
  describe("THROTTLE_PROFILES", () => {
    test("has 3g profile", () => {
      const profile = THROTTLE_PROFILES["3g"];
      expect(profile).toBeDefined();
      expect(profile.label).toBe("3G");
      expect(profile.latency).toBe(150);
    });

    test("has 4g profile", () => {
      const profile = THROTTLE_PROFILES["4g"];
      expect(profile).toBeDefined();
      expect(profile.label).toBe("4G");
    });

    test("has slow-3g profile", () => {
      const profile = THROTTLE_PROFILES["slow-3g"];
      expect(profile).toBeDefined();
      expect(profile.latency).toBe(400);
    });

    test("has fast-3g profile", () => {
      const profile = THROTTLE_PROFILES["fast-3g"];
      expect(profile).toBeDefined();
      expect(profile.label).toBe("Fast 3G");
    });

    test("all profiles have valid values", () => {
      for (const [name, p] of Object.entries(THROTTLE_PROFILES)) {
        expect(p.download).toBeGreaterThan(0);
        expect(p.upload).toBeGreaterThan(0);
        expect(p.latency).toBeGreaterThan(0);
        expect(typeof name).toBe("string");
      }
    });
  });
});
