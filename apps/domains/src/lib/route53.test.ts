import { describe, it, expect } from "bun:test";
import { updateNameservers } from "./route53.js";

describe("updateNameservers — delegate DNS to Cloudflare", () => {
  it("builds an UpdateDomainNameservers command with the given NS and returns the operation id", async () => {
    const captured: { input?: any } = {};
    const fakeClient = {
      send: async (cmd: any) => {
        captured.input = cmd.input;
        return { OperationId: "op-123" };
      },
    };

    const res = await updateNameservers(
      "example.com",
      ["amy.ns.cloudflare.com", "bob.ns.cloudflare.com"],
      undefined,
      fakeClient,
    );

    expect(res.operationId).toBe("op-123");
    expect(captured.input.DomainName).toBe("example.com");
    expect(captured.input.Nameservers).toEqual([
      { Name: "amy.ns.cloudflare.com" },
      { Name: "bob.ns.cloudflare.com" },
    ]);
  });

  it("throws when no nameservers are provided", async () => {
    const fakeClient = { send: async () => ({ OperationId: "x" }) };
    await expect(updateNameservers("example.com", [], undefined, fakeClient)).rejects.toThrow(
      /at least one nameserver/,
    );
  });
});
