#!/usr/bin/env bun
import { Pool } from "pg";
import { IntakeError, uuid } from "../intake/protocol.js";
import { IntakePostgres } from "./intake-postgres.js";
import { createIntakeHandler } from "./intake-api.js";
import { runIntakeAdmin } from "./intake-admin.js";

export async function main(args=process.argv.slice(2)) {
  if(args.length===1 && ["--help","-h"].includes(args[0]!)){
    console.log("events-serve [admin init|bind|register-key|grant|revoke <explicit selectors>]\nAuthenticated PostgreSQL event intake. No automatic migrations or producer adoption.\nServe requires HASNA_EVENTS_DATABASE_URL, HASNA_EVENTS_API_SIGNING_KEY, HASNA_EVENTS_SINK_ID and HASNA_EVENTS_AUTHORITY_ID.\nUse the documented owner-only admin operations to initialize the schema and key grants.");return;
  }
  if(args.length && args[0]!=="admin")throw new IntakeError("invalid_serve_arguments");
  const connectionString=process.env.HASNA_EVENTS_DATABASE_URL;
  if(!connectionString?.trim())throw new IntakeError("events_database_url_required");
  const pool=new Pool({connectionString,max:10,connectionTimeoutMillis:5000,statement_timeout:15000,application_name:"events-intake"});
  const signingSecret=process.env.HASNA_EVENTS_API_SIGNING_KEY;
  try{
    if(args[0]==="admin"){await runIntakeAdmin(pool,args.slice(1),signingSecret);console.log(JSON.stringify({status:"operator_operation_completed"}));await pool.end();return;}
    if(!signingSecret?.trim())throw new IntakeError("events_signing_key_required");
    const store=new IntakePostgres(pool,uuid(process.env.HASNA_EVENTS_SINK_ID),uuid(process.env.HASNA_EVENTS_AUTHORITY_ID));
    await store.ready();
    const rawPort=process.env.PORT??"3000";
    if(!/^\d{1,5}$/.test(rawPort)||Number(rawPort)<1||Number(rawPort)>65535)throw new IntakeError("invalid_serve_port");
    const server=Bun.serve({hostname:process.env.HOST??"127.0.0.1",port:Number(rawPort),maxRequestBodySize:532480,idleTimeout:30,fetch:createIntakeHandler(store,signingSecret)});
    let stopping=false;const stop=()=>{if(stopping)return;stopping=true;server.stop(true);void pool.end();};
    process.once("SIGINT",stop);process.once("SIGTERM",stop);
    console.log(JSON.stringify({status:"listening",port:server.port}));
  }catch(error){await pool.end();throw error;}
}
if(import.meta.main)void main().catch(error=>{console.error(error instanceof IntakeError?error.code:"events_intake_startup_failed");process.exitCode=1;});
