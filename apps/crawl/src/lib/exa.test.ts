import { describe, expect, it } from "bun:test";
import {
  EXA_API_KEY_ENV,
  checkExaWebSearch,
  getExaApiKey,
  requireExaApiKey,
} from "./exa.js";

describe("getExaApiKey", () => {
  it("returns the explicit apiKey trimmed, ahead of any env value", () => {
    expect(
      getExaApiKey({
        apiKey: "  sk-explicit  ",
        env: { [EXA_API_KEY_ENV]: "sk-env" },
      })
    ).toBe("sk-explicit");
  });

  it("reads EXA_API_KEY from the injected env when no explicit key is given", () => {
    expect(getExaApiKey({ env: { [EXA_API_KEY_ENV]: "  sk-env  " } })).toBe("sk-env");
  });

  it("returns undefined for a whitespace-only env value", () => {
    expect(getExaApiKey({ env: { [EXA_API_KEY_ENV]: "   " } })).toBeUndefined();
  });

  it("returns undefined when the env variable is absent", () => {
    expect(getExaApiKey({ env: {} })).toBeUndefined();
  });

  it("returns undefined when both sources are empty", () => {
    expect(getExaApiKey({ apiKey: "   ", env: { [EXA_API_KEY_ENV]: "  " } })).toBeUndefined();
  });
});

describe("requireExaApiKey", () => {
  it("returns the key when available", () => {
    expect(requireExaApiKey({ apiKey: "sk-ok" })).toBe("sk-ok");
  });

  it("throws naming the env var when no key is configured", () => {
    expect(() => requireExaApiKey({ env: {} })).toThrow(EXA_API_KEY_ENV);
  });
});

describe("checkExaWebSearch", () => {
  it("reports available with the env source when a key exists", () => {
    const status = checkExaWebSearch({ apiKey: "sk-x" });
    expect(status.available).toBe(true);
    expect(status.env).toBe(EXA_API_KEY_ENV);
    expect(status.source).toBe("env");
    expect(status.setup).toContain(EXA_API_KEY_ENV);
  });

  it("reports unavailable and names the setup step when no key exists", () => {
    const status = checkExaWebSearch({ env: {} });
    expect(status.available).toBe(false);
    expect(status.setup).toContain(`set ${EXA_API_KEY_ENV}`);
  });
});
