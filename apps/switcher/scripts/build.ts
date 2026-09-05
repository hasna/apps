import { mkdir, rm } from "node:fs/promises";
await rm("dist", {recursive:true, force:true});
await mkdir("dist", {recursive:true});
for (const [entry, out] of [["index","index.js"],["sdk","sdk.js"],["cli","cli/index.js"],["mcp","mcp/index.js"],["serve","serve/index.js"]]) {
  const result = await Bun.build({entrypoints:[`src/${entry}.ts`],outdir:"dist",naming:out,target:entry==="sdk"||entry==="index"?"node":"bun",packages:"external",minify:false});
  if (!result.success) throw new Error(result.logs.map(String).join("\n"));
}
const p = Bun.spawn(["tsc","--emitDeclarationOnly"],{stdout:"inherit",stderr:"inherit"});
if (await p.exited) process.exit(1);
