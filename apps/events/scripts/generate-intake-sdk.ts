import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

/** Small schema compiler for this bounded protocol, refusing unsupported shapes. */
export function generate(): string {
  const spec=JSON.parse(readFileSync(resolve(import.meta.dir,"../schemas/intake.openapi.json"),"utf8"));
  function type(s:any):string {
    if(s.$ref)return s.$ref.split("/").at(-1);
    if(s.enum)return s.enum.map((v:unknown)=>JSON.stringify(v)).join(" | ");
    if(s.type==="string")return "string";
    if(s.type==="object"&&s.additionalProperties===false)return `{ ${Object.entries(s.properties).map(([k,v])=>`${k}${s.required.includes(k)?"":"?"}: ${type(v)};`).join(" ")} }`;
    throw new Error("Unsupported intake schema; update the reviewed generator");
  }
  const types=Object.entries(spec.components.schemas).map(([name,s])=>`export type ${name} = ${type(s)};`).join("\n");
  const methods=Object.entries(spec.paths).flatMap(([path,verbs]:[string,any])=>Object.entries(verbs).map(([method,op]:[string,any])=>{
    const success=op.responses[method==="post"?"201":"200"].content["application/json"].schema;
    const body=op.requestBody?.content["application/json"]?.schema;
    if(!/^[A-Za-z]+$/.test(op.operationId)||!path.startsWith("/v1/"))throw new Error("Unsupported intake operation");
    return `export function ${op.operationId}(client: HasnaHttpTransport, ${body?`body: ${type(body)}, `:""}options: HasnaRequestOptions): Promise<${type(success)}> {\n  return client.request(${JSON.stringify(method.toUpperCase())}, ${JSON.stringify(path.slice(3))}, ${body?"body":"undefined"}, options);\n}`;
  })).join("\n");
  return `// Generated from schemas/intake.openapi.json. Run bun run sdk:generate.\nimport type { HasnaHttpTransport, HasnaRequestOptions } from "@hasna/contracts/client";\n${types}\n${methods}\n`;
}
if(import.meta.main){
  const file=resolve(import.meta.dir,"../src/intake/generated.ts"),output=generate();
  if(process.argv.includes("--check")){if(readFileSync(file,"utf8")!==output)throw new Error("Generated intake client is stale");}
  else writeFileSync(file,output);
}
