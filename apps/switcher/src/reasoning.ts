import { z } from "zod";
import type { Model } from "./domain";

export const reasoningEffortSchema=z.enum(["none","minimal","low","medium","high","xhigh","max","ultra"]);
export type ReasoningEffort=z.infer<typeof reasoningEffortSchema>;

/** Advertise declared capabilities, documented DeepSeek levels, or an explicit
 * operator selection. Do not invent a complete effort menu for arbitrary models. */
export function codexReasoning(model:Model,baseUrl:string,selected?:ReasoningEffort) {
  const deepseek=new URL(baseUrl).hostname==="api.deepseek.com"&&/^deepseek-(flash|v4-(flash|pro)(-.+)?)$/.test(model.id);
  const levels:ReasoningEffort[]=[...(model.reasoningEfforts??(deepseek?["none","low","high","max"]:[]))];
  if(selected&&!levels.includes(selected)) {
    if(model.reasoningEfforts!==undefined||deepseek&&selected==="ultra")
      throw new Error("Selected reasoning effort is not supported by this model's declared capabilities.");
    levels.push(selected);
  }
  return {levels,defaultEffort:selected??(levels.includes("high")?"high":levels.includes("medium")?"medium":levels[0]??null)};
}
