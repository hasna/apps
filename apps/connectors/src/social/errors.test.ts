import { describe, test, expect } from "bun:test";
import { ConnectorOperationNotSupported } from "./errors.js";

describe("ConnectorOperationNotSupported", () => {
  test("message names connector and operation", () => {
    const err = new ConnectorOperationNotSupported("bluesky", "post_analytics");
    expect(err.message).toBe('Connector "bluesky" does not support operation "post_analytics"');
  });

  test("name is the class name so instanceof-style checks and logs agree", () => {
    const err = new ConnectorOperationNotSupported("x", "follower_analytics");
    expect(err.name).toBe("ConnectorOperationNotSupported");
  });

  test("connector and operation properties are preserved for programmatic routing", () => {
    const err = new ConnectorOperationNotSupported("mastodon", "insights");
    expect(err.connector).toBe("mastodon");
    expect(err.operation).toBe("insights");
  });

  test("is a real Error with a stack", () => {
    const err = new ConnectorOperationNotSupported("reddit", "analytics");
    expect(err).toBeInstanceOf(Error);
    expect(err.stack).toBeTruthy();
  });

  test("does not leak constructor arguments into the message via interpolation", () => {
    const err = new ConnectorOperationNotSupported("weird\"connector", "op`with${tpl}");
    expect(err.message).toContain('"weird"connector"');
    expect(err.message).toContain("op`with${tpl}");
  });
});
