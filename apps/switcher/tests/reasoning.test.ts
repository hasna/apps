import { expect,test } from "bun:test";
import { codexModel } from "../src/harnesses";
import { modelSchema } from "../src/domain";

test("Codex exposes documented DeepSeek reasoning only for the real provider and honors custom model capabilities",()=>{
  const model={id:"deepseek-flash",name:"DeepSeek"};
  expect(codexModel(model,0).supported_reasoning_levels).toEqual([]);
  const native=codexModel(model,0,"https://api.deepseek.com","max");
  expect(native.supported_reasoning_levels.map(level=>level.effort)).toEqual(["none","low","high","max"]);
  expect(native.default_reasoning_level).toBe("max");
  expect(codexModel(model,0,"https://api.deepseek.com","xhigh").default_reasoning_level).toBe("xhigh");
  const custom=modelSchema.parse({id:"custom",name:"Custom",reasoningEfforts:["low","high"]});
  expect(codexModel(custom,0,"https://provider.example","low").supported_reasoning_levels.map(level=>level.effort)).toEqual(["low","high"]);
  expect(()=>codexModel(custom,0,"https://provider.example","max")).toThrow("not supported");
  expect(()=>codexModel(model,0,"https://api.deepseek.com","ultra")).toThrow("not supported");
  expect(codexModel({id:"unknown",name:"Unknown"},0,"https://provider.example","max").supported_reasoning_levels.map(level=>level.effort)).toEqual(["max"]);
});
