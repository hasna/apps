import type { EffectiveTemplate } from "./schema.js";

export type TemplateStateAppliedBy = "cloud-init" | "setup";

export function renderTemplateState(
  effective: EffectiveTemplate,
  renderedFor: string,
  appliedBy: TemplateStateAppliedBy
): string {
  return JSON.stringify({
    template: effective.name,
    version: effective.version,
    layers: effective.layers.join(","),
    renderedFor,
    appliedBy,
  });
}
