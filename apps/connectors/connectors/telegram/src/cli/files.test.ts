import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { resolveDownloadPath, writeDownloadedFile } from './files';

let temporaryDirectory: string | undefined;

afterEach(() => {
  if (temporaryDirectory) {
    rmSync(temporaryDirectory, { recursive: true, force: true });
    temporaryDirectory = undefined;
  }
});

describe('Telegram CLI file downloads', () => {
  test('uses Telegram file name when the output is a directory', () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'connect-telegram-'));

    expect(resolveDownloadPath('photos/file_42.jpg', temporaryDirectory)).toBe(
      join(temporaryDirectory, 'file_42.jpg')
    );
  });

  test('creates parent directories without overwriting an existing file', () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'connect-telegram-'));
    const destination = join(temporaryDirectory, 'nested', 'file.bin');

    writeDownloadedFile(destination, new Uint8Array([1, 2, 3]));
    expect(new Uint8Array(readFileSync(destination))).toEqual(
      new Uint8Array([1, 2, 3])
    );
    expect(() =>
      writeDownloadedFile(destination, new Uint8Array([4, 5, 6]))
    ).toThrow('Refusing to overwrite existing file');
    expect(new Uint8Array(readFileSync(destination))).toEqual(
      new Uint8Array([1, 2, 3])
    );
  });
});
