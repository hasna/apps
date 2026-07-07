import { describe, expect, test } from "bun:test";
import {
  LOGS_APP_SLUG,
  LOGS_RESOURCE,
  resolveLogsCloudStore,
} from "./cloud-store.ts";

const CLEAN_ENV = {} as NodeJS.ProcessEnv;

describe("logs cloud-store resolver (self_hosted client flip)", () => {
  test("resource + slug are the contract-stable values", () => {
    expect(LOGS_APP_SLUG).toBe("logs");
    expect(LOGS_RESOURCE).toBe("logs");
  });

  test("returns null (local) when no env is set", () => {
    expect(resolveLogsCloudStore(CLEAN_ENV)).toBeNull();
  });

  test("returns null (local) when mode=local even with url+key present", () => {
    const store = resolveLogsCloudStore({
      HASNA_LOGS_STORAGE_MODE: "local",
      HASNA_LOGS_API_URL: "https://logs.hasna.xyz",
      HASNA_LOGS_API_KEY: "k_fake_test_key",
    } as NodeJS.ProcessEnv);
    expect(store).toBeNull();
  });

  test("throws (never silent local drift) when self_hosted requested but key missing", () => {
    expect(() =>
      resolveLogsCloudStore({
        HASNA_LOGS_STORAGE_MODE: "self_hosted",
        HASNA_LOGS_API_URL: "https://logs.hasna.xyz",
      } as NodeJS.ProcessEnv),
    ).toThrow();
  });

  test("resolves a cloud-http store at <app>.hasna.xyz/v1 when self_hosted + url + key", () => {
    const store = resolveLogsCloudStore({
      HASNA_LOGS_STORAGE_MODE: "self_hosted",
      HASNA_LOGS_API_URL: "https://logs.hasna.xyz",
      HASNA_LOGS_API_KEY: "k_fake_test_key",
    } as NodeJS.ProcessEnv);
    expect(store).not.toBeNull();
    expect(store!.baseUrl).toBe("https://logs.hasna.xyz/v1");
  });

  test("defaults the base URL to https://logs.hasna.xyz/v1 when only mode+key set", () => {
    const store = resolveLogsCloudStore({
      HASNA_LOGS_STORAGE_MODE: "self_hosted",
      HASNA_LOGS_API_KEY: "k_fake_test_key",
    } as NodeJS.ProcessEnv);
    expect(store).not.toBeNull();
    expect(store!.baseUrl).toBe("https://logs.hasna.xyz/v1");
  });

  // Regression: the fleet flip writes ONLY these two vars (no storage-mode var).
  // Presence of both must imply self_hosted and route to cloud-http, otherwise
  // an installed CLI silently keeps reading local even with the env set.
  test("routes to cloud when only the two flip vars (url + key) are set — no mode var", () => {
    const store = resolveLogsCloudStore({
      HASNA_LOGS_API_URL: "https://logs.hasna.xyz",
      HASNA_LOGS_API_KEY: "k_fake_test_key",
    } as NodeJS.ProcessEnv);
    expect(store).not.toBeNull();
    expect(store!.baseUrl).toBe("https://logs.hasna.xyz/v1");
  });

  test("key alone (no url, no mode var) stays local — flip writes both vars together", () => {
    const store = resolveLogsCloudStore({
      HASNA_LOGS_API_KEY: "k_fake_test_key",
    } as NodeJS.ProcessEnv);
    expect(store).toBeNull();
  });

  test("url alone (no key) stays local when no mode var is set", () => {
    const store = resolveLogsCloudStore({
      HASNA_LOGS_API_URL: "https://logs.hasna.xyz",
    } as NodeJS.ProcessEnv);
    expect(store).toBeNull();
  });
});
