import { expect, test } from "bun:test";
import { assertHostedHostAllowed, assertHostedHttpUrlAllowed, assertHostedResolvedAddressesAllowed } from "../src/target-policy.js";

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

test("hosted target policy rejects reserved public-looking IPv4 ranges", () => {
  for (const url of [
    "http://192.0.0.10/",
    "http://192.0.2.10/",
    "http://192.88.99.1/",
    "http://198.18.0.1/",
    "http://198.51.100.10/",
    "http://203.0.113.10/",
  ]) {
    expect(() => assertHostedHttpUrlAllowed(url)).toThrow("private or reserved IPv4");
  }
});

test("hosted target policy rejects IPv6 special-purpose and transition ranges", () => {
  for (const url of [
    "http://[64:ff9b::a9fe:a9fe]/",
    "http://[64:ff9b:1::a9fe:a9fe]/",
    "http://[64:ff9b:1:a9fe:a9fe::]/",
    "http://[100::1]/",
    "http://[100:0:0:1::1]/",
    "http://[2001::1]/",
    "http://[2002:a9fe:a9fe::1]/",
    "http://[3fff::1]/",
    "http://[5f00::1]/",
  ]) {
    expect(() => assertHostedHttpUrlAllowed(url)).toThrow("private or reserved IPv6");
  }
});

test("hosted target policy rejects the full IPv6 link-local range", () => {
  for (const url of [
    "http://[fe80::1]/",
    "http://[fe90::1]/",
    "http://[fea0::1]/",
    "http://[febf::1]/",
  ]) {
    expect(() => assertHostedHttpUrlAllowed(url)).toThrow("private or reserved IPv6");
  }

  for (const host of ["fe80::1", "fe90::1", "fea0::1", "febf::1"]) {
    expect(() => assertHostedHostAllowed(host, "TCP host")).toThrow("private or reserved IPv6");
  }
});

test("hosted target policy rejects denied DNS resolution results", () => {
  expect(() => assertHostedResolvedAddressesAllowed("example.com", [
    { address: "93.184.216.34", family: 4 },
  ])).not.toThrow();
  expect(() => assertHostedResolvedAddressesAllowed("metadata.example", [
    { address: "169.254.169.254", family: 4 },
  ])).toThrow("private or reserved IPv4");
  expect(() => assertHostedResolvedAddressesAllowed("six-to-four.example", [
    { address: "2002:a9fe:a9fe::1", family: 6 },
  ])).toThrow("private or reserved IPv6");
  expect(() => assertHostedResolvedAddressesAllowed("nat64.example", [
    { address: "64:ff9b::a9fe:a9fe", family: 6 },
  ])).toThrow("private or reserved IPv6");
  expect(() => assertHostedResolvedAddressesAllowed("local-v6.example", [
    { address: "fe90::1", family: 6 },
  ])).toThrow("private or reserved IPv6");
});
