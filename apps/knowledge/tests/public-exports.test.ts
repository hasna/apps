import { describe, expect, test } from 'bun:test';
import reflectionFixture from './fixtures/public-reflection-e1eed58.json' with { type: 'json' };
import * as rootExports from '../src/index.ts';
import * as storageExports from '../src/storage.ts';
import * as serveExports from '../src/serve.ts';
import * as builtRootExports from '../dist/index.js';
import * as builtStorageExports from '../dist/storage.js';
import * as builtServeExports from '../dist/serve.js';

type MemberShape =
  | { kind: 'method'; name: string; length: number }
  | { kind: 'accessor'; getLength: number | null; setLength: number | null };

interface FunctionShape {
  name: string;
  length: number;
  constructable: boolean;
  members: Record<string, MemberShape>;
  statics: Record<string, MemberShape>;
}

interface SurfaceFixture {
  keys: string[];
  functions: Record<string, FunctionShape>;
}

const fixture = reflectionFixture as {
  version: number;
  base_commit: string;
  surfaces: Record<'root' | 'storage' | 'serve', SurfaceFixture>;
};

const surfaces = {
  root: { source: rootExports, built: builtRootExports },
  storage: { source: storageExports, built: builtStorageExports },
  serve: { source: serveExports, built: builtServeExports },
} as const;

function isConstructable(value: Function): boolean {
  try {
    Reflect.construct(String, [], value);
    return true;
  } catch {
    return false;
  }
}

function memberShape(
  owner: object,
  key: string,
): MemberShape {
  const descriptor = Object.getOwnPropertyDescriptor(owner, key);
  if (!descriptor) throw new Error(`Missing descriptor for ${key}`);
  if ('value' in descriptor && typeof descriptor.value === 'function') {
    return {
      kind: 'method',
      name: descriptor.value.name,
      length: descriptor.value.length,
    };
  }
  return {
    kind: 'accessor',
    getLength: typeof descriptor.get === 'function' ? descriptor.get.length : null,
    setLength: typeof descriptor.set === 'function' ? descriptor.set.length : null,
  };
}

const ignoredStaticKeys = new Set([
  'arguments',
  'caller',
  'length',
  'name',
  'prototype',
]);

function describeFunction(value: Function): FunctionShape {
  const members: Record<string, MemberShape> = {};
  if (value.prototype && typeof value.prototype === 'object') {
    for (const key of Object.getOwnPropertyNames(value.prototype).sort()) {
      members[key] = memberShape(value.prototype, key);
    }
  }

  const statics: Record<string, MemberShape> = {};
  for (const key of Object.getOwnPropertyNames(value).sort()) {
    if (ignoredStaticKeys.has(key)) continue;
    statics[key] = memberShape(value, key);
  }

  return {
    name: value.name,
    length: value.length,
    constructable: isConstructable(value),
    members,
    statics,
  };
}

function assertFunctionCompatibility(
  surfaceName: keyof typeof surfaces,
  exportName: string,
  actual: unknown,
  expected: FunctionShape,
): void {
  expect(typeof actual, `${surfaceName}.${exportName} must remain callable`).toBe('function');
  const described = describeFunction(actual as Function);
  expect({
    name: described.name,
    length: described.length,
    constructable: described.constructable,
  }).toEqual({
    name: expected.name,
    length: expected.length,
    constructable: expected.constructable,
  });

  for (const [memberName, member] of Object.entries(expected.members)) {
    expect(described.members[memberName], `${surfaceName}.${exportName}.${memberName}`).toEqual(member);
  }
  expect(described.statics).toEqual(expected.statics);

  const addedMembers = Object.keys(described.members)
    .filter((name) => !(name in expected.members))
    .sort();
  expect(addedMembers).toEqual([]);
}

describe('Stage-A public reflection compatibility against pinned base', () => {
  test('fixture is tied to the exact inherited base', () => {
    expect(fixture.version).toBe(1);
    expect(fixture.base_commit).toBe('e1eed58db9157f150eefc4d2a29810199ecc9b46');
  });

  for (const [surfaceName, modules] of Object.entries(surfaces) as Array<
    [keyof typeof surfaces, (typeof surfaces)[keyof typeof surfaces]]
  >) {
    for (const [buildKind, exportsObject] of Object.entries(modules)) {
      test(`${surfaceName} ${buildKind} retains exact base exports and callable reflection`, () => {
        const expected = fixture.surfaces[surfaceName];
        expect(Object.keys(exportsObject).sort()).toEqual([...expected.keys].sort());
        for (const [exportName, shape] of Object.entries(expected.functions)) {
          assertFunctionCompatibility(
            surfaceName,
            exportName,
            (exportsObject as Record<string, unknown>)[exportName],
            shape,
          );
        }
      });
    }
  }

  test('operator capability factory is absent from every public package boundary', () => {
    for (const surface of [
      rootExports,
      storageExports,
      serveExports,
      builtRootExports,
      builtStorageExports,
      builtServeExports,
    ]) {
      expect('createKnowledgeOperatorCapability' in surface).toBe(false);
      expect('assertKnowledgeOperatorRuntime' in surface).toBe(false);
    }
  });
});
