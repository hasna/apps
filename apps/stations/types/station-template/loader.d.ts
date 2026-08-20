import { type EffectiveTemplate, type StationTemplate } from "./schema.js";
export interface LoadTemplateOptions {
    /** Override the templates root (tests). Defaults to <package>/templates. */
    templatesDir?: string;
}
export declare function defaultTemplatesDir(): string;
export declare function parseSysctlKeys(content: string): string[];
export interface LoadedStationTemplate {
    template: StationTemplate;
    templateDir: string;
    templatePath: string;
}
export declare function loadStationTemplate(name?: string, options?: LoadTemplateOptions): LoadedStationTemplate;
/**
 * Resolve base + overlays into one effective template. Overlay order matters:
 * later overlays win on conflicting targets/keys.
 */
export declare function resolveStationTemplate(overlays?: string[], options?: LoadTemplateOptions & {
    name?: string;
}): EffectiveTemplate;
/** Parse a CLI layer spec like "station" or "station,ec2" into name + overlays. */
export declare function parseTemplateSpec(spec: string): {
    name: string;
    overlays: string[];
};
