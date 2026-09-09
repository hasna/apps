import { COLUMNS, TABLES, MAX_ROWS } from "./snapshot.js";
const scalar = { nullable: true, anyOf: [{type:"string"},{type:"integer"}] };
const uuid = {type:"string",format:"uuid"};
const nonce = {type:"string",pattern:"^[a-f0-9]{64}$"};
const snapshot = {type:"object",additionalProperties:false,required:["schema","audit_sequence","tables"],properties:{
 schema:{type:"integer",enum:[1]},audit_sequence:{type:"integer",minimum:0},tables:{type:"object",additionalProperties:false,required:TABLES,properties:Object.fromEntries(TABLES.map(t=>[t,{type:"array",maxItems:MAX_ROWS,items:{type:"object",additionalProperties:false,required:COLUMNS[t],properties:Object.fromEntries(COLUMNS[t].map(c=>[c,scalar]))}}]))},
}};
function responses(schema:unknown) {
 return Object.fromEntries([200,400,401,403,409,413,503].map(status=>[String(status),{description:status===200?"Verified result":"Migration not verified; retain source",content:{"application/json":{schema:status===200?schema:{type:"object",additionalProperties:true}}}}]));
}
export const vaultMigrationOpenApi = {
 get:{operationId:"vaultMigrationCapability",summary:"Check tenant-bound migration capability before opening source",security:[{apiKey:[]}],responses:responses({type:"object",required:["protocol","tenant_id","kid","tables","max_bytes","atomic","deletion_authorized"],properties:{protocol:{type:"string",enum:["secrets-lossless-v1"]},tenant_id:uuid,kid:{type:"string"},tables:{type:"array",items:{type:"string",enum:TABLES}},max_bytes:{type:"integer"},atomic:{type:"boolean",enum:[true]},deletion_authorized:{type:"boolean",enum:[false]}}})},
 post:{operationId:"importVaultSnapshot",summary:"Atomically import all supported vault tables; requires secrets:migrate",security:[{apiKey:[]}],parameters:[{in:"header",name:"x-secrets-migration-tenant",required:true,schema:uuid},{in:"header",name:"x-secrets-migration-kid",required:true,schema:{type:"string"}}],requestBody:{required:true,content:{"application/json":{schema:{type:"object",additionalProperties:false,required:["expected_tenant_id","expected_kid","migration_id","source_id","nonce","snapshot"],properties:{expected_tenant_id:uuid,expected_kid:{type:"string"},migration_id:uuid,source_id:uuid,nonce,snapshot}}}}},responses:responses({type:"object",required:["protocol","migration_id","source_id","tenant_id","replayed","verified","proof","counts","deletion_authorized"],properties:{protocol:{type:"string",enum:["secrets-lossless-v1"]},migration_id:uuid,source_id:uuid,tenant_id:uuid,replayed:{type:"boolean"},verified:{type:"boolean",enum:[true]},proof:nonce,counts:{type:"object",required:TABLES,properties:Object.fromEntries(TABLES.map(t=>[t,{type:"integer",minimum:0}]))},deletion_authorized:{type:"boolean",enum:[false]}}})},
};
