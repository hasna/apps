import { expect,test } from "bun:test";
import { detectChatGPTApp,type DesktopHost } from "../src/desktop-apps";

function fixture(paths:Record<string,string>,registered="",platform="darwin") {
  const calls:string[]=[];
  const host:DesktopHost={platform,home:"/fixture",isDirectory:async path=>path in paths,executable:async()=>true,
    async run(command,args){calls.push(command);if(command.endsWith("osascript"))return registered;
      return args[1]==="CFBundleIdentifier"?paths[args.at(-1)!.replace(/\/Contents\/Info.plist$/,"")]:args[1]==="CFBundleExecutable"?"ChatGPT":"26.901.51231";}};
  return{host,calls};
}
test("detects the unified app using the retained Codex bundle identity",async()=>{
  const f=fixture({"/Applications/ChatGPT.app":"com.openai.codex"});
  expect(await detectChatGPTApp(undefined,f.host)).toMatchObject({path:"/Applications/ChatGPT.app",codexExecutable:"/Applications/ChatGPT.app/Contents/Resources/codex"});
});
test("discovers renamed and user-installed app bundles",async()=>{
  for(const path of ["/fixture/Applications/ChatGPT.app","/Applications/Assistant 'test'.app"]){
    const f=fixture({[path]:"com.openai.codex"},path);
    expect((await detectChatGPTApp(undefined,f.host)).path).toBe(path);
  }
});
test("rejects Classic, wrong bundle IDs, missing apps and non-macOS before launch",async()=>{
  for(const id of ["com.openai.chat","unrelated"]){const f=fixture({"/Applications/ChatGPT.app":id});await expect(detectChatGPTApp(undefined,f.host)).rejects.toMatchObject({code:"app_not_installed"});}
  const f=fixture({});await expect(detectChatGPTApp("relative.app",f.host)).rejects.toMatchObject({code:"app_not_installed"});
  for(const os of ["linux","win32"]){const f=fixture({},"",os);await expect(detectChatGPTApp(undefined,f.host)).rejects.toMatchObject({code:"unsupported_platform"});expect(f.calls).toEqual([]);}
});
