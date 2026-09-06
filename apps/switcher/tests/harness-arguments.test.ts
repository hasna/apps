import {test, expect} from "bun:test";
import {assertHarnessArguments, geminiPolicyArguments} from "../src/harness-arguments";

test("legacy OpenCode boolean flags and valueless strings cannot hide a model override", () => {
  for (const flag of ["--continue", "--fork", "--share", "--thinking", "--interactive", "--pure", "--print-logs", "--no-replay", "--title", "--prompt", "--file", "--agent", "-f", "-s"])
    expect(() => assertHarnessArguments("opencode", ["run", flag, "--model", "switcher/other"])).toThrow("reserved");
  for (const args of [["run", "-f--model"], ["run", "-cfoo"], ["run", "--file=--model"], ["run", "--title=--model"], ["run", "--", "--model", "literal"], ["run", "--continue", "resume this task"]])
    expect(() => assertHarnessArguments("opencode", args)).not.toThrow();
});

test("Gemini native arguments preserve values and reserve profile model authority", () => {
  expect(() => assertHarnessArguments("gemini", ["--model", "outside"])).toThrow("reserved");
  expect(() => assertHarnessArguments("gemini", ["--model=outside"])).toThrow("reserved");
  expect(() => assertHarnessArguments("gemini", ["-moutside"])).toThrow("reserved");
  expect(() => assertHarnessArguments("gemini", ["--prompt", "--model", "--approval-mode", "plan"])).not.toThrow();
  expect(() => assertHarnessArguments("gemini", ["--", "--model", "literal prompt"])).not.toThrow();
  expect(() => assertHarnessArguments("gemini", ["--approval-mode", "plan", "--policy", "policy.json", "--resume", "latest"])).not.toThrow();
});


test("Gemini optional and boolean arguments cannot hide native model overrides",()=>{
 for(const args of [["--sandbox","--model","outside","--sandbox=false"],["--resume","--model","outside"],["--worktree","--model=outside"],["-r","-moutside"],["-s","--model=outside"],["--acp"],["--experimental-acp"],["--experimentalAcp"]]) expect(()=>assertHarnessArguments("gemini",args)).toThrow("reserved");
 for(const args of [["--resume"],["--resume","latest"],["--worktree"],["--sandbox=false"],["-s"],["-ojson","-ptext"],["--prompt","--model"],["--","--model","literal"]])expect(()=>assertHarnessArguments("gemini",args)).not.toThrow();
});

test("Gemini policy arguments retain original home without rewriting literal prompt values",()=>{
 expect(geminiPolicyArguments(["--policy","~/rules,~/more","--adminPolicy=~/admin"],"/original")).toEqual(["--policy","/original/rules,/original/more","--adminPolicy=/original/admin"]);
 for(const args of [["--prompt","--policy","~/literal"],["--promptInteractive","--policy","~/literal"],["-p","--policy","~/literal"],["--","--policy","~/literal"]]) expect(geminiPolicyArguments(args,"/original")).toEqual(args);
});
