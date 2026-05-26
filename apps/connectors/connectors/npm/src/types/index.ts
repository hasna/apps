export interface NpmConfig { token?: string; }

export interface NpmPackage { name: string; version: string; description: string; keywords: string[]; homepage: string; repository: { type: string; url: string }; license: string; author: { name: string; email?: string }; maintainers: { name: string; email: string }[]; readme: string; time: Record<string, string>; versions: Record<string, NpmVersion>; 'dist-tags': Record<string, string>; }
export interface NpmVersion { name: string; version: string; description: string; main: string; dependencies: Record<string, string>; devDependencies: Record<string, string>; dist: { tarball: string; shasum: string; integrity: string }; }
export interface NpmSearchResult { objects: { package: { name: string; version: string; description: string; keywords: string[]; date: string; links: Record<string, string>; publisher: { username: string; email: string }; maintainers: { username: string; email: string }[] }; score: { final: number; detail: { quality: number; popularity: number; maintenance: number } } }[]; total: number; }
export interface NpmDownloads { downloads: number; start: string; end: string; package: string; }
export interface NpmDownloadsRange { downloads: { downloads: number; day: string }[]; start: string; end: string; package: string; }

export class NpmApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'NpmApiError'; this.statusCode = statusCode; }
}
