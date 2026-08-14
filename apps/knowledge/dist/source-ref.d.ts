export type SourceRefKind = 'open-files' | 's3' | 'file' | 'web';
export interface BaseSourceRef {
    kind: SourceRefKind;
    uri: string;
}
export interface OpenFilesSourceRef extends BaseSourceRef {
    kind: 'open-files';
    entity: 'file' | 'source';
    id: string;
    revision_id?: string;
    path?: string;
}
export interface S3SourceRef extends BaseSourceRef {
    kind: 's3';
    bucket: string;
    key: string;
}
export interface FileSourceRef extends BaseSourceRef {
    kind: 'file';
    path: string;
}
export interface WebSourceRef extends BaseSourceRef {
    kind: 'web';
    url: string;
}
export type SourceRef = OpenFilesSourceRef | S3SourceRef | FileSourceRef | WebSourceRef;
export declare function parseSourceRef(uri: string): SourceRef;
export declare function catalogSourceUriForRef(uri: string, parsed?: SourceRef): string;
export declare function revisionIdForSourceRef(uri: string): string | null;
export declare function isSupportedSourceRef(uri: string): boolean;
