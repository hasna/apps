import { expect, test } from "bun:test";
import { mapBounded } from "./bounded-map";

test("bounded map handles empty input and rejects invalid limits without starting work", async () => {
  let calls = 0;
  const worker = async () => { calls++; return 1; };
  expect(await mapBounded([], 6, worker)).toEqual([]);
  for (const limit of [0, -1, 1.5, NaN, Infinity]) {
    await expect(mapBounded([1], limit, worker)).rejects.toThrow(RangeError);
  }
  expect(calls).toBe(0);
});

test("bounded map executes every item once, with bounded concurrency and input-order results", async () => {
  let active = 0, maximum = 0;
  const visited: number[] = [], completed: number[] = [];
  const releases = new Map<number, () => void>();
  const result = mapBounded([0, 1, 2, 3, 4], 2, async (item) => {
    visited.push(item); maximum = Math.max(maximum, ++active);
    await new Promise<void>(resolve => releases.set(item, resolve));
    completed.push(item); active--; return item * 2;
  });
  const release = async (item: number) => { releases.get(item)!(); await Promise.resolve(); await Promise.resolve(); };
  await release(1); await release(2); await release(3); await release(4); await release(0);
  expect(await result).toEqual([0, 2, 4, 6, 8]);
  expect(visited).toEqual([0, 1, 2, 3, 4]);
  expect(completed).toEqual([1, 2, 3, 4, 0]);
  expect(maximum).toBe(2); expect(active).toBe(0);
});

test("bounded map drains every item and propagates the first input-order error, not completion order", async () => {
  const first = new Error("first input failure"), second = new Error("earlier completion failure");
  const visited: number[] = [];
  let release!: () => void, finished = false;
  const result = mapBounded([0, 1, 2], 2, async (item) => {
    visited.push(item);
    if (item === 0) { await new Promise<void>(resolve => { release = resolve; }); throw first; }
    if (item === 1) throw second;
    finished = true; return item;
  });
  let settled = false;
  const observed = result.catch(error => { settled = true; return error; });
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  expect(finished).toBe(true); expect(settled).toBe(false);
  release();
  expect(await observed).toBe(first);
  expect(visited).toEqual([0, 1, 2]);
});
