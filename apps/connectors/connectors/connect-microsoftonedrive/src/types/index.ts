export interface OneDriveConfig { token: string; }

export interface ODDriveItem { id: string; name: string; size: number; webUrl: string; createdDateTime: string; lastModifiedDateTime: string; folder?: { childCount: number }; file?: { mimeType: string; hashes: { sha256Hash: string } }; parentReference: { driveId: string; id: string; path: string }; '@microsoft.graph.downloadUrl'?: string; }
export interface ODDriveItemList { value: ODDriveItem[]; '@odata.nextLink'?: string; }
export interface ODDrive { id: string; name: string; driveType: string; owner: { user: { displayName: string; id: string } }; quota: { total: number; used: number; remaining: number }; }
export interface ODPermission { id: string; roles: string[]; link: { type: string; webUrl: string; scope: string }; grantedTo?: { user: { displayName: string; id: string } }; }
export interface ODSearchResult { value: { hitsContainers: { hits: { resource: ODDriveItem }[] }[] }; }

export class OneDriveApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'OneDriveApiError'; this.statusCode = statusCode; }
}
