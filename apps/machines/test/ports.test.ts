import { describe, expect, test } from "bun:test";
import { parsePortOutput } from "../src/commands/ports.js";

describe("ports parsing", () => {
  test("parses ss output", () => {
    const listeners = parsePortOutput("tcp LISTEN 0 511 0.0.0.0:3000 0.0.0.0:* users:((\"bun\",pid=1234,fd=18))", "ss");
    expect(listeners[0]?.port).toBe(3000);
    expect(listeners[0]?.host).toBe("0.0.0.0");
  });

  test("parses lsof output", () => {
    const listeners = parsePortOutput("node 1234 hasna 21u IPv4 0x01 0t0 TCP *:3000 (LISTEN)", "lsof");
    expect(listeners[0]?.port).toBe(3000);
    expect(listeners[0]?.process).toBe("node");
  });
});
