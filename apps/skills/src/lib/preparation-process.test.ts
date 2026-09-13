import { describe, expect, test } from "bun:test";
import { capturePreparationProcess } from "./preparation-process";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

describe("dependency preparation process ownership", () => {
  test("captures a group once before a reaped child exposes a sentinel PID", () => {
    let reads = 0, pid = 43210;
    const requests: Array<[number, string | number]> = [];
    const child = { get pid() { reads++; return pid; }, exitCode: null as number | null, signalCode: null, kill() { throw new Error("Reaped child handle must not be signaled"); } };
    const owned = capturePreparationProcess(child, "darwin", (group, signal) => {
      requests.push([group, signal]);
      if (signal === 0) throw Object.assign(new Error("gone"), { code: "ESRCH" });
    });
    child.exitCode = 1;
    for (const sentinel of [0, -1, 1, Number.NaN]) {
      pid = sentinel;
      owned.kill();
      expect(owned.groupExited()).toBe(true);
    }
    expect(reads).toBe(1);
    expect(requests).toEqual(Array.from({ length: 4 }, (): Array<[number, string | number]> => [[-43210, "SIGKILL"], [-43210, 0]]).flat());
  });

  for (const pid of [undefined, 0, -1, 1, Number.NaN, Number.POSITIVE_INFINITY, 2.5]) {
    test(`invalid initial PID ${pid} never becomes a group signal`, () => {
      const signals: Array<[number, string | number]> = [];
      let directKills = 0;
      const child = { pid: pid as number, exitCode: null as number | null, signalCode: null, kill() { directKills++; } };
      const owned = capturePreparationProcess(child, "darwin", (group, signal) => { signals.push([group, signal]); });
      owned.kill(); expect(directKills).toBe(1);
      child.exitCode = 1;
      owned.kill(); expect(directKills).toBe(1);
      expect(owned.groupExited()).toBeUndefined();
      expect(signals).toEqual([]);
    });
  }

  test("group signaling failure falls back only while the owned child is live", () => {
    let directKills = 0;
    const child = { pid: 43210, exitCode: null as number | null, signalCode: null, kill() { directKills++; } };
    const owned = capturePreparationProcess(child, "darwin", () => { throw Object.assign(new Error("denied"), { code: "EPERM" }); });
    owned.kill(); expect(directKills).toBe(1);
    child.exitCode = 0;
    owned.kill(); expect(directKills).toBe(1);
    expect(owned.groupExited()).toBeUndefined();
  });
});
