import { expect, test } from "bun:test";
import { assertHostedHostAllowed, assertHostedHttpUrlAllowed } from "../src/target-policy.js";

test("hosted target policy rejects IPv4-mapped IPv6 private and metadata ranges", () => {
  for (const url of [
    "http://[::ffff:7f00:1]/",
    "http://[::ffff:a00:1]/",
    "http://[::ffff:a9fe:a9fe]/",
    "http://[::ffff:c0a8:1]/",
    "http://[::ffff:ac10:1]/",
    "http://[::ffff:6440:1]/",
    "http://[::ffff:0000:0001]/",
  ]) {
    expect(() => assertHostedHttpUrlAllowed(url)).toThrow("private or reserved IPv6");
  }

  for (const host of [
    "::ffff:7f00:1",
    "::ffff:a00:1",
    "::ffff:a9fe:a9fe",
    "::ffff:c0a8:1",
    "::ffff:ac10:1",
    "::ffff:6440:1",
    "::ffff:0000:0001",
  ]) {
    expect(() => assertHostedHostAllowed(host, "TCP host")).toThrow("private or reserved IPv6");
  }
});

test("hosted target policy allows public IPv4-mapped IPv6 literals", () => {
  expect(() => assertHostedHttpUrlAllowed("https://[::ffff:0808:0808]/")).not.toThrow();
  expect(() => assertHostedHostAllowed("::ffff:0808:0808", "TCP host")).not.toThrow();
});
