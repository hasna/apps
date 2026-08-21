export interface VendorKitCliOptions {
    json?: boolean;
    check?: boolean;
    kitVersion?: string;
    contract?: boolean;
}
export declare function runVendorKit(targetRepo: string, options: VendorKitCliOptions): void;
export declare function runCheckKit(targetRepo: string, options: VendorKitCliOptions): void;
