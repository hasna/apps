import { createIntakeClient, IntakeError, MAX_REQUEST_BYTES, validateBinding, validateRequest } from "./client.js";

export async function runIntakeCli(args:string[]):Promise<void>{
  if(args.length===1&&["--help","-h"].includes(args[0]!)){
    console.log("events intake capability|accept|receipt --tenant-id ID --sink-id UUID --producer-id UUID --corpus-id ID --source-authority-id ID\naccept and receipt read one frozen IntakeRequest JSON object from stdin. Uses saved Events API credentials; no local store.");return;
  }
  try{
    const [operation,...rest]=args;
    if(!["capability","accept","receipt"].includes(operation!))throw new Error();
    const opts:Record<string,string>={};
    for(let i=0;i<rest.length;i+=2){const k=rest[i],v=rest[i+1];if(!k||!v||Object.hasOwn(opts,k))throw new Error();opts[k]=v;}
    const keys=["--tenant-id","--sink-id","--producer-id","--corpus-id","--source-authority-id"];
    if(Object.keys(opts).length!==keys.length||keys.some(k=>!opts[k]))throw new Error();
    const binding=validateBinding({sink_id:opts["--sink-id"],producer_id:opts["--producer-id"],corpus_id:opts["--corpus-id"],source_authority_id:opts["--source-authority-id"]});
    const client=createIntakeClient({binding,tenantId:opts["--tenant-id"]!});
    if(operation==="capability"){await client.capability();console.log(JSON.stringify({status:"authorized_capability"}));return;}
    if(process.stdin.isTTY)throw new Error();
    let bytes=0;const chunks:Buffer[]=[];
    for await(const raw of process.stdin){const chunk=Buffer.from(raw);bytes+=chunk.length;if(bytes>MAX_REQUEST_BYTES)throw new Error();chunks.push(chunk);}
    const request=validateRequest(JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(Buffer.concat(chunks))));
    console.log(JSON.stringify(operation==="accept"?await client.accept(request):await client.receipt(request)));
  }catch{throw new IntakeError("intake_operation_unconfirmed");}
}
