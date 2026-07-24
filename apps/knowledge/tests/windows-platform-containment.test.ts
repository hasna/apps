import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ANCHORED_FILESYSTEM_SUPPORT,
  AnchoredFilesystemError,
  assertAnchoredFilesystemPlatform,
  writeAnchoredRegularFile,
} from '../src/anchored-fs';

describe('unsupported-platform local filesystem containment', () => {
  test('publishes explicit support metadata and rejects Windows deterministically', () => {
    expect(ANCHORED_FILESYSTEM_SUPPORT).toEqual({
      supportedPlatforms: ['linux', 'darwin'],
      unsupportedBehavior: 'fail-closed-before-filesystem-io',
    });
    expect(() => assertAnchoredFilesystemPlatform('win32')).toThrow(
      AnchoredFilesystemError,
    );
    expect(() => assertAnchoredFilesystemPlatform('win32')).toThrow(
      'local filesystem access is disabled',
    );
  });

  test('the Windows runtime rejects writes before creating a parent or target', () => {
    if (process.platform !== 'win32') {
      expect(ANCHORED_FILESYSTEM_SUPPORT.supportedPlatforms).not.toContain('win32');
      return;
    }
    const parent = join(mkdtempSync(join(tmpdir(), 'knowledge-win-contained-')), 'absent');
    const target = join(parent, 'config.json');
    expect(() => writeAnchoredRegularFile(target, '{}\n')).toThrow(
      AnchoredFilesystemError,
    );
    expect(existsSync(parent)).toBe(false);
    expect(existsSync(target)).toBe(false);
  });
});
