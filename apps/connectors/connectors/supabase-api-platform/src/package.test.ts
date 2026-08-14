import { describe, expect, test } from 'bun:test';

type ConnectorPackageJson = {
  exports?: {
    '.'?: {
      import?: string;
      types?: string;
    };
  };
  files?: string[];
  main?: string;
  scripts?: Record<string, string>;
  types?: string;
};

const packageJson = await Bun.file(
  new URL('../package.json', import.meta.url),
).json() as ConnectorPackageJson;

describe('package publish metadata', () => {
  test('keeps main exports and declaration artifacts packable', () => {
    expect(packageJson.main).toBe('./dist/index.js');
    expect(packageJson.types).toBe('./dist/index.d.ts');
    expect(packageJson.exports?.['.']?.import).toBe('./dist/index.js');
    expect(packageJson.exports?.['.']?.types).toBe('./dist/index.d.ts');
    expect(packageJson.files).toContain('dist/');
    expect(packageJson.files).toContain('bin/');
    expect(packageJson.scripts?.build).toContain('tsconfig.build.json');
    expect(packageJson.scripts?.build).toContain('--emitDeclarationOnly');
  });
});
