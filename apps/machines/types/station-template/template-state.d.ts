import type { EffectiveTemplate } from "./schema.js";
export type TemplateStateAppliedBy = "cloud-init" | "setup";
export declare function renderTemplateState(effective: EffectiveTemplate, renderedFor: string, appliedBy: TemplateStateAppliedBy): string;
