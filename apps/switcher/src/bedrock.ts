/** The regional AWS Mantle Messages authority documented by Amazon Bedrock. */
export function bedrockMantleOrigin(value:string):string|undefined {
 let url:URL;try{url=new URL(value);}catch{return;}
 if(url.protocol!=="https:"||url.port||url.username||url.password||url.search||url.hash||url.pathname.replace(/\/+$/,"")!=="/anthropic/v1")return;
 return /^bedrock-mantle\.[a-z]{2}(?:-[a-z]+)+-\d+\.api\.aws$/.test(url.hostname)?url.origin:undefined;
}
