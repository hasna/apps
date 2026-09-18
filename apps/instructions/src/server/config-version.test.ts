import { afterEach, describe, expect, spyOn, test } from "bun:test";
import * as cloud from "./cloud.js";
import * as store from "../storage/cloud-store.js";
import { ConfigVersionConflictError, InvalidExpectedVersionError } from "../types/index.js";
import { handleV1Request } from "./v1.js";

const spies: Array<{ mockRestore(): void }> = [];
afterEach(() => { while (spies.length) spies.pop()!.mockRestore(); });

describe("conditional config update HTTP contract", () => {
  test.each(["PATCH", "PUT", "POST"])("%s returns a structured 409 for a stale version", async (method) => {
    spies.push(spyOn(cloud, "ensureCloudSchema").mockResolvedValue(undefined));
    spies.push(spyOn(cloud, "getCloudClient").mockReturnValue({} as never));
    const update = spyOn(store, "updateConfig").mockRejectedValue(new ConfigVersionConflictError("config-1", 7));
    spies.push(update);
    const url = new URL(`http://localhost/v1/configs/config-1${method === "POST" ? "/conditional-update" : ""}`);
    const request = new Request(url, { method, body: JSON.stringify({ content: "candidate", expected_version: 7 }) });
    const response = await handleV1Request(request, url);
    expect(response?.status).toBe(409);
    expect(await response?.json()).toMatchObject({ code: "CONFIG_VERSION_CONFLICT", config_id: "config-1", expected_version: 7 });
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0]?.[2]).toEqual({ content: "candidate", expected_version: 7 });
  });

  test("invalid expected_version is a client error", async () => {
    spies.push(spyOn(cloud, "ensureCloudSchema").mockResolvedValue(undefined));
    spies.push(spyOn(cloud, "getCloudClient").mockReturnValue({} as never));
    spies.push(spyOn(store, "updateConfig").mockRejectedValue(new InvalidExpectedVersionError()));
    const url = new URL("http://localhost/v1/configs/config-1");
    const response = await handleV1Request(new Request(url, { method: "PATCH", body: JSON.stringify({ expected_version: 0 }) }), url);
    expect(response?.status).toBe(400);
    expect(await response?.json()).toMatchObject({ code: "INVALID_EXPECTED_VERSION" });
  });
  test.each([undefined, 0, -1, 1.5, "1", null])("conditional route rejects missing/invalid version %p before update", async (expected_version) => {
    spies.push(spyOn(cloud, "ensureCloudSchema").mockResolvedValue(undefined));
    spies.push(spyOn(cloud, "getCloudClient").mockReturnValue({} as never));
    const update = spyOn(store, "updateConfig");
    spies.push(update);
    const url = new URL("http://localhost/v1/configs/config-1/conditional-update");
    const response = await handleV1Request(new Request(url, { method: "POST", body: JSON.stringify({ content: "candidate", expected_version }) }), url);
    expect(response?.status).toBe(400);
    expect(await response?.json()).toMatchObject({ code: "INVALID_EXPECTED_VERSION" });
    expect(update).not.toHaveBeenCalled();
  });

  test("conditional route returns the accepted row and does not allow PATCH", async () => {
    spies.push(spyOn(cloud, "ensureCloudSchema").mockResolvedValue(undefined));
    spies.push(spyOn(cloud, "getCloudClient").mockReturnValue({} as never));
    const update = spyOn(store, "updateConfig").mockResolvedValue({ id: "config-1", version: 8 } as never);
    spies.push(update);
    const url = new URL("http://localhost/v1/configs/config-1/conditional-update");
    const body = JSON.stringify({ content: "candidate", expected_version: 7 });
    const response = await handleV1Request(new Request(url, { method: "POST", body }), url);
    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual({ config: { id: "config-1", version: 8 } });
    expect((await handleV1Request(new Request(url, { method: "PATCH", body }), url))?.status).toBe(405);
    expect(update).toHaveBeenCalledTimes(1);
  });

});
