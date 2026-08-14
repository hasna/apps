import { existsSync, mkdirSync, statSync, writeFileSync } from 'fs';
import { basename, dirname, join, resolve, sep } from 'path';

export function resolveDownloadPath(
  telegramFilePath: string,
  outputPath?: string
): string {
  const defaultName = basename(telegramFilePath);
  if (!defaultName || defaultName === '.' || defaultName === sep) {
    throw new Error('Telegram did not return a usable file name');
  }

  if (!outputPath) {
    return resolve(defaultName);
  }

  const requestedPath = resolve(outputPath);
  if (
    (existsSync(requestedPath) && statSync(requestedPath).isDirectory()) ||
    (!existsSync(requestedPath) && outputPath.endsWith(sep))
  ) {
    return join(requestedPath, defaultName);
  }

  return requestedPath;
}

export function writeDownloadedFile(
  destinationPath: string,
  data: Uint8Array
): void {
  if (existsSync(destinationPath)) {
    throw new Error(`Refusing to overwrite existing file: ${destinationPath}`);
  }

  mkdirSync(dirname(destinationPath), { recursive: true });
  writeFileSync(destinationPath, data, { flag: 'wx' });
}
