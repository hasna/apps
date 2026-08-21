export declare function parseIntegerOption(value: string, label: string, constraints?: {
    min?: number;
    max?: number;
}): number;
export declare function renderKeyValueTable(entries: Array<[string, string]>): string;
export declare function renderList(title: string, items: string[]): string;
