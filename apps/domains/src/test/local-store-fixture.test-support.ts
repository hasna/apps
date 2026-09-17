import { afterEach, beforeEach, spyOn } from "bun:test";
import * as stores from "../db/store.js";
import { LocalStore } from "../db/local-store.js";

/** Explicit storage-unit fixture. Never imported by a client entrypoint. */
export function useLocalStoreFixture(): void {
  let restore: (() => void) | undefined;
  beforeEach(() => {
    const fixture = new LocalStore();
    const spy = spyOn(stores, "getStore").mockImplementation(() => fixture);
    restore = () => spy.mockRestore();
  });
  afterEach(() => { restore?.(); restore = undefined; });
}
