import { describe, test, expect } from "bun:test";
import { Command } from "commander";
import { registerChannelCommands, mergeChannelClassMetadata, channelClassOf } from "./channels";

describe("registerChannelCommands", () => {
  test("registers channel command", () => {
    const program = new Command();
    registerChannelCommands(program);

    const channel = program.commands.find((c) => c.name() === "channel");
    expect(channel).toBeDefined();
    expect(channel?.description()).toContain("Manage");
  });

  test("registers channel subcommands", () => {
    const program = new Command();
    registerChannelCommands(program);

    const channel = program.commands.find((c) => c.name() === "channel");
    const subcommands = channel?.commands.map((c) => c.name()) ?? [];

    expect(subcommands).toContain("create");
    expect(subcommands).toContain("list");
    expect(subcommands).toContain("update");
    expect(subcommands).toContain("archive");
    expect(subcommands).toContain("unarchive");
  });

  test("registers channel send subcommand", () => {
    const program = new Command();
    registerChannelCommands(program);

    const channel = program.commands.find((c) => c.name() === "channel");
    const send = channel?.commands.find((c) => c.name() === "send");
    expect(send).toBeDefined();
    expect(send?.options.some((o) => o.long === "--priority")).toBe(true);
  });

  test("registers channel read subcommand", () => {
    const program = new Command();
    registerChannelCommands(program);

    const channel = program.commands.find((c) => c.name() === "channel");
    const read = channel?.commands.find((c) => c.name() === "read");
    expect(read).toBeDefined();
  });

  test("registers channel join and leave commands", () => {
    const program = new Command();
    registerChannelCommands(program);

    const channel = program.commands.find((c) => c.name() === "channel");
    expect(channel?.commands.find((c) => c.name() === "join")).toBeDefined();
    expect(channel?.commands.find((c) => c.name() === "leave")).toBeDefined();
  });

  test("registers channel subscribe and unsubscribe commands", () => {
    const program = new Command();
    registerChannelCommands(program);

    const channel = program.commands.find((c) => c.name() === "channel");
    expect(channel?.commands.find((c) => c.name() === "subscribe")).toBeDefined();
    expect(channel?.commands.find((c) => c.name() === "unsubscribe")).toBeDefined();
  });

  test("registers channel subscriptions command", () => {
    const program = new Command();
    registerChannelCommands(program);

    const channel = program.commands.find((c) => c.name() === "channel");
    const subs = channel?.commands.find((c) => c.name() === "subscriptions");
    expect(subs).toBeDefined();
  });

  test("registers channel members command", () => {
    const program = new Command();
    registerChannelCommands(program);

    const channel = program.commands.find((c) => c.name() === "channel");
    const members = channel?.commands.find((c) => c.name() === "members");
    expect(members).toBeDefined();
  });

  test("channel create and update accept --class", () => {
    const program = new Command();
    registerChannelCommands(program);

    const channel = program.commands.find((c) => c.name() === "channel");
    const create = channel?.commands.find((c) => c.name() === "create");
    const update = channel?.commands.find((c) => c.name() === "update");
    expect(create?.options.some((o) => o.long === "--class")).toBe(true);
    expect(update?.options.some((o) => o.long === "--class")).toBe(true);
  });
});

describe("mergeChannelClassMetadata", () => {
  test("sets class on empty metadata", () => {
    expect(mergeChannelClassMetadata(null, "fleet")).toEqual({ channel_schema: { class: "fleet" } });
    expect(mergeChannelClassMetadata(undefined, " package ")).toEqual({ channel_schema: { class: "package" } });
  });

  test("preserves unrelated metadata and schema keys", () => {
    const existing = { owner: "chief", channel_schema: { class: "product", version: 1 } };
    const merged = mergeChannelClassMetadata(existing, "initiative");
    expect(merged).toEqual({ owner: "chief", channel_schema: { class: "initiative", version: 1 } });
    // input untouched
    expect(existing.channel_schema.class).toBe("product");
  });

  test("empty class clears the field and collapses empty containers", () => {
    expect(mergeChannelClassMetadata({ channel_schema: { class: "fleet" } }, "")).toBeNull();
    expect(mergeChannelClassMetadata({ channel_schema: { class: "fleet", version: 2 } }, " ")).toEqual({ channel_schema: { version: 2 } });
    expect(mergeChannelClassMetadata({ owner: "chief", channel_schema: { class: "fleet" } }, "")).toEqual({ owner: "chief" });
  });

  test("replaces a malformed channel_schema", () => {
    expect(mergeChannelClassMetadata({ channel_schema: "bogus" }, "fleet")).toEqual({ channel_schema: { class: "fleet" } });
    expect(mergeChannelClassMetadata({ channel_schema: [1, 2] }, "fleet")).toEqual({ channel_schema: { class: "fleet" } });
  });
});

describe("channelClassOf", () => {
  test("reads the class when present", () => {
    expect(channelClassOf({ channel_schema: { class: "loop-lane" } })).toBe("loop-lane");
  });

  test("returns null for missing or malformed metadata", () => {
    expect(channelClassOf(null)).toBeNull();
    expect(channelClassOf(undefined)).toBeNull();
    expect(channelClassOf({})).toBeNull();
    expect(channelClassOf({ channel_schema: "x" })).toBeNull();
    expect(channelClassOf({ channel_schema: { class: 7 } })).toBeNull();
    expect(channelClassOf({ channel_schema: { class: "  " } })).toBeNull();
  });
});
